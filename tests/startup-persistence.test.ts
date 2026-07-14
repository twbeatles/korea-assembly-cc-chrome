import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  resetStartupPersistenceGuardForTests,
  runStartupPersistenceMaintenance,
} from "../src/background/startup-persistence";

describe("startup persistence maintenance", () => {
  beforeEach(() => {
    resetStartupPersistenceGuardForTests();
  });

  it("replays queued exit records before stale running cleanup and stores diagnostics", async () => {
    const steps: string[] = [];
    const writeDiagnostics = vi.fn(async () => {
      steps.push("writeDiagnostics");
    });

    const result = await runStartupPersistenceMaintenance({
      bypassDebounce: true,
      replay: async () => {
        steps.push("replay");
        return {
          queuedCount: 2,
          replayedCount: 1,
          skippedCount: 1,
          failedCount: 0,
        };
      },
      cleanup: async () => {
        steps.push("cleanup");
        return {
          detectedCount: 3,
          closedCount: 2,
          failedCount: 1,
        };
      },
      writeDiagnostics,
      now: () => "2026-03-13T09:30:00.000Z",
    });

    expect(steps).toEqual(["replay", "cleanup", "writeDiagnostics"]);
    expect(writeDiagnostics).toHaveBeenCalledWith(
      expect.objectContaining({
        lastReplayQueuedCount: 2,
        lastReplayReplayedCount: 1,
        lastReplaySkippedCount: 1,
        lastReplayFailedCount: 0,
        lastReplayError: null,
        lastCleanupDetectedCount: 3,
        lastCleanupClosedCount: 2,
        lastCleanupFailedCount: 1,
        lastCleanupError: null,
      }),
    );
    expect(result.diagnostics.lastReplayAt).toBe("2026-03-13T09:30:00.000Z");
    expect(result.cleanupSummary.closedCount).toBe(2);
  });

  it("stores the last startup error in diagnostics when replay fails", async () => {
    const writeDiagnostics = vi.fn();

    const result = await runStartupPersistenceMaintenance({
      bypassDebounce: true,
      readDiagnostics: async () => ({
        lastReplayAt: null,
        lastReplayQueuedCount: 0,
        lastReplayReplayedCount: 0,
        lastReplaySkippedCount: 0,
        lastReplayFailedCount: 0,
        lastReplayError: null,
        lastCleanupAt: null,
        lastCleanupDetectedCount: 0,
        lastCleanupClosedCount: 0,
        lastCleanupFailedCount: 0,
        lastCleanupError: null,
        lastQueueWriteError: "Queue write failed",
        lastPageExitPersistAttemptAt: null,
        lastPageExitPersistSessionId: null,
        lastPageExitPersistEntryCount: 0,
        lastPageExitPersistError: null,
        lastError: "Queue write failed",
      }),
      replay: async () => {
        throw new Error("Replay failed");
      },
      cleanup: async () => ({
        detectedCount: 1,
        closedCount: 1,
        failedCount: 0,
      }),
      writeDiagnostics,
      now: () => "2026-03-13T09:30:00.000Z",
    });

    expect(result.diagnostics.lastError).toBe("Replay failed");
    expect(result.diagnostics.lastReplayError).toBe("Replay failed");
    expect(result.diagnostics.lastCleanupError).toBeNull();
    expect(result.diagnostics.lastQueueWriteError).toBe("Queue write failed");
    expect(writeDiagnostics).toHaveBeenCalledWith(
      expect.objectContaining({
        lastError: "Replay failed",
        lastReplayError: "Replay failed",
      }),
    );
  });

  it("debounces rapid successive startup maintenance calls", async () => {
    const replay = vi.fn(async () => ({
      queuedCount: 0,
      replayedCount: 0,
      skippedCount: 0,
      failedCount: 0,
    }));
    const cleanup = vi.fn(async () => ({
      detectedCount: 0,
      closedCount: 0,
      failedCount: 0,
    }));
    const writeDiagnostics = vi.fn(async () => undefined);

    await runStartupPersistenceMaintenance({
      replay,
      cleanup,
      writeDiagnostics,
      now: () => "2026-03-13T09:30:00.000Z",
    });
    await runStartupPersistenceMaintenance({
      replay,
      cleanup,
      writeDiagnostics,
      now: () => "2026-03-13T09:30:01.000Z",
    });

    expect(replay).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
