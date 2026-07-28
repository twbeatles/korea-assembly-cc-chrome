import type { SessionRecord } from "../src/core/subtitle-models";
import {
  markExtensionContextInvalidated,
  resetExtensionContextInvalidationForTests,
} from "../src/shared/extension-context";
import { SESSION_DB_NAME } from "../src/shared/constants";
import { queueExitPersistRecord } from "../src/storage/persist-recovery";
import {
  buildSessionLibraryBackupExport,
  closeRunningSessionsOnStartup,
  deleteAllSessions,
  deleteSession,
  exportSessionData,
  exportSessionLineageData,
  getSessionLibraryOverview,
  importSessionRecords,
  listSessions,
  listSessionLineagesPage,
  listSessionLineageSegments,
  listSessionsPage,
  loadSessionsByIds,
  loadSession,
  replayQueuedExitPersistRecords,
  resetSessionStoreForTests,
  saveSession,
  searchSessionLineagesPage,
  searchSessions,
  SESSION_NOTE_MAX_LENGTH,
  updateSessionContent,
  updateSessionMetadata,
  updateSessionLineageMetadata,
  upsertSessionRecord,
  updateRunningSession,
} from "../src/storage/session-store";
import { SESSION_LIBRARY_TRANSFER_LIMIT_BYTES } from "../src/storage/session-backup";
import {
  buildSessionEntryChunkKey,
  SESSION_ENTRY_CHUNK_STORE_NAME,
} from "../src/storage/session-store/entry-chunks";

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

