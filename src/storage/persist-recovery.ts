import { cloneSessionRecord, type SessionRecord } from "../core/subtitle-models";
import type {
  PersistReplayDiagnostics,
  QueuedExitPersistRecord,
} from "./types";
import {
  clearIndexedDbQueuedExitPersistRecords,
  deleteIndexedDbQueuedExitPersistRecord,
  listIndexedDbQueuedExitPersistRecords,
  loadIndexedDbQueuedExitPersistRecord,
  putIndexedDbQueuedExitPersistRecord,
  resetIndexedDbForTests,
  tryIndexedDb,
} from "./session-store/db";

export const EXIT_PERSIST_RECORD_PREFIX = "assembly-subtitle-exit-persist:";
export const PERSIST_REPLAY_DIAGNOSTICS_STORAGE_KEY =
  "assembly-subtitle-persist-replay-diagnostics";

const memoryQueuedRecords = new Map<string, QueuedExitPersistRecord>();
let memoryDiagnostics = createEmptyPersistReplayDiagnostics();
let queuedRecordOperationQueue = Promise.resolve();

export type StopPersistMode = "direct" | "background" | "replay";

function hasChromeStorageLocal(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}

function cloneQueuedRecord(record: QueuedExitPersistRecord): QueuedExitPersistRecord {
  return {
    sessionId: record.sessionId,
    queuedAt: record.queuedAt,
    record: cloneSessionRecord(record.record),
  };
}

function compareQueuedRecordFreshness(
  left: QueuedExitPersistRecord,
  right: QueuedExitPersistRecord,
): number {
  const updatedAtCompare = left.record.updatedAt.localeCompare(right.record.updatedAt);
  if (updatedAtCompare !== 0) {
    return updatedAtCompare;
  }

  return left.queuedAt.localeCompare(right.queuedAt);
}

function mergeQueuedRecordCollections(
  storageRecords: QueuedExitPersistRecord[],
  memoryRecords: QueuedExitPersistRecord[],
): QueuedExitPersistRecord[] {
  const merged = new Map<string, QueuedExitPersistRecord>();

  [...storageRecords, ...memoryRecords].forEach((record) => {
    const current = merged.get(record.sessionId);
    if (!current || compareQueuedRecordFreshness(record, current) > 0) {
      merged.set(record.sessionId, cloneQueuedRecord(record));
    }
  });

  return [...merged.values()];
}

function enqueueQueuedRecordOperation<T>(action: () => Promise<T>): Promise<T> {
  const next = queuedRecordOperationQueue.then(action, action);
  queuedRecordOperationQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function resolvePersistReplayLastError(diagnostics: PersistReplayDiagnostics): string | null {
  return (
    diagnostics.lastCleanupError ??
    diagnostics.lastReplayError ??
    diagnostics.lastQueueWriteError ??
    null
  );
}

function getQueuedRecordStorageKey(sessionId: string): string {
  return `${EXIT_PERSIST_RECORD_PREFIX}${sessionId}`;
}

function estimateQueuedRecordBytes(record: QueuedExitPersistRecord): number {
  try {
    return new TextEncoder().encode(JSON.stringify(record)).length;
  } catch {
    return JSON.stringify(record).length;
  }
}

function isValidDateString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function isSessionRecordLike(value: unknown): value is SessionRecord {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as SessionRecord).id === "string" &&
    typeof (value as SessionRecord).updatedAt === "string" &&
    Array.isArray((value as SessionRecord).entries)
  );
}

function isQueuedExitPersistRecordLike(value: unknown): value is QueuedExitPersistRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<QueuedExitPersistRecord>;
  return (
    typeof candidate.sessionId === "string" &&
    candidate.sessionId.length > 0 &&
    isValidDateString(candidate.queuedAt) &&
    isSessionRecordLike(candidate.record) &&
    candidate.record.status === "stopped"
  );
}

function sanitizeQueuedRecord(value: unknown): QueuedExitPersistRecord | undefined {
  if (!isQueuedExitPersistRecordLike(value)) {
    return undefined;
  }

  return {
    sessionId: value.sessionId,
    queuedAt: value.queuedAt,
    record: cloneSessionRecord(value.record),
  };
}

