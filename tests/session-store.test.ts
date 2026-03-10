import type { SessionRecord } from "../src/core/subtitle-models";
import {
  deleteSession,
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
});
