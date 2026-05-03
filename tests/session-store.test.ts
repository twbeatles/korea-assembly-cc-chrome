import type { SessionRecord } from "../src/core/subtitle-models";
import {
  markExtensionContextInvalidated,
  resetExtensionContextInvalidationForTests,
} from "../src/shared/extension-context";
import { queueExitPersistRecord } from "../src/storage/persist-recovery";
import {
  buildSessionLibraryBackupExport,
  closeRunningSessionsOnStartup,
  deleteAllSessions,
  deleteSession,
  exportSessionData,
  getSessionLibraryOverview,
  importSessionRecords,
  listSessions,
  listSessionsPage,
  loadSessionsByIds,
  loadSession,
  replayQueuedExitPersistRecords,
  resetSessionStoreForTests,
  saveSession,
  updateSessionMetadata,
  upsertSessionRecord,
  updateRunningSession,
} from "../src/storage/session-store";
import { SESSION_LIBRARY_TRANSFER_LIMIT_BYTES } from "../src/storage/session-backup";

function buildSession(id: string, status: SessionRecord["status"]): SessionRecord {
  return {
    id,
    version: "3",
    title: "법사위",
    committeeName: "법제사법위원회",
    sourceUrl: "https://assembly.webcast.go.kr/main/player.asp",
    startedAt: "2026-03-10T09:00:00.000Z",
    endedAt: status === "running" ? null : "2026-03-10T09:00:03.000Z",
    createdAt: "2026-03-10T09:00:00.000Z",
    updatedAt: "2026-03-10T09:00:03.000Z",
    subtitleCount: 1,
    charCount: 8,
    status,
    starred: false,
    pinnedAt: null,
    note: "",
    entries: [
      {
        id: `${id}_entry`,
        text: "테스트 자막",
        timestamp: "2026-03-10T09:00:00.000Z",
        startTime: "2026-03-10T09:00:00.000Z",
        endTime: "2026-03-10T09:00:02.000Z",
      },
    ],
  };
}

