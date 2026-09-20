import type { SessionRecord } from "../../core/subtitle-models";
import type { PersistReplayDiagnostics } from "../types";
import { PERSIST_REPLAY_DIAGNOSTICS_STORAGE_KEY, hasChromeStorageLocal } from "./keys";
import { memoryDiagnostics, setMemoryDiagnostics } from "./state";
import { resolvePersistReplayLastError, sanitizePersistReplayDiagnostics } from "./sanitize";

/** persist/replay 진단 스냅샷 읽기·쓰기 (단일 책임: 복구 상태 관측). */
export async function updatePersistReplayDiagnostics(
  updater: (current: PersistReplayDiagnostics) => PersistReplayDiagnostics,
): Promise<void> {
  const current = await readPersistReplayDiagnostics();
  const next = updater(current);
  await writePersistReplayDiagnostics({
    ...next,
    lastError: resolvePersistReplayLastError(next),
  });
}

export async function recordPageExitPersistAttempt(
  record: SessionRecord,
  error?: unknown,
): Promise<void> {
  await updatePersistReplayDiagnostics((current) => ({
    ...current,
    lastPageExitPersistAttemptAt: new Date().toISOString(),
    lastPageExitPersistSessionId: record.id || null,
    lastPageExitPersistEntryCount: record.entries.length,
    lastPageExitPersistError:
      error === undefined
        ? null
        : error instanceof Error
          ? error.message
          : String(error || "page-exit persist failed"),
  }));
}

export async function readPersistReplayDiagnostics(): Promise<PersistReplayDiagnostics> {
  if (!hasChromeStorageLocal()) {
    return { ...memoryDiagnostics };
  }

  const snapshot = await chrome.storage.local.get(PERSIST_REPLAY_DIAGNOSTICS_STORAGE_KEY);
  const diagnostics = sanitizePersistReplayDiagnostics(
    snapshot[PERSIST_REPLAY_DIAGNOSTICS_STORAGE_KEY],
  );
  setMemoryDiagnostics(diagnostics);
  return { ...diagnostics };
}

export async function writePersistReplayDiagnostics(
  diagnostics: PersistReplayDiagnostics,
): Promise<void> {
  const sanitizedDiagnostics = sanitizePersistReplayDiagnostics(diagnostics);
  const nextDiagnostics = {
    ...sanitizedDiagnostics,
    lastError: resolvePersistReplayLastError(sanitizedDiagnostics),
  };
  setMemoryDiagnostics(nextDiagnostics);
  if (!hasChromeStorageLocal()) {
    return;
  }

  await chrome.storage.local.set({
    [PERSIST_REPLAY_DIAGNOSTICS_STORAGE_KEY]: nextDiagnostics,
  });
}
