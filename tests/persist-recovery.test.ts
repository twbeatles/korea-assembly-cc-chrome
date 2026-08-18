import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionRecord } from "../src/core/subtitle-models";
import {
  clearQueuedExitPersistRecord,
  clearQueuedExitPersistRecordsUpTo,
  createEmptyPersistReplayDiagnostics,
  listQueuedExitPersistRecords,
  queueExitPersistRecord,
  recordPageExitPersistAttempt,
  readPersistReplayDiagnostics,
  recoverOrphanedExitPersistRecords,
  resetPersistRecoveryStateForTests,
} from "../src/storage/persist-recovery";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

function buildSession(
  id: string,
  updatedAt: string,
  title = "테스트 세션",
): SessionRecord {
  return {
    id,
    version: "3",
    title,
    committeeName: "정무위원회",
    sourceUrl: "https://assembly.webcast.go.kr/main/player.asp",
    startedAt: "2026-03-10T09:00:00.000Z",
    endedAt: updatedAt,
    createdAt: "2026-03-10T09:00:00.000Z",
    updatedAt,
    subtitleCount: 1,
    charCount: 6,
    status: "stopped",
    starred: false,
    pinnedAt: null,
    note: "",
    entries: [
      {
        id: `${id}_entry`,
        text: "테스트 자막",
        timestamp: "2026-03-10T09:00:01.000Z",
        startTime: "2026-03-10T09:00:01.000Z",
        endTime: "2026-03-10T09:00:02.000Z",
      },
    ],
  };
}