export function createEmptyPersistReplayDiagnostics(): PersistReplayDiagnostics {
  return {
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
    lastQueueWriteSessionId: null,
    lastQueueWriteRecordUpdatedAt: null,
    lastQueueWriteApproxBytes: null,
    lastQueueWriteError: null,
    lastStopPersistAt: null,
    lastStopPersistMode: null,
    lastError: null,
  };
}

export function sanitizePersistReplayDiagnostics(value: unknown): PersistReplayDiagnostics {
  if (!value || typeof value !== "object") {
    return createEmptyPersistReplayDiagnostics();
  }

  const candidate = value as Partial<PersistReplayDiagnostics>;
  return {
    lastReplayAt: isValidDateString(candidate.lastReplayAt) ? candidate.lastReplayAt : null,
    lastReplayQueuedCount:
      typeof candidate.lastReplayQueuedCount === "number" ? candidate.lastReplayQueuedCount : 0,
    lastReplayReplayedCount:
      typeof candidate.lastReplayReplayedCount === "number"
        ? candidate.lastReplayReplayedCount
        : 0,
    lastReplaySkippedCount:
      typeof candidate.lastReplaySkippedCount === "number" ? candidate.lastReplaySkippedCount : 0,
    lastReplayFailedCount:
      typeof candidate.lastReplayFailedCount === "number" ? candidate.lastReplayFailedCount : 0,
    lastReplayError:
      typeof candidate.lastReplayError === "string" && candidate.lastReplayError
        ? candidate.lastReplayError
        : null,
    lastCleanupAt: isValidDateString(candidate.lastCleanupAt) ? candidate.lastCleanupAt : null,
    lastCleanupDetectedCount:
      typeof candidate.lastCleanupDetectedCount === "number"
        ? candidate.lastCleanupDetectedCount
        : 0,
    lastCleanupClosedCount:
      typeof candidate.lastCleanupClosedCount === "number" ? candidate.lastCleanupClosedCount : 0,
    lastCleanupFailedCount:
      typeof candidate.lastCleanupFailedCount === "number" ? candidate.lastCleanupFailedCount : 0,
    lastCleanupError:
      typeof candidate.lastCleanupError === "string" && candidate.lastCleanupError
        ? candidate.lastCleanupError
        : null,
    lastQueueWriteSessionId:
      typeof candidate.lastQueueWriteSessionId === "string" && candidate.lastQueueWriteSessionId
        ? candidate.lastQueueWriteSessionId
        : null,
    lastQueueWriteRecordUpdatedAt: isValidDateString(candidate.lastQueueWriteRecordUpdatedAt)
      ? candidate.lastQueueWriteRecordUpdatedAt
      : null,
    lastQueueWriteApproxBytes:
      typeof candidate.lastQueueWriteApproxBytes === "number" &&
      Number.isFinite(candidate.lastQueueWriteApproxBytes)
        ? candidate.lastQueueWriteApproxBytes
        : null,
    lastQueueWriteError:
      typeof candidate.lastQueueWriteError === "string" && candidate.lastQueueWriteError
        ? candidate.lastQueueWriteError
        : null,
    lastStopPersistAt: isValidDateString(candidate.lastStopPersistAt)
      ? candidate.lastStopPersistAt
      : null,
    lastStopPersistMode:
      candidate.lastStopPersistMode === "direct" ||
      candidate.lastStopPersistMode === "background" ||
      candidate.lastStopPersistMode === "replay"
        ? candidate.lastStopPersistMode
        : null,
    lastError: typeof candidate.lastError === "string" && candidate.lastError ? candidate.lastError : null,
  };
}

async function updatePersistReplayDiagnostics(
  updater: (current: PersistReplayDiagnostics) => PersistReplayDiagnostics,
): Promise<void> {
  const current = await readPersistReplayDiagnostics();
  const next = updater(current);
  await writePersistReplayDiagnostics({
    ...next,
    lastError: resolvePersistReplayLastError(next),
  });
}

async function writeLegacyQueuedExitPersistRecord(
  record: QueuedExitPersistRecord,
): Promise<void> {
  if (!hasChromeStorageLocal()) {
    return;
  }

  await chrome.storage.local.set({
    [getQueuedRecordStorageKey(record.sessionId)]: cloneQueuedRecord(record),
  });
}

