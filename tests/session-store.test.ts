import type { SessionRecord } from "../src/core/subtitle-models";
import {
  closeRunningSessionsOnStartup,
  deleteSession,
  exportSessionData,
  listSessions,
  loadSession,
  resetSessionStoreForTests,
  saveSession,
  updateRunningSession,
} from "../src/storage/session-store";

function buildSession(id: string, status: SessionRecord["status"]): SessionRecord {
  return {
    id,
    version: "1",
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
    expect(loaded?.version).toBe("1");
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
});
