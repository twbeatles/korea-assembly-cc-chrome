import {
  createEmptyPersistReplayDiagnostics,
  writePersistReplayDiagnostics,
} from "../storage/persist-recovery";
import {
  closeRunningSessionsOnStartup,
  replayQueuedExitPersistRecords,
} from "../storage/session-store";
import type {
  PersistReplayDiagnostics,
  PersistReplaySummary,
  StartupCleanupSummary,
} from "../storage/types";

export interface StartupPersistenceResult {
  cleanupSummary: StartupCleanupSummary;
  diagnostics: PersistReplayDiagnostics;
  replaySummary: PersistReplaySummary;
}

export async function runStartupPersistenceMaintenance(
  dependencies: {
    replay?: typeof replayQueuedExitPersistRecords;
    cleanup?: typeof closeRunningSessionsOnStartup;
    writeDiagnostics?: typeof writePersistReplayDiagnostics;
    now?: () => string;
  } = {},
): Promise<StartupPersistenceResult> {
  const replay = dependencies.replay ?? replayQueuedExitPersistRecords;
  const cleanup = dependencies.cleanup ?? closeRunningSessionsOnStartup;
  const writeDiagnostics = dependencies.writeDiagnostics ?? writePersistReplayDiagnostics;
  const now = dependencies.now ?? (() => new Date().toISOString());

  const emptyReplaySummary: PersistReplaySummary = {
    queuedCount: 0,
    replayedCount: 0,
    skippedCount: 0,
    failedCount: 0,
  };
  const emptyCleanupSummary: StartupCleanupSummary = {
    detectedCount: 0,
    closedCount: 0,
    failedCount: 0,
  };

  let replaySummary = emptyReplaySummary;
  let cleanupSummary = emptyCleanupSummary;
  let lastError: string | null = null;

  try {
    replaySummary = await replay();
  } catch (error) {
    lastError = error instanceof Error ? error.message : "queued exit persistence replay failed";
  }

  try {
    cleanupSummary = await cleanup();
  } catch (error) {
    lastError = error instanceof Error ? error.message : "startup cleanup failed";
  }

  const diagnostics: PersistReplayDiagnostics = {
    ...createEmptyPersistReplayDiagnostics(),
    lastReplayAt: now(),
    lastReplayQueuedCount: replaySummary.queuedCount,
    lastReplayReplayedCount: replaySummary.replayedCount,
    lastReplaySkippedCount: replaySummary.skippedCount,
    lastReplayFailedCount: replaySummary.failedCount,
    lastCleanupAt: now(),
    lastCleanupDetectedCount: cleanupSummary.detectedCount,
    lastCleanupClosedCount: cleanupSummary.closedCount,
    lastCleanupFailedCount: cleanupSummary.failedCount,
    lastError,
  };
  await writeDiagnostics(diagnostics);

  return {
    replaySummary,
    cleanupSummary,
    diagnostics,
  };
}
