import type { SessionRecord } from "../src/core/subtitle-models";
import {
  closeRunningSessionsOnStartup,
  deleteAllSessions,
  deleteSession,
  exportSessionData,
  importSessionRecords,
  listSessions,
  loadSession,
  resetSessionStoreForTests,
  saveSession,
  upsertSessionRecord,
  updateRunningSession,
} from "../src/storage/session-store";

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

  it("closes stale running sessions on startup", async () => {
    await updateRunningSession(buildSession("session_running_1", "running"));
    await saveSession(buildSession("session_saved_1", "saved"));

    const closedCount = await closeRunningSessionsOnStartup();
    const updated = await loadSession("session_running_1");

    expect(closedCount).toBe(1);
    expect(updated?.status).toBe("stopped");
    expect(updated?.endedAt).toBe(updated?.updatedAt);
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
    });
    expect(loaded?.note).toBe("기존 최신본");
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

    const payload = await exportSessionData(session, "srt", undefined, [session.entries[1]]);

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

    const closedCount = await closeRunningSessionsOnStartup();
    expect(closedCount).toBe(3);

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
});
