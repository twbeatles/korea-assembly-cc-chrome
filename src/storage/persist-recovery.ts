import { cloneSessionRecord, type SessionRecord } from "../core/subtitle-models";
import type {
  PersistReplayDiagnostics,
  QueuedExitPersistRecord,
} from "./types";

const EXIT_PERSIST_RECORD_PREFIX = "assembly-subtitle-exit-persist:";
const PERSIST_REPLAY_DIAGNOSTICS_STORAGE_KEY = "assembly-subtitle-persist-replay-diagnostics";

const memoryQueuedRecords = new Map<string, QueuedExitPersistRecord>();
let memoryDiagnostics = createEmptyPersistReplayDiagnostics();

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

function getQueuedRecordStorageKey(sessionId: string): string {
  return `${EXIT_PERSIST_RECORD_PREFIX}${sessionId}`;
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
    lastCleanupAt: null,
    lastCleanupDetectedCount: 0,
    lastCleanupClosedCount: 0,
    lastCleanupFailedCount: 0,
    lastError: null,
  };
}

function sanitizePersistReplayDiagnostics(value: unknown): PersistReplayDiagnostics {
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
    lastCleanupAt: isValidDateString(candidate.lastCleanupAt) ? candidate.lastCleanupAt : null,
    lastCleanupDetectedCount:
      typeof candidate.lastCleanupDetectedCount === "number"
        ? candidate.lastCleanupDetectedCount
        : 0,
    lastCleanupClosedCount:
      typeof candidate.lastCleanupClosedCount === "number" ? candidate.lastCleanupClosedCount : 0,
    lastCleanupFailedCount:
      typeof candidate.lastCleanupFailedCount === "number" ? candidate.lastCleanupFailedCount : 0,
    lastError: typeof candidate.lastError === "string" && candidate.lastError ? candidate.lastError : null,
  };
}

export async function queueExitPersistRecord(record: SessionRecord): Promise<void> {
  if (!record.id || record.status !== "stopped") {
    return;
  }

  const nextRecord: QueuedExitPersistRecord = {
    sessionId: record.id,
    queuedAt: new Date().toISOString(),
    record: cloneSessionRecord(record),
  };
  memoryQueuedRecords.set(record.id, cloneQueuedRecord(nextRecord));

  if (!hasChromeStorageLocal()) {
    return;
  }

  await chrome.storage.local.set({
    [getQueuedRecordStorageKey(record.id)]: cloneQueuedRecord(nextRecord),
  });
}

export async function listQueuedExitPersistRecords(): Promise<QueuedExitPersistRecord[]> {
  if (!hasChromeStorageLocal()) {
    return [...memoryQueuedRecords.values()].map(cloneQueuedRecord);
  }

  const snapshot = await chrome.storage.local.get(null);
  const records = Object.entries(snapshot)
    .filter(([key]) => key.startsWith(EXIT_PERSIST_RECORD_PREFIX))
    .map(([, value]) => sanitizeQueuedRecord(value))
    .filter((value): value is QueuedExitPersistRecord => Boolean(value));

  memoryQueuedRecords.clear();
  records.forEach((record) => {
    memoryQueuedRecords.set(record.sessionId, cloneQueuedRecord(record));
  });
  return records.map(cloneQueuedRecord);
}

export async function clearQueuedExitPersistRecord(sessionId: string): Promise<void> {
  if (!sessionId) {
    return;
  }

  memoryQueuedRecords.delete(sessionId);
  if (!hasChromeStorageLocal()) {
    return;
  }

  await chrome.storage.local.remove(getQueuedRecordStorageKey(sessionId));
}

export async function clearQueuedExitPersistRecordsUpTo(
  sessionId: string,
  updatedAt: string,
): Promise<void> {
  if (!sessionId) {
    return;
  }

  const current = memoryQueuedRecords.get(sessionId);
  if (current && current.record.updatedAt.localeCompare(updatedAt) <= 0) {
    memoryQueuedRecords.delete(sessionId);
  }

  if (!hasChromeStorageLocal()) {
    return;
  }

  const storageKey = getQueuedRecordStorageKey(sessionId);
  const snapshot = await chrome.storage.local.get(storageKey);
  const queued = sanitizeQueuedRecord(snapshot[storageKey]);
  if (queued && queued.record.updatedAt.localeCompare(updatedAt) <= 0) {
    await chrome.storage.local.remove(storageKey);
  }
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
  const nextDiagnostics = sanitizePersistReplayDiagnostics(diagnostics);
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