function deleteIndexedDbEntryChunk(sessionId: string, chunkIndex: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(SESSION_DB_NAME);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction(SESSION_ENTRY_CHUNK_STORE_NAME, "readwrite");
      transaction.objectStore(SESSION_ENTRY_CHUNK_STORE_NAME).delete(
        buildSessionEntryChunkKey(sessionId, chunkIndex),
      );
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error ?? new Error("IndexedDB transaction failed"));
      };
      transaction.onabort = () => {
        db.close();
        reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
      };
    };
  });
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
    expect(loaded?.version).toBe("4");
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

  it("normalizes lineage metadata and lists segments in lineage order", async () => {
    await saveSession(buildSession("session_standalone", "saved"));
    await saveSession({
      ...buildSession("session_segment_2", "saved"),
      lineageId: "lineage_alpha",
      segmentNumber: 2,
      startedAt: "2026-03-10T09:10:00.000Z",
      updatedAt: "2026-03-10T09:12:00.000Z",
    });
    await saveSession({
      ...buildSession("session_segment_1", "saved"),
      lineageId: "lineage_alpha",
      segmentNumber: 1,
      startedAt: "2026-03-10T09:00:00.000Z",
      updatedAt: "2026-03-10T09:05:00.000Z",
    });

    const standalone = await loadSession("session_standalone");
    const segments = await listSessionLineageSegments("lineage_alpha");

    expect(standalone?.lineageId).toBe("session_standalone");
    expect(standalone?.segmentNumber).toBe(1);
    expect(segments.map((session) => session.id)).toEqual([
      "session_segment_1",
      "session_segment_2",
    ]);
  });

  it("lists lineage segments without hydrating unrelated session bodies", async () => {
    await saveSession({
      ...buildSession("session_target_segment", "saved"),
      lineageId: "lineage_target",
      segmentNumber: 1,
    });
    await saveSession({
      ...buildSession("session_unrelated_broken", "saved"),
      lineageId: "lineage_unrelated",
      segmentNumber: 1,
    });
    await deleteIndexedDbEntryChunk("session_unrelated_broken", 0);

    const segments = await listSessionLineageSegments("lineage_target");

    expect(segments.map((session) => session.id)).toEqual(["session_target_segment"]);
    expect(segments[0]?.entries).toHaveLength(1);
  });

  it("lists and updates sessions by lineage summary", async () => {
    await saveSession({
      ...buildSession("lineage_summary_1", "saved"),
      lineageId: "lineage_summary",
      segmentNumber: 1,
      subtitleCount: 1,
      charCount: 8,
    });
    await saveSession({
      ...buildSession("lineage_summary_2", "saved"),
      lineageId: "lineage_summary",
      segmentNumber: 2,
      startedAt: "2026-03-10T09:10:00.000Z",
      updatedAt: "2026-03-10T09:12:00.000Z",
      subtitleCount: 1,
      charCount: 8,
    });

    const page = await listSessionLineagesPage({ page: 1, pageSize: 20 });
    const summary = page.lineages.find((lineage) => lineage.lineageId === "lineage_summary");

    expect(summary?.segmentCount).toBe(2);
    expect(summary?.subtitleCount).toBe(2);
    expect(summary?.sessionIds).toEqual(["lineage_summary_1", "lineage_summary_2"]);
    expect(summary?.representativeSession.entries).toEqual([]);
    expect(summary?.representativeSession.subtitleCount).toBe(1);

    await updateSessionLineageMetadata("lineage_summary", {
      starred: true,
      note: "회의 전체 메모",
    });
    const updatedSegments = await listSessionLineageSegments("lineage_summary");

    expect(updatedSegments.every((session) => session.starred)).toBe(true);
    expect(updatedSegments.every((session) => session.note === "회의 전체 메모")).toBe(true);
  });

  it("lists fallback lineage summaries without hydrating session bodies", async () => {
    const originalIndexedDb = globalThis.indexedDB;
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: undefined,
    });

    try {
      await saveSession({
        ...buildSession("fallback_lineage_segment", "saved"),
        lineageId: "fallback_lineage",
        segmentNumber: 1,
      });
    } finally {
      Object.defineProperty(globalThis, "indexedDB", {
        configurable: true,
        value: originalIndexedDb,
      });
    }

    const page = await listSessionLineagesPage({ page: 1, pageSize: 20 });
    const summary = page.lineages.find((lineage) => lineage.lineageId === "fallback_lineage");

    expect(summary?.representativeSession.entries).toEqual([]);
    expect(summary?.subtitleCount).toBe(1);
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

  it("clamps oversized session notes to the configured maximum length", async () => {
    const session = buildSession("session_with_long_note", "saved");
    const oversizedNote = "메".repeat(SESSION_NOTE_MAX_LENGTH + 256);

    await upsertSessionRecord({
      ...session,
      note: oversizedNote,
    });

    const loaded = await loadSession(session.id);
    expect(loaded?.note.length).toBe(SESSION_NOTE_MAX_LENGTH);

    const overlongPatch = "수".repeat(SESSION_NOTE_MAX_LENGTH + 64);
    const updated = await updateSessionMetadata(session.id, { note: overlongPatch });

    expect(updated.note.length).toBe(SESSION_NOTE_MAX_LENGTH);
  });

  it("keeps near-duplicate entries on save (carry-over dedupe is export-only)", async () => {
    const baseTime = "2026-03-10T09:00:00.000Z";
    const session = {
      ...buildSession("session_near_duplicate_keep", "saved"),
      entries: [
        {
          id: "dup_1",
          text: "같은 문장을 반복합니다 충분히 길게",
          timestamp: baseTime,
          startTime: baseTime,
          endTime: "2026-03-10T09:00:01.000Z",
          sourceNodeKey: "row_1",
        },
        {
          id: "dup_2",
          text: "같은 문장을 반복합니다 충분히 길게",
          timestamp: "2026-03-10T09:00:02.000Z",
          startTime: "2026-03-10T09:00:02.000Z",
          endTime: "2026-03-10T09:00:03.000Z",
          sourceNodeKey: "row_1",
        },
      ],
      subtitleCount: 2,
      charCount: 36,
    };

    await saveSession(session);
    const loaded = await loadSession(session.id);
    expect(loaded?.entries).toHaveLength(2);
    expect(loaded?.subtitleCount).toBe(2);
  });

  it("serializes concurrent metadata and content updates without losing either change", async () => {
    const session = buildSession("session_concurrent_patch", "saved");
    await saveSession(session);

    const [meta, content] = await Promise.all([
      updateSessionMetadata(session.id, {
        starred: true,
        note: "동시 메모",
      }),
      updateSessionContent(session.id, {
        entries: [
          {
            id: "patched_entry",
            text: "편집된 자막",
            timestamp: "2026-03-10T09:00:00.000Z",
            startTime: "2026-03-10T09:00:00.000Z",
            endTime: "2026-03-10T09:00:01.000Z",
          },
        ],
      }),
    ]);

    const loaded = await loadSession(session.id);
    expect(loaded?.starred ?? meta.starred).toBe(true);
    expect(loaded?.note === "동시 메모" || meta.note === "동시 메모").toBe(true);
    expect(
      loaded?.entries.some((entry) => entry.text === "편집된 자막") ||
        content.entries.some((entry) => entry.text === "편집된 자막"),
    ).toBe(true);
    // 직렬화 후 최종 스냅샷은 두 패치가 모두 반영된 최신 load 결과
    expect(loaded?.entries).toHaveLength(1);
    expect(loaded?.entries[0]?.text).toBe("편집된 자막");
    expect(loaded?.starred).toBe(true);
    expect(loaded?.note).toBe("동시 메모");
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
    expect(firstPage.sessions.every((session) => session.entries.length === 0)).toBe(true);
    expect(firstPage.sessions[0]?.subtitleCount).toBe(1);
    await expect(loadSession("session_page_3")).resolves.toMatchObject({
      id: "session_page_3",
      entries: expect.arrayContaining([expect.objectContaining({ id: expect.any(String) })]),
    });
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
    expect(page.sessions.every((session) => session.entries.length === 0)).toBe(true);
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

    expect(loaded?.version).toBe("4");
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

  it("preserves imported user metadata through storage", async () => {
    await importSessionRecords([
      {
        ...buildSession("session_import_metadata", "saved"),
        tags: ["예산", "속기"],
        category: "회의록",
        speakerLabels: { primary: "위원장" },
        qualityStats: {
          health: "good",
          entryCount: 1,
          charCount: 8,
          estimatedBytes: 512,
          fallbackOnly: false,
          lastComputedAt: "2026-03-10T09:02:00.000Z",
        },
      },
    ]);

    const loaded = await loadSession("session_import_metadata");

    expect(loaded?.tags).toEqual(["예산", "속기"]);
    expect(loaded?.category).toBe("회의록");
    expect(loaded?.speakerLabels?.primary).toBe("위원장");
    expect(loaded?.qualityStats?.health).toBe("good");
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
    markExtensionContextInvalidated(new Error("Extension context invalidated."));

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

  it("exports a full lineage as a merged session in segment order", async () => {
    await saveSession({
      ...buildSession("lineage_export", "saved"),
      title: "국회 본회의",
      committeeName: "정무위원회",
      lineageId: "lineage_export",
      segmentNumber: 1,
      entries: [
        {
          id: "entry_segment_1",
          text: "첫 번째 세그먼트",
          timestamp: "2026-03-10T09:00:01.000Z",
          startTime: "2026-03-10T09:00:01.000Z",
          endTime: "2026-03-10T09:00:02.000Z",
        },
      ],
      subtitleCount: 1,
      charCount: 8,
    });
    await saveSession({
      ...buildSession("lineage_export_segment_2", "saved"),
      title: "국회 본회의",
      committeeName: "정무위원회",
      startedAt: "2026-03-10T09:10:00.000Z",
      endedAt: "2026-03-10T09:12:00.000Z",
      createdAt: "2026-03-10T09:10:00.000Z",
      updatedAt: "2026-03-10T09:12:00.000Z",
      lineageId: "lineage_export",
      segmentNumber: 2,
      entries: [
        {
          id: "entry_segment_2",
          text: "두 번째 세그먼트",
          timestamp: "2026-03-10T09:11:00.000Z",
          startTime: "2026-03-10T09:11:00.000Z",
          endTime: "2026-03-10T09:11:02.000Z",
        },
      ],
      subtitleCount: 1,
      charCount: 8,
    });

    const payload = await exportSessionLineageData("lineage_export", "json");
    const parsed = JSON.parse(payload.content) as SessionRecord;

    expect(parsed.id).toBe("lineage_export");
    expect(parsed.entries.map((entry) => entry.id)).toEqual([
      "entry_segment_1",
      "entry_segment_2",
    ]);
    expect(parsed.subtitleCount).toBe(2);
  });

  it("preserves cumulative carry-over text when persisting, but trims it on export", async () => {
    const entries = [
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
    ];

    await saveSession({
      ...buildSession("session_persist_normalized", "saved"),
      subtitleCount: 3,
      charCount: 0,
      entries,
    });

    const loaded = await loadSession("session_persist_normalized");

    // 저장 경로에서는 carry-over 원문을 보존한다.
    expect(loaded?.entries.map((entry) => entry.text)).toEqual([
      "위원님 말씀드렸는데요 이번 내년 예산 편성 과정에서 잘 살펴서",
      "위원님 말씀드렸는데요 이번 내년 예산 편성 과정에서 잘 살펴서 저희가 방법을 찾아보겠습니다",
      "위원님 말씀드렸는데요 이번 내년 예산 편성 과정에서 잘 살펴서 저희가 방법을 찾아보겠습니다 추가 설명도 드리겠습니다",
    ]);

    // export 직전 정규화에서만 incremental 형태로 정리한다.
    const exported = await exportSessionData(loaded!, "txt");
    expect(exported.content).toContain("저희가 방법을 찾아보겠습니다");
    expect(exported.content).toContain("추가 설명도 드리겠습니다");
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
    expect(parsed.sessions.every((session) => session.entries.length > 0)).toBe(true);
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
    // 단일 entry 텍스트는 저장 sanitize 상한이 있어, 다수 entry로 25 MiB를 넘긴다.
    const chunkText = "a".repeat(40_000);
    const entryCount = Math.ceil((SESSION_LIBRARY_TRANSFER_LIMIT_BYTES + 1024) / chunkText.length);
    const entries = Array.from({ length: entryCount }, (_, index) => ({
      id: `session_backup_oversized_entry_${index}`,
      text: chunkText,
      timestamp: "2026-03-10T09:00:00.000Z",
      startTime: "2026-03-10T09:00:00.000Z",
      endTime: "2026-03-10T09:00:02.000Z",
    }));

    await saveSession({
      ...buildSession("session_backup_oversized", "saved"),
      subtitleCount: entries.length,
      charCount: chunkText.length * entries.length,
      entries,
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

  it("searches sessions across title, metadata, tags, categories, and entry text", async () => {
    await saveSession({
      ...buildSession("session_search", "saved"),
      title: "예산 결산",
      note: "추경 관련 메모",
      tags: ["예산", "추경"],
      category: "재정",
      entries: [
        {
          ...buildSession("session_search", "saved").entries[0],
          text: "국가 재정과 민생 지원을 논의합니다.",
        },
      ],
    });

    const result = await searchSessions({
      query: "민생",
      tag: "예산",
      category: "재정",
      page: 1,
      pageSize: 10,
    });

    expect(result.totalCount).toBe(1);
    expect(result.results[0]).toMatchObject({
      matchCount: 1,
      firstHit: {
        field: "entry",
        text: "국가 재정과 민생 지원을 논의합니다.",
      },
    });
  });

  it("returns lineage-first search results across matching segments", async () => {
    await saveSession({
      ...buildSession("lineage_search_segment_1", "saved"),
      lineageId: "lineage_search",
      segmentNumber: 1,
      tags: ["예산"],
      category: "재정",
      entries: [
        {
          ...buildSession("lineage_search_segment_1", "saved").entries[0],
          text: "민생 예산 질의",
          highlighted: true,
        },
      ],
    });
    await saveSession({
      ...buildSession("lineage_search_segment_2", "saved"),
      lineageId: "lineage_search",
      segmentNumber: 2,
      tags: ["예산"],
      category: "재정",
      entries: [
        {
          ...buildSession("lineage_search_segment_2", "saved").entries[0],
          text: "후속 발언",
        },
      ],
    });
    await saveSession({
      ...buildSession("lineage_search_other", "saved"),
      lineageId: "lineage_other",
      tags: ["운영"],
      category: "기타",
    });

    const page = await searchSessionLineagesPage({
      query: "민생",
      tag: "예산",
      category: "재정",
      highlightedOnly: true,
      page: 1,
      pageSize: 10,
    });

    expect(page.totalCount).toBe(1);
    expect(page.lineages[0]?.lineageId).toBe("lineage_search");
    expect(page.lineages[0]?.sessionIds).toEqual(["lineage_search_segment_1"]);
  });

  it("updates session metadata and content while preserving original entry text", async () => {
    const session = await saveSession(buildSession("session_content", "saved"));
    const updated = await updateSessionContent(session.id, {
      tags: ["중요"],
      category: "검토",
      speakerLabels: { primary: "위원장" },
      entries: [
        {
          ...session.entries[0],
          originalText: session.entries[0].text,
          text: "수정한 자막",
          highlighted: true,
          entryNote: "확인 필요",
        },
      ],
    });

    expect(updated.tags).toEqual(["중요"]);
    expect(updated.category).toBe("검토");
    expect(updated.speakerLabels?.primary).toBe("위원장");
    expect(updated.entries[0]).toMatchObject({
      originalText: "테스트 자막",
      text: "수정한 자막",
      highlighted: true,
      entryNote: "확인 필요",
    });
    expect(updated.subtitleCount).toBe(1);
    expect(updated.charCount).toBe("수정한 자막".length);
  });

  it("keeps note and starred when running autosave races with metadata updates", async () => {
    const base = buildSession("session_race_meta", "running");
    await updateRunningSession(base);

    const runningWrites = Array.from({ length: 8 }, (_, index) =>
      updateRunningSession({
        ...base,
        entries: [
          ...base.entries,
          {
            id: `session_race_meta_entry_${index}`,
            text: `추가 자막 ${index}`,
            timestamp: "2026-03-10T09:00:03.000Z",
            startTime: "2026-03-10T09:00:03.000Z",
            endTime: "2026-03-10T09:00:04.000Z",
          },
        ],
        subtitleCount: base.entries.length + 1,
        charCount: base.charCount + `추가 자막 ${index}`.length,
        updatedAt: new Date(Date.now() + index).toISOString(),
      }),
    );

    const metaWrites = [
      updateSessionMetadata("session_race_meta", { note: "동시 메모" }),
      updateSessionMetadata("session_race_meta", { starred: true }),
    ];

    await Promise.all([...runningWrites, ...metaWrites]);

    const loaded = await loadSession("session_race_meta");
    expect(loaded?.note).toBe("동시 메모");
    expect(loaded?.starred).toBe(true);
    expect((loaded?.entries.length ?? 0) >= 1).toBe(true);
  });

  it("exports Markdown and CSV session files with meeting metadata", async () => {
    const session = {
      ...buildSession("session_export_new", "saved"),
      tags: ["회의록"],
      category: "테스트",
      speakerLabels: { primary: "위원장" },
      entries: [
        {
          ...buildSession("session_export_new", "saved").entries[0],
          speakerChannel: "primary" as const,
          highlighted: true,
          entryNote: "핵심",
          labels: ["검토"],
        },
      ],
    };

    const markdown = await exportSessionData(session, "md");
    const csv = await exportSessionData(session, "csv");

    expect(markdown.filename.endsWith(".md")).toBe(true);
    expect(markdown.content).toContain("# 법사위");
    expect(markdown.content).toContain("- 위원회: 법제사법위원회");
    expect(markdown.content).toContain("#회의록");
    expect(markdown.content).toContain("위원장");
    expect(csv.filename.endsWith(".csv")).toBe(true);
    expect(csv.content.startsWith("\uFEFF")).toBe(true);
    expect(csv.content).toContain("startTime,endTime,speaker,text,highlighted,note,labels");
    expect(csv.content).toContain("위원장");
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