describe("session store", () => {
  beforeEach(async () => {
    resetExtensionContextInvalidationForTests();
    await resetSessionStoreForTests();
  });

  it("saves, loads, lists, and deletes sessions", async () => {
    const session = buildSession("session_1", "saved");

    await saveSession(session);
    const loaded = await loadSession(session.id);
    const listed = await listSessions({ limit: 10 });

    expect(loaded?.id).toBe(session.id);
    expect(loaded?.version).toBe("3");
    expect(listed.map((item) => item.id)).toContain(session.id);

    await deleteSession(session.id);
    await expect(loadSession(session.id)).resolves.toBeUndefined();
  });

  it("updates running sessions in place", async () => {
    const session = buildSession("session_running", "running");

    await updateRunningSession(session);
    const updated = await loadSession(session.id);

    expect(updated?.status).toBe("running");
    expect(updated?.endedAt).toBeNull();
  });

  it("persists favorites and notes and sorts favorites to the top", async () => {
    await saveSession(buildSession("session_regular", "saved"));
    await upsertSessionRecord({
      ...buildSession("session_starred", "saved"),
      starred: true,
      pinnedAt: "2026-03-10T09:30:00.000Z",
      note: "중요 메모",
    });

    const listed = await listSessions({ limit: 10 });
    const loaded = await loadSession("session_starred");

    expect(listed[0]?.id).toBe("session_starred");
    expect(loaded?.starred).toBe(true);
    expect(loaded?.pinnedAt).toBe("2026-03-10T09:30:00.000Z");
    expect(loaded?.note).toBe("중요 메모");
  });

  it("preserves favorite metadata while autosaving and finalizing an existing session", async () => {
    await upsertSessionRecord({
      ...buildSession("session_metadata", "saved"),
      starred: true,
      pinnedAt: "2026-03-10T09:30:00.000Z",
      note: "keep this note",
    });

    await updateRunningSession({
      ...buildSession("session_metadata", "running"),
      starred: false,
      pinnedAt: null,
      note: "",
      updatedAt: "2026-03-10T09:35:00.000Z",
    });
    await saveSession({
      ...buildSession("session_metadata", "saved"),
      starred: false,
      pinnedAt: null,
      note: "",
      updatedAt: "2026-03-10T09:40:00.000Z",
    });

    const loaded = await loadSession("session_metadata");

    expect(loaded?.starred).toBe(true);
    expect(loaded?.pinnedAt).toBe("2026-03-10T09:30:00.000Z");
    expect(loaded?.note).toBe("keep this note");
    expect(loaded?.status).toBe("saved");
  });

  it("updates only metadata against the latest stored session snapshot", async () => {
    await saveSession({
      ...buildSession("session_metadata_only", "saved"),
      updatedAt: "2026-03-10T09:00:03.000Z",
      entries: [
        {
          id: "session_metadata_only_entry_1",
          text: "기존 자막",
          timestamp: "2026-03-10T09:00:00.000Z",
          startTime: "2026-03-10T09:00:00.000Z",
          endTime: "2026-03-10T09:00:02.000Z",
        },
      ],
      subtitleCount: 1,
      charCount: 4,
    });

    await updateRunningSession({
      ...buildSession("session_metadata_only", "running"),
      updatedAt: "2026-03-10T09:05:00.000Z",
      entries: [
        {
          id: "session_metadata_only_entry_1",
          text: "기존 자막",
          timestamp: "2026-03-10T09:00:00.000Z",
          startTime: "2026-03-10T09:00:00.000Z",
          endTime: "2026-03-10T09:00:02.000Z",
        },
        {
          id: "session_metadata_only_entry_2",
          text: "최신 자막",
          timestamp: "2026-03-10T09:04:00.000Z",
          startTime: "2026-03-10T09:04:00.000Z",
          endTime: "2026-03-10T09:04:02.000Z",
        },
      ],
      subtitleCount: 2,
      charCount: 8,
    });

    const updated = await updateSessionMetadata("session_metadata_only", {
      starred: true,
      pinnedAt: "2026-03-10T09:06:00.000Z",
      note: "메타데이터만 갱신",
    });
    const loaded = await loadSession("session_metadata_only");

    expect(updated.updatedAt > "2026-03-10T09:05:00.000Z").toBe(true);
    expect(loaded?.status).toBe("running");
    expect(loaded?.entries).toHaveLength(2);
    expect(loaded?.entries[1]?.text).toBe("최신 자막");
    expect(loaded?.subtitleCount).toBe(2);
    expect(loaded?.starred).toBe(true);
    expect(loaded?.pinnedAt).toBe("2026-03-10T09:06:00.000Z");
    expect(loaded?.note).toBe("메타데이터만 갱신");
  });

  it("lists paged sessions without preloading the full library into the caller", async () => {
    await saveSession({
      ...buildSession("session_page_1", "saved"),
      updatedAt: "2026-03-10T09:00:01.000Z",
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await saveSession({
      ...buildSession("session_page_2", "saved"),
      updatedAt: "2026-03-10T09:00:02.000Z",
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await saveSession({
      ...buildSession("session_page_3", "saved"),
      starred: true,
      pinnedAt: "2026-03-10T09:10:00.000Z",
      updatedAt: "2026-03-10T09:00:03.000Z",
    });

    const firstPage = await listSessionsPage({ page: 1, pageSize: 2 });
    const secondPage = await listSessionsPage({ page: 2, pageSize: 2 });
    const starredOnlyPage = await listSessionsPage({
      page: 1,
      pageSize: 10,
      starredOnly: true,
    });

    expect(firstPage.totalCount).toBe(3);
    expect(firstPage.sessions.map((session) => session.id)).toEqual([
      "session_page_3",
      "session_page_2",
    ]);
    expect(secondPage.sessions.map((session) => session.id)).toEqual(["session_page_1"]);
    expect(starredOnlyPage.totalCount).toBe(1);
    expect(starredOnlyPage.sessions.map((session) => session.id)).toEqual(["session_page_3"]);
  });

  it("merges fallback records into paged results without falling back to full IndexedDB records", async () => {
    const originalIndexedDb = globalThis.indexedDB;
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: undefined,
    });

    try {
      await saveSession({
        ...buildSession("session_fallback_page", "saved"),
        updatedAt: "2026-03-10T09:00:04.000Z",
      });
    } finally {
      Object.defineProperty(globalThis, "indexedDB", {
        configurable: true,
        value: originalIndexedDb,
      });
    }

    await saveSession({
      ...buildSession("session_idb_page", "saved"),
      updatedAt: "2026-03-10T09:00:05.000Z",
    });
    const page = await listSessionsPage({ page: 1, pageSize: 2 });

    expect(page.totalCount).toBe(2);
    expect(page.sessions.map((session) => session.id)).toEqual([
      "session_idb_page",
      "session_fallback_page",
    ]);
  });

  it("fills default favorite and note fields for imported legacy records", async () => {
    await importSessionRecords([
      {
        id: "session_legacy",
        version: "2",
        title: "기존 세션",
        committeeName: "정무위원회",
        sourceUrl: "https://assembly.webcast.go.kr/main/player.asp",
        startedAt: "2026-03-10T09:00:00.000Z",
        endedAt: "2026-03-10T09:02:00.000Z",
        createdAt: "2026-03-10T09:00:00.000Z",
        updatedAt: "2026-03-10T09:02:00.000Z",
        subtitleCount: 1,
        charCount: 6,
        status: "saved",
        entries: [
          {
            id: "session_legacy_entry_1",
            text: "레거시 자막",
            timestamp: "2026-03-10T09:00:01.000Z",
            startTime: "2026-03-10T09:00:01.000Z",
            endTime: "2026-03-10T09:00:03.000Z",
          },
        ],
      },
    ]);

    const loaded = await loadSession("session_legacy");

    expect(loaded?.version).toBe("3");
    expect(loaded?.starred).toBe(false);
    expect(loaded?.pinnedAt).toBeNull();
    expect(loaded?.note).toBe("");
  });

  it("normalizes unsupported source urls to empty strings during import", async () => {
    await importSessionRecords([
      {
        ...buildSession("session_invalid_source_import", "saved"),
        sourceUrl: "https://example.com/not-supported",
      },
    ]);

    const loaded = await loadSession("session_invalid_source_import");
    expect(loaded?.sourceUrl).toBe("");
  });

  it("normalizes imported running sessions to saved records before storage", async () => {
    await importSessionRecords([
      {
        ...buildSession("session_import_running", "running"),
        updatedAt: "2026-03-10T09:07:00.000Z",
      },
    ]);

    const loaded = await loadSession("session_import_running");
    const summary = await closeRunningSessionsOnStartup();

    expect(loaded?.status).toBe("saved");
    expect(loaded?.endedAt).toBe("2026-03-10T09:07:00.000Z");
    expect(summary).toEqual({
      detectedCount: 0,
      closedCount: 0,
      failedCount: 0,
    });
  });

  it("closes stale running sessions on startup", async () => {
    await updateRunningSession(buildSession("session_running_1", "running"));
    await saveSession(buildSession("session_saved_1", "saved"));

    const summary = await closeRunningSessionsOnStartup();
    const updated = await loadSession("session_running_1");

    expect(summary).toEqual({
      detectedCount: 1,
      closedCount: 1,
      failedCount: 0,
    });
    expect(updated?.status).toBe("stopped");
    expect(updated?.endedAt).toBe(updated?.updatedAt);
  });

  it("replays queued exit persist records once per session and keeps the latest stopped snapshot", async () => {
    await queueExitPersistRecord(buildSession("session_replay", "stopped"));
    await queueExitPersistRecord({
      ...buildSession("session_replay", "stopped"),
      title: "최신 종료 스냅샷",
      updatedAt: "2026-03-10T09:00:10.000Z",
      endedAt: "2026-03-10T09:00:10.000Z",
    });

    const summary = await replayQueuedExitPersistRecords();
    const loaded = await loadSession("session_replay");

    expect(summary).toEqual({
      queuedCount: 1,
      replayedCount: 1,
      skippedCount: 0,
      failedCount: 0,
    });
    expect(loaded?.title).toBe("최신 종료 스냅샷");
  });

  it("clears queued exit persist records when a newer saved record is already present", async () => {
    await queueExitPersistRecord({
      ...buildSession("session_replay_skip", "stopped"),
      updatedAt: "2026-03-10T09:00:04.000Z",
      endedAt: "2026-03-10T09:00:04.000Z",
    });
    await saveSession({
      ...buildSession("session_replay_skip", "saved"),
      title: "이미 저장된 최신본",
      updatedAt: "2026-03-10T09:00:09.000Z",
      endedAt: "2026-03-10T09:00:09.000Z",
    });

    const summary = await replayQueuedExitPersistRecords();
    const loaded = await loadSession("session_replay_skip");

    expect(summary).toEqual({
      queuedCount: 0,
      replayedCount: 0,
      skippedCount: 0,
      failedCount: 0,
    });
    expect(loaded?.title).toBe("이미 저장된 최신본");
  });

  it("falls back when IndexedDB is unavailable", async () => {
    const originalIndexedDb = globalThis.indexedDB;
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: undefined,
    });

    try {
      const session = buildSession("session_fallback", "saved");

      await saveSession(session);
      await updateRunningSession(buildSession("session_running_fallback", "running"));

      const loaded = await loadSession(session.id);
      const listed = await listSessions({ limit: 10 });

      expect(loaded?.id).toBe(session.id);
      expect(listed.map((item) => item.id)).toEqual(
        expect.arrayContaining(["session_fallback", "session_running_fallback"]),
      );

      await deleteSession(session.id);
      await expect(loadSession(session.id)).resolves.toBeUndefined();
    } finally {
      Object.defineProperty(globalThis, "indexedDB", {
        configurable: true,
        value: originalIndexedDb,
      });
      await resetSessionStoreForTests();
    }
  });

  it("serializes concurrent fallback writes so every record remains listed", async () => {
    const originalIndexedDb = globalThis.indexedDB;
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: undefined,
    });

    try {
      await Promise.all([
        saveSession(buildSession("session_fallback_a", "saved")),
        saveSession(buildSession("session_fallback_b", "saved")),
        saveSession(buildSession("session_fallback_c", "saved")),
      ]);

      const listed = await listSessions({ limit: 10 });
      expect(listed.map((item) => item.id)).toEqual(
        expect.arrayContaining([
          "session_fallback_a",
          "session_fallback_b",
          "session_fallback_c",
        ]),
      );
    } finally {
      Object.defineProperty(globalThis, "indexedDB", {
        configurable: true,
        value: originalIndexedDb,
      });
      await resetSessionStoreForTests();
    }
  });

  it("surfaces an invalidated extension context directly when fallback storage is stale", async () => {
    const originalIndexedDb = globalThis.indexedDB;
    const originalChrome = globalThis.chrome;
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: {
        storage: {
          local: {
            get: vi.fn(async () => {
              throw new Error("Extension context invalidated.");
            }),
            set: vi.fn(async () => {
              throw new Error("Extension context invalidated.");
            }),
            remove: vi.fn(async () => undefined),
          },
        },
      },
    });

    try {
      await expect(saveSession(buildSession("session_invalidated_fallback", "saved"))).rejects.toThrow(
        "Extension context invalidated",
      );
    } finally {
      Object.defineProperty(globalThis, "indexedDB", {
        configurable: true,
        value: originalIndexedDb,
      });
      if (typeof originalChrome === "undefined") {
        delete (globalThis as { chrome?: typeof chrome }).chrome;
      } else {
        Object.defineProperty(globalThis, "chrome", {
          configurable: true,
          value: originalChrome,
        });
      }
      await resetSessionStoreForTests();
    }
  });

  it("fails fast instead of entering fallback writes after context invalidation is known", async () => {
    const originalIndexedDb = globalThis.indexedDB;
    const originalChrome = globalThis.chrome;
    const storageGet = vi.fn(async () => ({}));
    const storageSet = vi.fn(async () => undefined);
    const storageRemove = vi.fn(async () => undefined);
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: {
        storage: {
          local: {
            get: storageGet,
            set: storageSet,
            remove: storageRemove,
          },
        },
      },
    });
    markExtensionContextInvalidated(
      new Error("Could not establish connection. Receiving end does not exist."),
    );

    try {
      await expect(saveSession(buildSession("session_known_invalidated", "saved"))).rejects.toThrow(
        "Extension context invalidated",
      );
      expect(storageGet).not.toHaveBeenCalled();
      expect(storageSet).not.toHaveBeenCalled();
      expect(storageRemove).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis, "indexedDB", {
        configurable: true,
        value: originalIndexedDb,
      });
      if (typeof originalChrome === "undefined") {
        delete (globalThis as { chrome?: typeof chrome }).chrome;
      } else {
        Object.defineProperty(globalThis, "chrome", {
          configurable: true,
          value: originalChrome,
        });
      }
      await resetSessionStoreForTests();
    }
  });

  it("deduplicates carry-over entries and strips speaker metadata during export", async () => {
    const session: SessionRecord = {
      ...buildSession("session_export_cleanup", "saved"),
      subtitleCount: 4,
      charCount: 0,
      entries: [
        {
          id: "entry_1",
          text: "늘 그 과정에서 문제를 제기하는 분들이 계십니다 그래서 제기되는 문제가 몇 가지가 있습니다",
          timestamp: "2026-03-10T09:00:01.000Z",
          startTime: "2026-03-10T09:00:01.000Z",
          endTime: "2026-03-10T09:00:01.000Z",
          sourceNodeKey: "row_1",
          speakerColor: "rgb(35, 124, 147)",
          speakerChannel: "primary",
        },
        {
          id: "entry_2",
          text: "알고 있습니다 그러면",
          timestamp: "2026-03-10T09:00:02.000Z",
          startTime: "2026-03-10T09:00:02.000Z",
          endTime: "2026-03-10T09:00:02.000Z",
          sourceNodeKey: "row_2",
        },
        {
          id: "entry_3",
          text: "늘 그 과정에서 문제를 제기하는 분들이 계십니다 그래서 제기되는 문제가 몇 가지가 있습니다",
          timestamp: "2026-03-10T09:00:03.000Z",
          startTime: "2026-03-10T09:00:03.000Z",
          endTime: "2026-03-10T09:00:03.000Z",
          sourceNodeKey: "row_3",
          speakerColor: "rgb(35, 124, 147)",
          speakerChannel: "primary",
          speakerChanged: true,
        },
        {
          id: "entry_4",
          text: "예 알고 있습니다 그러면 이것에 대해서 답을 해야 되는 것 같습니다",
          timestamp: "2026-03-10T09:00:04.000Z",
          startTime: "2026-03-10T09:00:04.000Z",
          endTime: "2026-03-10T09:00:04.000Z",
          sourceNodeKey: "row_2",
          speakerColor: "rgb(30, 30, 30)",
          speakerChannel: "secondary",
        },
      ],
    };

    const payload = await exportSessionData(session, "json");
    const parsed = JSON.parse(payload.content) as SessionRecord;

    expect(parsed.entries).toHaveLength(3);
    expect(parsed.entries.map((entry) => entry.text)).toEqual([
      "늘 그 과정에서 문제를 제기하는 분들이 계십니다 그래서 제기되는 문제가 몇 가지가 있습니다",
      "알고 있습니다 그러면",
      "예 알고 있습니다 그러면 이것에 대해서 답을 해야 되는 것 같습니다",
    ]);
    expect(parsed.entries[0].speakerColor).toBeUndefined();
    expect(parsed.entries[2].speakerChannel).toBeUndefined();
  });

  it("trims cumulative carry-over text in TXT export by default without timestamps", async () => {
    const session: SessionRecord = {
      ...buildSession("session_export_cumulative", "saved"),
      subtitleCount: 3,
      charCount: 0,
      entries: [
        {
          id: "entry_1",
          text: "결손보전 재원을 회계 세입세출 결산에 따른 잉여금으로 수정하였습니다",
          timestamp: "2026-03-10T09:00:01.000Z",
          startTime: "2026-03-10T09:00:01.000Z",
          endTime: "2026-03-10T09:00:01.000Z",
          sourceNodeKey: "row_1",
        },
        {
          id: "entry_2",
          text: "결손보전 재원을 회계 세입세출 결산에 따른 잉여금으로 수정하였습니다 이상으로 정보통신방송법안심사소위원회의 심사 결과를 보고드렸습니다",
          timestamp: "2026-03-10T09:00:02.000Z",
          startTime: "2026-03-10T09:00:02.000Z",
          endTime: "2026-03-10T09:00:02.000Z",
          sourceNodeKey: "row_2",
        },
        {
          id: "entry_3",
          text: "결손보전 재원을 회계 세입세출 결산에 따른 잉여금으로 수정하였습니다 이상으로 정보통신방송법안심사소위원회의 심사 결과를 보고드렸습니다 보다 자세한 내용은 단말기의 의결안을 참고해 주시기 바랍니다",
          timestamp: "2026-03-10T09:00:03.000Z",
          startTime: "2026-03-10T09:00:03.000Z",
          endTime: "2026-03-10T09:00:03.000Z",
          sourceNodeKey: "row_3",
        },
      ],
    };

    const payload = await exportSessionData(session, "txt");

    expect(payload.content).toBe(
      [
        "결손보전 재원을 회계 세입세출 결산에 따른 잉여금으로 수정하였습니다",
        "이상으로 정보통신방송법안심사소위원회의 심사 결과를 보고드렸습니다",
        "보다 자세한 내용은 단말기의 의결안을 참고해 주시기 바랍니다",
      ].join("\n"),
    );
  });

  it("includes timestamps in TXT export when explicitly enabled", async () => {
    const session: SessionRecord = {
      ...buildSession("session_export_with_timestamps", "saved"),
      subtitleCount: 2,
      charCount: 0,
      entries: [
        {
          id: "entry_1",
          text: "첫 번째 줄",
          timestamp: "2026-03-10T09:00:01.000Z",
          startTime: "2026-03-10T09:00:01.000Z",
          endTime: "2026-03-10T09:00:01.000Z",
        },
        {
          id: "entry_2",
          text: "완전히 다른 두 번째 줄",
          timestamp: "2026-03-10T09:00:02.000Z",
          startTime: "2026-03-10T09:00:02.000Z",
          endTime: "2026-03-10T09:00:02.000Z",
        },
      ],
    };

    const payload = await exportSessionData(session, "txt", {
      txtExportTimestampsEnabled: true,
    });

    expect(payload.content).toBe(
      ["[18:00:01] 첫 번째 줄", "[18:00:02] 완전히 다른 두 번째 줄"].join("\n"),
    );
  });

  it("normalizes cumulative carry-over text when persisting sessions", async () => {
    await saveSession({
      ...buildSession("session_persist_normalized", "saved"),
      subtitleCount: 3,
      charCount: 0,
      entries: [
        {
          id: "entry_1",
          text: "위원님 말씀드렸는데요 이번 내년 예산 편성 과정에서 잘 살펴서",
          timestamp: "2026-03-10T09:00:01.000Z",
          startTime: "2026-03-10T09:00:01.000Z",
          endTime: "2026-03-10T09:00:01.000Z",
          sourceNodeKey: "row_1",
        },
        {
          id: "entry_2",
          text: "위원님 말씀드렸는데요 이번 내년 예산 편성 과정에서 잘 살펴서 저희가 방법을 찾아보겠습니다",
          timestamp: "2026-03-10T09:00:02.000Z",
          startTime: "2026-03-10T09:00:02.000Z",
          endTime: "2026-03-10T09:00:02.000Z",
          sourceNodeKey: "row_2",
        },
        {
          id: "entry_3",
          text: "위원님 말씀드렸는데요 이번 내년 예산 편성 과정에서 잘 살펴서 저희가 방법을 찾아보겠습니다 추가 설명도 드리겠습니다",
          timestamp: "2026-03-10T09:00:03.000Z",
          startTime: "2026-03-10T09:00:03.000Z",
          endTime: "2026-03-10T09:00:03.000Z",
          sourceNodeKey: "row_3",
        },
      ],
    });

    const loaded = await loadSession("session_persist_normalized");

    expect(loaded?.entries.map((entry) => entry.text)).toEqual([
      "위원님 말씀드렸는데요 이번 내년 예산 편성 과정에서 잘 살펴서",
      "저희가 방법을 찾아보겠습니다",
      "추가 설명도 드리겠습니다",
    ]);
  });

  it("prefers the fresher fallback copy when IndexedDB and fallback diverge", async () => {
    await saveSession(buildSession("session_union", "saved"));
    await new Promise((resolve) => setTimeout(resolve, 5));

    const originalIndexedDb = globalThis.indexedDB;
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: undefined,
    });

    try {
      await saveSession({
        ...buildSession("session_union", "saved"),
        title: "최신 fallback 제목",
      });
    } finally {
      Object.defineProperty(globalThis, "indexedDB", {
        configurable: true,
        value: originalIndexedDb,
      });
    }

    const loaded = await loadSession("session_union");
    const listed = await listSessions({ limit: 10 });

    expect(loaded?.title).toBe("최신 fallback 제목");
    expect(listed.find((item) => item.id === "session_union")?.title).toBe("최신 fallback 제목");
  });

  it("keeps IndexedDB usable after a transient write failure and heals fallback on later success", async () => {
    const putSpy = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementationOnce(() => {
        throw new Error("Transient put failure");
      });

    await saveSession(buildSession("session_heal", "saved"));
    putSpy.mockRestore();

    await saveSession({
      ...buildSession("session_heal", "saved"),
      title: "IndexedDB 최신본",
    });

    const loaded = await loadSession("session_heal");
    expect(loaded?.title).toBe("IndexedDB 최신본");

    const originalIndexedDb = globalThis.indexedDB;
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: undefined,
    });

    try {
      await expect(loadSession("session_heal")).resolves.toBeUndefined();
    } finally {
      Object.defineProperty(globalThis, "indexedDB", {
        configurable: true,
        value: originalIndexedDb,
      });
    }
  });

  it("falls back during import when a transient IndexedDB write fails", async () => {
    const originalPut = IDBObjectStore.prototype.put;
    const putSpy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
      value,
    ) {
      const record = value as SessionRecord;
      if (record.id === "session_import_fail") {
        throw new Error("Intentional import failure");
      }
      return originalPut.call(this, value);
    });

    const summary = await importSessionRecords([
      buildSession("session_import_ok", "saved"),
      buildSession("session_import_fail", "saved"),
    ]);

    putSpy.mockRestore();

    expect(summary).toEqual({
      addedCount: 2,
      updatedCount: 0,
      keptCount: 0,
      failedCount: 0,
    });
    expect((await loadSession("session_import_ok"))?.id).toBe("session_import_ok");
    expect((await loadSession("session_import_fail"))?.id).toBe("session_import_fail");
  });

  it("loads only the requested session ids through the targeted helper", async () => {
    await saveSession(buildSession("session_existing_a", "saved"));
    await saveSession(buildSession("session_existing_b", "saved"));

    const loaded = await loadSessionsByIds(["session_existing_a", "session_missing"]);

    expect(loaded.map((session) => session.id)).toEqual(["session_existing_a"]);
  });

  it("keeps starred sessions eligible even when a small limit is requested", async () => {
    await saveSession({
      ...buildSession("session_starred_old", "saved"),
      starred: true,
      pinnedAt: "2026-03-10T09:00:00.000Z",
      updatedAt: "2026-03-10T09:00:00.000Z",
    });
    await saveSession({
      ...buildSession("session_recent", "saved"),
      updatedAt: "2026-03-10T10:00:00.000Z",
    });

    const listed = await listSessions({ limit: 1 });
    expect(listed.map((item) => item.id)).toEqual(["session_starred_old"]);
  });

  it("imports fresher records and preserves newer existing records", async () => {
    await importSessionRecords([
      {
        ...buildSession("session_import", "saved"),
        updatedAt: "2026-03-10T09:00:04.000Z",
        note: "기존 메모",
      },
      {
        ...buildSession("session_keep", "saved"),
        updatedAt: "2026-03-10T09:10:00.000Z",
        note: "기존 최신 keep",
      },
    ]);

    const summary = await importSessionRecords([
      {
        ...buildSession("session_import", "saved"),
        updatedAt: "2026-03-10T09:05:00.000Z",
        note: "가져온 최신 메모",
        starred: true,
        pinnedAt: "2026-03-10T09:05:00.000Z",
      },
      {
        ...buildSession("session_keep", "saved"),
        updatedAt: "2026-03-10T09:03:00.000Z",
        note: "가져온 오래된 keep",
      },
    ]);

    const loadedImport = await loadSession("session_import");
    const loadedKeep = await loadSession("session_keep");

    expect(summary).toEqual({
      addedCount: 0,
      updatedCount: 1,
      keptCount: 1,
      failedCount: 0,
    });
    expect(loadedImport?.note).toBe("가져온 최신 메모");
    expect(loadedImport?.starred).toBe(true);
    expect(loadedKeep?.updatedAt).toBe("2026-03-10T09:10:00.000Z");
    expect(loadedKeep?.note).toBe("기존 최신 keep");
  });

  it("keeps the newer existing record when importing an older duplicate", async () => {
    await saveSession({
      ...buildSession("session_keep_newer", "saved"),
      updatedAt: "2026-03-10T09:10:00.000Z",
      note: "기존 최신본",
    });

    const summary = await importSessionRecords([
      {
        ...buildSession("session_keep_newer", "saved"),
        updatedAt: "2026-03-10T09:03:00.000Z",
        note: "오래된 가져오기",
      },
    ]);
    const loaded = await loadSession("session_keep_newer");

    expect(summary).toEqual({
      addedCount: 0,
      updatedCount: 0,
      keptCount: 1,
      failedCount: 0,
    });
    expect(loaded?.note).toBe("기존 최신본");
  });

  it("reports import progress and returns a partial summary when cancelled mid-write", async () => {
    const controller = new AbortController();
    const progress: Array<{ phase: string; completed: number; total: number }> = [];

    let cancelledError: unknown;
    try {
      await importSessionRecords(
        [
          buildSession("session_import_cancel_a", "saved"),
          buildSession("session_import_cancel_b", "saved"),
        ],
        {
          signal: controller.signal,
          onProgress: (next) => {
            progress.push({
              phase: next.phase,
              completed: next.completed,
              total: next.total,
            });
            if (next.phase === "write" && next.completed === 1) {
              controller.abort();
            }
          },
        },
      );
    } catch (error) {
      cancelledError = error;
    }

    expect(cancelledError).toMatchObject({
      name: "AbortError",
      message: "JSON 가져오기를 취소했습니다.",
      summary: {
        addedCount: 1,
        updatedCount: 0,
        keptCount: 0,
        failedCount: 0,
      },
    });
    expect(progress).toEqual(
      expect.arrayContaining([
        { phase: "sanitize", completed: 1, total: 2 },
        { phase: "sanitize", completed: 2, total: 2 },
        { phase: "compare", completed: 0, total: 2 },
        { phase: "write", completed: 0, total: 2 },
        { phase: "write", completed: 1, total: 2 },
      ]),
    );
    expect((await loadSession("session_import_cancel_a"))?.id).toBe("session_import_cancel_a");
    await expect(loadSession("session_import_cancel_b")).resolves.toBeUndefined();
  });

  it("exports selected entries without changing session-relative SRT timestamps", async () => {
    const session: SessionRecord = {
      ...buildSession("session_partial_export", "saved"),
      subtitleCount: 3,
      charCount: 0,
      entries: [
        {
          id: "entry_1",
          text: "첫 번째 자막",
          timestamp: "2026-03-10T09:00:01.000Z",
          startTime: "2026-03-10T09:00:01.000Z",
          endTime: "2026-03-10T09:00:02.000Z",
        },
        {
          id: "entry_2",
          text: "두 번째 자막",
          timestamp: "2026-03-10T09:00:05.000Z",
          startTime: "2026-03-10T09:00:05.000Z",
          endTime: "2026-03-10T09:00:06.000Z",
        },
        {
          id: "entry_3",
          text: "세 번째 자막",
          timestamp: "2026-03-10T09:00:09.000Z",
          startTime: "2026-03-10T09:00:09.000Z",
          endTime: "2026-03-10T09:00:10.000Z",
        },
      ],
    };

    const payload = await exportSessionData(session, "srt", {
      entries: [session.entries[1]],
    });

    expect(payload.content).toBe("1\n00:00:05,000 --> 00:00:06,000\n두 번째 자막");
  });

  it("closes running sessions across IndexedDB and fallback backends with unique counting", async () => {
    await updateRunningSession(buildSession("session_idb_only", "running"));

    const originalIndexedDb = globalThis.indexedDB;
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: undefined,
    });

    try {
      await updateRunningSession(buildSession("session_fallback_only", "running"));
      await updateRunningSession(buildSession("session_shared", "running"));
    } finally {
      Object.defineProperty(globalThis, "indexedDB", {
        configurable: true,
        value: originalIndexedDb,
      });
    }

    await updateRunningSession(buildSession("session_shared", "running"));

    const summary = await closeRunningSessionsOnStartup();
    expect(summary).toEqual({
      detectedCount: 3,
      closedCount: 3,
      failedCount: 0,
    });

    expect((await loadSession("session_idb_only"))?.status).toBe("stopped");
    expect((await loadSession("session_shared"))?.status).toBe("stopped");

    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: undefined,
    });

    try {
      expect((await loadSession("session_fallback_only"))?.status).toBe("stopped");
      await expect(loadSession("session_shared")).resolves.toBeUndefined();
    } finally {
      Object.defineProperty(globalThis, "indexedDB", {
        configurable: true,
        value: originalIndexedDb,
      });
    }
  });

  it("reports startup cleanup failures when IndexedDB running-session writes fail", async () => {
    await updateRunningSession(buildSession("session_cleanup_fail", "running"));

    const putSpy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(() => {
      throw new Error("Intentional cleanup write failure");
    });
    const summary = await closeRunningSessionsOnStartup();
    putSpy.mockRestore();

    expect(summary).toEqual({
      detectedCount: 1,
      closedCount: 0,
      failedCount: 1,
    });
    expect((await loadSession("session_cleanup_fail"))?.status).toBe("running");
  });

  it("builds a session-library overview without preloading every record into the view layer", async () => {
    await saveSession({
      ...buildSession("session_overview_a", "saved"),
      updatedAt: "2026-03-10T09:00:01.000Z",
    });
    await saveSession({
      ...buildSession("session_overview_b", "saved"),
      updatedAt: "2026-03-10T09:00:02.000Z",
    });
    await saveSession({
      ...buildSession("session_overview_c", "saved"),
      updatedAt: "2026-03-10T09:00:03.000Z",
    });
    await saveSession({
      ...buildSession("session_overview_d", "saved"),
      updatedAt: "2026-03-10T09:00:04.000Z",
    });

    const overview = await getSessionLibraryOverview(3);

    expect(overview.totalCount).toBe(4);
    expect(overview.previewSessions).toHaveLength(3);
    expect(overview.previewSessions[0]?.id).toBe("session_overview_d");
  });

  it("builds a full-library backup export payload", async () => {
    await saveSession(buildSession("session_backup_a", "saved"));
    await saveSession(buildSession("session_backup_b", "saved"));

    const backup = await buildSessionLibraryBackupExport();
    const parsed = JSON.parse(backup.payload.content) as { sessions: SessionRecord[] };

    expect(backup.sessionCount).toBe(2);
    expect(backup.payload.filename.endsWith(".json")).toBe(true);
    expect(parsed.sessions).toHaveLength(2);
  });

  it("reports backup progress and honors cancellation during page-wise packaging", async () => {
    await saveSession(buildSession("session_backup_progress_a", "saved"));
    await saveSession(buildSession("session_backup_progress_b", "saved"));

    const progress: Array<{ phase: string; completed: number; total: number }> = [];
    const controller = new AbortController();

    await expect(
      buildSessionLibraryBackupExport({
        pageSize: 1,
        signal: controller.signal,
        onProgress: (next) => {
          progress.push({
            phase: next.phase,
            completed: next.completed,
            total: next.total,
          });
          if (next.phase === "package" && next.completed === 1) {
            controller.abort();
          }
        },
      }),
    ).rejects.toMatchObject({
      name: "AbortError",
      message: "전체 JSON 백업을 취소했습니다.",
    });

    expect(progress).toEqual(
      expect.arrayContaining([
        { phase: "prepare", completed: 0, total: 0 },
        { phase: "package", completed: 0, total: 0 },
        { phase: "package", completed: 1, total: 2 },
      ]),
    );
  });

  it("honors cancellation during incremental backup packaging", async () => {
    await saveSession(buildSession("session_backup_package_a", "saved"));
    await saveSession(buildSession("session_backup_package_b", "saved"));

    const progress: Array<{ phase: string; completed: number; total: number }> = [];
    const controller = new AbortController();

    await expect(
      buildSessionLibraryBackupExport({
        signal: controller.signal,
        onProgress: (next) => {
          progress.push({
            phase: next.phase,
            completed: next.completed,
            total: next.total,
          });
          if (next.phase === "package" && next.completed === 1) {
            controller.abort();
          }
        },
      }),
    ).rejects.toMatchObject({
      name: "AbortError",
      message: "전체 JSON 백업을 취소했습니다.",
    });

    expect(progress).toEqual(
      expect.arrayContaining([
        { phase: "prepare", completed: 0, total: 0 },
        { phase: "package", completed: 0, total: 0 },
        { phase: "package", completed: 1, total: 2 },
      ]),
    );
  });

  it("fails fast when a full-library backup exceeds 25 MiB", async () => {
    const oversizedText = "a".repeat(SESSION_LIBRARY_TRANSFER_LIMIT_BYTES + 1024);

    await saveSession({
      ...buildSession("session_backup_oversized", "saved"),
      subtitleCount: 1,
      charCount: oversizedText.length,
      entries: [
        {
          id: "session_backup_oversized_entry",
          text: oversizedText,
          timestamp: "2026-03-10T09:00:00.000Z",
          startTime: "2026-03-10T09:00:00.000Z",
          endTime: "2026-03-10T09:00:02.000Z",
        },
      ],
    });

    await expect(buildSessionLibraryBackupExport()).rejects.toThrow(
      "전체 JSON 백업 작업은 25 MiB 이하에서만 지원합니다.",
    );
  });

  it("deletes all persisted sessions across IndexedDB and fallback storage", async () => {
    await saveSession(buildSession("session_idb_saved", "saved"));

    const originalIndexedDb = globalThis.indexedDB;
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: undefined,
    });

    try {
      await saveSession(buildSession("session_fallback_saved", "saved"));
    } finally {
      Object.defineProperty(globalThis, "indexedDB", {
        configurable: true,
        value: originalIndexedDb,
      });
    }

    await deleteAllSessions();

    await expect(listSessions({ limit: 10 })).resolves.toEqual([]);
    await expect(loadSession("session_idb_saved")).resolves.toBeUndefined();

    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: undefined,
    });

    try {
      await expect(loadSession("session_fallback_saved")).resolves.toBeUndefined();
    } finally {
      Object.defineProperty(globalThis, "indexedDB", {
        configurable: true,
        value: originalIndexedDb,
      });
    }
  });

  it("still clears fallback storage when IndexedDB delete-all fails with an actual error", async () => {
    await saveSession(buildSession("session_idb_saved", "saved"));

    const originalIndexedDb = globalThis.indexedDB;
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: undefined,
    });

    try {
      await saveSession(buildSession("session_fallback_saved", "saved"));
    } finally {
      Object.defineProperty(globalThis, "indexedDB", {
        configurable: true,
        value: originalIndexedDb,
      });
    }

    const clearSpy = vi.spyOn(IDBObjectStore.prototype, "clear").mockImplementationOnce(() => {
      throw new Error("Intentional clear failure");
    });

    await expect(deleteAllSessions()).rejects.toThrow("IndexedDB 정리 실패:");
    clearSpy.mockRestore();

    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: undefined,
    });

    try {
      await expect(loadSession("session_fallback_saved")).resolves.toBeUndefined();
    } finally {
      Object.defineProperty(globalThis, "indexedDB", {
        configurable: true,
        value: originalIndexedDb,
      });
    }
  });
});