async function readLegacyQueuedExitPersistRecords(): Promise<QueuedExitPersistRecord[]> {
  if (!hasChromeStorageLocal()) {
    return [];
  }

  const snapshot = await chrome.storage.local.get(null);
  return Object.entries(snapshot)
    .filter(([key]) => key.startsWith(EXIT_PERSIST_RECORD_PREFIX))
    .map(([, value]) => sanitizeQueuedRecord(value))
    .filter((value): value is QueuedExitPersistRecord => Boolean(value));
}

async function readLegacyQueuedExitPersistRecord(
  sessionId: string,
): Promise<QueuedExitPersistRecord | undefined> {
  if (!hasChromeStorageLocal() || !sessionId) {
    return undefined;
  }

  const storageKey = getQueuedRecordStorageKey(sessionId);
  const snapshot = await chrome.storage.local.get(storageKey);
  return sanitizeQueuedRecord(snapshot[storageKey]);
}

async function removeLegacyQueuedExitPersistRecord(sessionId: string): Promise<void> {
  if (!hasChromeStorageLocal() || !sessionId) {
    return;
  }

  await chrome.storage.local.remove(getQueuedRecordStorageKey(sessionId));
}

async function clearLegacyQueuedExitPersistRecords(): Promise<void> {
  if (!hasChromeStorageLocal()) {
    return;
  }

  const snapshot = await chrome.storage.local.get(null);
  const keys = Object.keys(snapshot).filter((key) => key.startsWith(EXIT_PERSIST_RECORD_PREFIX));
  if (keys.length) {
    await chrome.storage.local.remove(keys);
  }
}

export async function recordStopPersistSuccess(
  mode: StopPersistMode,
  persistedAt: string,
): Promise<void> {
  await updatePersistReplayDiagnostics((current) => ({
    ...current,
    lastStopPersistAt: persistedAt,
    lastStopPersistMode: mode,
  }));
}

export async function queueExitPersistRecord(record: SessionRecord): Promise<void> {
  return enqueueQueuedRecordOperation(async () => {
    if (!record.id || record.status !== "stopped") {
      return;
    }

    const nextRecord: QueuedExitPersistRecord = {
      sessionId: record.id,
      queuedAt: new Date().toISOString(),
      record: cloneSessionRecord(record),
    };
    const approxBytes = estimateQueuedRecordBytes(nextRecord);
    memoryQueuedRecords.set(record.id, cloneQueuedRecord(nextRecord));

    let queueWriteError: unknown;
    const indexedDbResult = await tryIndexedDb(async () =>
      putIndexedDbQueuedExitPersistRecord(nextRecord),
    );

    if (indexedDbResult.ok) {
      try {
        await removeLegacyQueuedExitPersistRecord(record.id);
      } catch {
        // Legacy cleanup is best-effort after IDB success.
      }
    } else if (hasChromeStorageLocal()) {
      try {
        await writeLegacyQueuedExitPersistRecord(nextRecord);
      } catch (error) {
        queueWriteError = error;
      }
    }

    await updatePersistReplayDiagnostics((current) => ({
      ...current,
      lastQueueWriteSessionId: nextRecord.sessionId,
      lastQueueWriteRecordUpdatedAt: nextRecord.record.updatedAt,
      lastQueueWriteApproxBytes: approxBytes,
      lastQueueWriteError:
        queueWriteError instanceof Error
          ? queueWriteError.message
          : queueWriteError
            ? "queued exit persist write failed"
            : null,
    })).catch(() => {
      // Preserve the original queue write result even if diagnostics cannot be updated.
    });

    if (queueWriteError) {
      throw queueWriteError;
    }
  });
}

export async function listQueuedExitPersistRecords(): Promise<QueuedExitPersistRecord[]> {
  return enqueueQueuedRecordOperation(async () => {
    const indexedDbResult = await tryIndexedDb(async () =>
      listIndexedDbQueuedExitPersistRecords(),
    );
    const legacyRecords = await readLegacyQueuedExitPersistRecords().catch(() => []);
    const memoryRecords = [...memoryQueuedRecords.values()].map(cloneQueuedRecord);

    const mergedRecords = mergeQueuedRecordCollections(
      [
        ...(indexedDbResult.ok && indexedDbResult.value ? indexedDbResult.value : []),
        ...legacyRecords,
      ],
      memoryRecords,
    );

    mergedRecords.forEach((queuedRecord) => {
      memoryQueuedRecords.set(queuedRecord.sessionId, cloneQueuedRecord(queuedRecord));
    });
    return mergedRecords.map(cloneQueuedRecord);
  });
}