describe("persist recovery", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await resetPersistRecoveryStateForTests();

    const storageState: Record<string, unknown> = {};
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: {
        storage: {
          local: {
            get: vi.fn(async (keys?: string | string[] | null) => {
              if (typeof keys === "string") {
                return { [keys]: storageState[keys] };
              }
              if (Array.isArray(keys)) {
                return keys.reduce<Record<string, unknown>>((result, key) => {
                  result[key] = storageState[key];
                  return result;
                }, {});
              }
              return { ...storageState };
            }),
            set: vi.fn(async (items: Record<string, unknown>) => {
              Object.assign(storageState, items);
            }),
            remove: vi.fn(async (keys: string | string[]) => {
              const normalized = Array.isArray(keys) ? keys : [keys];
              normalized.forEach((key) => {
                delete storageState[key];
              });
            }),
          },
        },
      },
    });
  });

  it("keeps the memory queue when storage writes fail and clears the error after later success", async () => {
    const storageSet = chrome.storage.local.set as unknown as ReturnType<typeof vi.fn>;
    storageSet.mockRejectedValueOnce(new Error("queue write failed"));

    await expect(
      queueExitPersistRecord(buildSession("session_queue_failure", "2026-03-10T09:00:02.000Z")),
    ).rejects.toThrow("queue write failed");

    const listedAfterFailure = await listQueuedExitPersistRecords();
    expect(listedAfterFailure.map((record) => record.sessionId)).toContain("session_queue_failure");

    let diagnostics = await readPersistReplayDiagnostics();
    expect(diagnostics.lastQueueWriteError).toBe("queue write failed");
    expect(diagnostics.lastError).toBe("queue write failed");

    await queueExitPersistRecord(buildSession("session_queue_failure", "2026-03-10T09:00:03.000Z"));
    diagnostics = await readPersistReplayDiagnostics();
    expect(diagnostics.lastQueueWriteError).toBeNull();
  });

  it("merges storage and memory queues and keeps the freshest snapshot", async () => {
    await queueExitPersistRecord(buildSession("session_merge", "2026-03-10T09:00:02.000Z", "older"));

    const storageKey = "assembly-subtitle-exit-persist:session_merge";
    await chrome.storage.local.set({
      [storageKey]: {
        sessionId: "session_merge",
        queuedAt: "2026-03-10T09:00:04.000Z",
        record: buildSession("session_merge", "2026-03-10T09:00:05.000Z", "newer"),
      },
    });

    const listed = await listQueuedExitPersistRecords();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.record.title).toBe("newer");
  });

  it("lists queue records via index without requiring a full storage dump after queue", async () => {
    const storageGet = chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>;
    await queueExitPersistRecord(buildSession("session_indexed", "2026-03-10T09:00:02.000Z"));

    storageGet.mockClear();
    const listed = await listQueuedExitPersistRecords();
    expect(listed.map((item) => item.sessionId)).toContain("session_indexed");

    // index + keyed get 경로: get(null) 전체 스냅샷을 쓰지 않는다
    const usedFullDump = storageGet.mock.calls.some((call) => {
      const arg = call[0];
      return arg === null || arg === undefined;
    });
    expect(usedFullDump).toBe(false);
  });

  it("keeps a queue record inserted during storage snapshot reconciliation", async () => {
    const storageGet = chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>;
    const deferred = createDeferred<Record<string, unknown>>();

    storageGet.mockImplementationOnce(async () => deferred.promise);

    const listedPromise = listQueuedExitPersistRecords();
    await Promise.resolve();

    await queueExitPersistRecord(
      buildSession("session_inserted_during_list", "2026-03-10T09:00:06.000Z", "during-list"),
    );
    deferred.resolve({});

    const listed = await listedPromise;
    expect(listed.map((record) => record.sessionId)).toContain("session_inserted_during_list");
    expect((await listQueuedExitPersistRecords())[0]?.record.title).toBe("during-list");
  });

  it("clears queue entries from memory and storage independently", async () => {
    const sessionId = "session_clear";
    const record = buildSession(sessionId, "2026-03-10T09:00:02.000Z");

    await queueExitPersistRecord(record);
    await clearQueuedExitPersistRecordsUpTo(sessionId, "2026-03-10T09:00:02.000Z");
    expect(await listQueuedExitPersistRecords()).toEqual([]);

    await queueExitPersistRecord(record);
    await clearQueuedExitPersistRecord(sessionId);
    expect(await listQueuedExitPersistRecords()).toEqual([]);

    expect(await readPersistReplayDiagnostics()).toEqual(
      expect.objectContaining(createEmptyPersistReplayDiagnostics()),
    );
  });

  it("keeps both session ids when two queues write the index concurrently", async () => {
    await Promise.all([
      queueExitPersistRecord(buildSession("session_race_a", "2026-03-10T09:00:02.000Z")),
      queueExitPersistRecord(buildSession("session_race_b", "2026-03-10T09:00:03.000Z")),
    ]);

    const listed = await listQueuedExitPersistRecords();
    expect(listed.map((record) => record.sessionId).sort()).toEqual([
      "session_race_a",
      "session_race_b",
    ]);
  });

  it("recovers an orphaned storage record that is missing from the index", async () => {
    await queueExitPersistRecord(buildSession("session_indexed_live", "2026-03-10T09:00:02.000Z"));

    const orphan = buildSession("session_orphan", "2026-03-10T09:00:04.000Z", "orphan");
    await chrome.storage.local.set({
      "assembly-subtitle-exit-persist:session_orphan": {
        sessionId: "session_orphan",
        queuedAt: "2026-03-10T09:00:04.000Z",
        record: orphan,
      },
    });

    const beforeRecover = await listQueuedExitPersistRecords();
    expect(beforeRecover.map((record) => record.sessionId)).not.toContain("session_orphan");

    const recoveredIds = await recoverOrphanedExitPersistRecords();
    expect(recoveredIds.sort()).toEqual(["session_indexed_live", "session_orphan"]);

    const afterRecover = await listQueuedExitPersistRecords();
    expect(afterRecover.map((record) => record.sessionId).sort()).toEqual([
      "session_indexed_live",
      "session_orphan",
    ]);
  });

  it("records the last page-exit persist attempt and error detail", async () => {
    const record = buildSession(
      "session_page_exit",
      "2026-03-10T09:00:02.000Z",
      "page-exit",
    );

    await recordPageExitPersistAttempt(record, new Error("page-exit failed"));

    const diagnostics = await readPersistReplayDiagnostics();
    expect(diagnostics.lastPageExitPersistSessionId).toBe("session_page_exit");
    expect(diagnostics.lastPageExitPersistEntryCount).toBe(1);
    expect(diagnostics.lastPageExitPersistError).toBe("page-exit failed");
    expect(diagnostics.lastError).toBe("page-exit failed");

    await recordPageExitPersistAttempt(record);
    expect((await readPersistReplayDiagnostics()).lastPageExitPersistError).toBeNull();
  });
});
