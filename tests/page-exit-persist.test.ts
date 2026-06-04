import { describe, expect, it, vi } from "vitest";

import { persistQueuedPageExitRecord } from "../src/content/page-exit-persist";
import type { SessionRecord } from "../src/core/subtitle-models";

function buildRecord(): SessionRecord {
  return {
    id: "session_page_exit",
    version: "3",
    title: "정무위",
    committeeName: "정무위원회",
    sourceUrl: "https://assembly.webcast.go.kr/main/player.asp",
    startedAt: "2026-03-10T09:00:00.000Z",
    endedAt: "2026-03-10T09:00:03.000Z",
    createdAt: "2026-03-10T09:00:00.000Z",
    updatedAt: "2026-03-10T09:00:03.000Z",
    subtitleCount: 1,
    charCount: 8,
    status: "stopped",
    starred: false,
    pinnedAt: null,
    note: "",
    entries: [
      {
        id: "entry_1",
        text: "테스트 자막",
        timestamp: "2026-03-10T09:00:00.000Z",
        startTime: "2026-03-10T09:00:00.000Z",
        endTime: "2026-03-10T09:00:02.000Z",
      },
    ],
  };
}

describe("page exit persistence", () => {
  it("queues the exit record before sending the background persist request", async () => {
    const steps: string[] = [];
    const record = buildRecord();

    await persistQueuedPageExitRecord(record, {
      queueRecord: async () => {
        steps.push("queue:start");
        await Promise.resolve();
        steps.push("queue:end");
      },
      onPersistAttempt: async () => {
        steps.push("attempt");
      },
      persistRecordInBackground: () => {
        steps.push("background");
      },
    });

    expect(steps).toEqual(["attempt", "queue:start", "queue:end", "background"]);
  });

  it("still attempts the background persist after a queue failure", async () => {
    const persistRecordInBackground = vi.fn();
    const queueRecordInBackground = vi.fn();
    const onQueueError = vi.fn();

    await persistQueuedPageExitRecord(buildRecord(), {
      queueRecord: async () => {
        throw new Error("queue failed");
      },
      queueRecordInBackground,
      persistRecordInBackground,
      onQueueError,
    });

    expect(onQueueError).toHaveBeenCalledWith(expect.any(Error));
    expect(queueRecordInBackground).toHaveBeenCalledTimes(1);
    expect(persistRecordInBackground).toHaveBeenCalledTimes(1);
  });

  it("still queues and persists when the diagnostics attempt fails", async () => {
    const queueRecord = vi.fn();
    const persistRecordInBackground = vi.fn();
    const onPersistAttemptError = vi.fn();

    await persistQueuedPageExitRecord(buildRecord(), {
      queueRecord,
      persistRecordInBackground,
      onPersistAttempt: async () => {
        throw new Error("diagnostics failed");
      },
      onPersistAttemptError,
    });

    expect(onPersistAttemptError).toHaveBeenCalledWith(expect.any(Error));
    expect(queueRecord).toHaveBeenCalledTimes(1);
    expect(persistRecordInBackground).toHaveBeenCalledTimes(1);
  });
});