export async function clearQueuedExitPersistRecord(sessionId: string): Promise<void> {
  return enqueueQueuedRecordOperation(async () => {
    if (!sessionId) {
      return;
    }

    memoryQueuedRecords.delete(sessionId);
    await tryIndexedDb(async () => deleteIndexedDbQueuedExitPersistRecord(sessionId));

    try {
      await removeLegacyQueuedExitPersistRecord(sessionId);
    } catch {
      // Queue cleanup is best-effort and must not block other persistence work.
    }
  });
}

export async function clearAllQueuedExitPersistRecords(): Promise<void> {
  return enqueueQueuedRecordOperation(async () => {
    memoryQueuedRecords.clear();
    await tryIndexedDb(async () => clearIndexedDbQueuedExitPersistRecords());

    try {
      await clearLegacyQueuedExitPersistRecords();
    } catch {
      // Queue cleanup is best-effort and must not block other persistence work.
    }
  });
}

export async function clearQueuedExitPersistRecordsUpTo(
  sessionId: string,
  updatedAt: string,
): Promise<void> {
  return enqueueQueuedRecordOperation(async () => {
    if (!sessionId) {
      return;
    }

    const current = memoryQueuedRecords.get(sessionId);
    if (current && current.record.updatedAt.localeCompare(updatedAt) <= 0) {
      memoryQueuedRecords.delete(sessionId);
    }

    const indexedDbResult = await tryIndexedDb(async () =>
      loadIndexedDbQueuedExitPersistRecord(sessionId),
    );
    const indexedDbQueued =
      indexedDbResult.ok && indexedDbResult.value ? indexedDbResult.value : undefined;
    if (indexedDbQueued && indexedDbQueued.record.updatedAt.localeCompare(updatedAt) <= 0) {
      await tryIndexedDb(async () => deleteIndexedDbQueuedExitPersistRecord(sessionId));
    }

    try {
      const legacyQueued = await readLegacyQueuedExitPersistRecord(sessionId);
      if (legacyQueued && legacyQueued.record.updatedAt.localeCompare(updatedAt) <= 0) {
        await removeLegacyQueuedExitPersistRecord(sessionId);
      }
    } catch {
      // Queue cleanup is best-effort and must not block other persistence work.
    }
  });
}

export async function readPersistReplayDiagnostics(): Promise<PersistReplayDiagnostics> {
  if (!hasChromeStorageLocal()) {
    return { ...memoryDiagnostics };
  }

  const snapshot = await chrome.storage.local.get(PERSIST_REPLAY_DIAGNOSTICS_STORAGE_KEY);
  const diagnostics = sanitizePersistReplayDiagnostics(
    snapshot[PERSIST_REPLAY_DIAGNOSTICS_STORAGE_KEY],
  );
  memoryDiagnostics = diagnostics;
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
  memoryDiagnostics = nextDiagnostics;
  if (!hasChromeStorageLocal()) {
    return;
  }

  await chrome.storage.local.set({
    [PERSIST_REPLAY_DIAGNOSTICS_STORAGE_KEY]: nextDiagnostics,
  });
}

export async function resetPersistRecoveryStateForTests(): Promise<void> {
  memoryQueuedRecords.clear();
  memoryDiagnostics = createEmptyPersistReplayDiagnostics();
  queuedRecordOperationQueue = Promise.resolve();
  await resetIndexedDbForTests();
  if (!hasChromeStorageLocal()) {
    return;
  }

  const snapshot = await chrome.storage.local.get(null);
  const keys = Object.keys(snapshot).filter(
    (key) =>
      key === PERSIST_REPLAY_DIAGNOSTICS_STORAGE_KEY || key.startsWith(EXIT_PERSIST_RECORD_PREFIX),
  );
  if (keys.length) {
    await chrome.storage.local.remove(keys);
  }
}
