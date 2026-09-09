import { cloneSessionRecord, type SessionRecord } from "../core/subtitle-models";
import type {
  PersistReplayDiagnostics,
  QueuedExitPersistRecord,
} from "./types";

const EXIT_PERSIST_RECORD_PREFIX = "assembly-subtitle-exit-persist:";
/** 큐 세션 id 목록. list 시 storage 전체 get(null) 을 피하기 위한 인덱스. */
export const EXIT_PERSIST_INDEX_STORAGE_KEY = "assembly-subtitle-exit-persist:index";
const PERSIST_REPLAY_DIAGNOSTICS_STORAGE_KEY = "assembly-subtitle-persist-replay-diagnostics";
const SESSION_DELETED_PREFIX = "assembly-subtitle-deleted-session:";

const memoryQueuedRecords = new Map<string, QueuedExitPersistRecord>();
const memoryDeletedSessionTombstones = new Map<string, string>();
let memoryDiagnostics = createEmptyPersistReplayDiagnostics();

function hasChromeStorageLocal(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}

function sanitizeExitPersistIndex(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [
    ...new Set(
      value.filter((item): item is string => typeof item === "string" && item.trim().length > 0),
    ),
  ];
}

async function readExitPersistIndex(): Promise<string[]> {
  if (!hasChromeStorageLocal()) {
    return [];
  }
  const snapshot = await chrome.storage.local.get(EXIT_PERSIST_INDEX_STORAGE_KEY);
  return sanitizeExitPersistIndex(snapshot[EXIT_PERSIST_INDEX_STORAGE_KEY]);
}

async function writeExitPersistIndex(sessionIds: string[]): Promise<void> {
  if (!hasChromeStorageLocal()) {
    return;
  }
  await chrome.storage.local.set({
    [EXIT_PERSIST_INDEX_STORAGE_KEY]: sanitizeExitPersistIndex(sessionIds),
  });
}

async function addSessionIdToExitPersistIndex(sessionId: string): Promise<void> {
  const current = await readExitPersistIndex();
  if (current.includes(sessionId)) {
    return;
  }
  await writeExitPersistIndex([...current, sessionId]);
}

async function removeSessionIdFromExitPersistIndex(sessionId: string): Promise<void> {
  const current = await readExitPersistIndex();
  if (!current.includes(sessionId)) {
    return;
  }
  await writeExitPersistIndex(current.filter((id) => id !== sessionId));
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

function resolvePersistReplayLastError(diagnostics: PersistReplayDiagnostics): string | null {
  return (
    diagnostics.lastCleanupError ??
    diagnostics.lastReplayError ??
    diagnostics.lastPageExitPersistError ??
    diagnostics.lastQueueWriteError ??
    null
  );
}

function getQueuedRecordStorageKey(sessionId: string): string {
  return `${EXIT_PERSIST_RECORD_PREFIX}${sessionId}`;
}

function getDeletedSessionStorageKey(sessionId: string): string {
  return `${SESSION_DELETED_PREFIX}${sessionId}`;
}

export async function markSessionDeleted(
  sessionId: string,
  deletedAt = new Date().toISOString(),
): Promise<void> {
  if (!sessionId) {
    return;
  }

  memoryDeletedSessionTombstones.set(sessionId, deletedAt);
  memoryQueuedRecords.delete(sessionId);

  if (!hasChromeStorageLocal()) {
    return;
  }

  try {
    await chrome.storage.local.set({
      [getDeletedSessionStorageKey(sessionId)]: deletedAt,
    });
    await chrome.storage.local.remove(getQueuedRecordStorageKey(sessionId));
    await removeSessionIdFromExitPersistIndex(sessionId);
  } catch {
    // best-effort
  }
}

export async function isSessionDeleted(
  sessionId: string,
  snapshotUpdatedAt?: string,
): Promise<boolean> {
  if (!sessionId) {
    return false;
  }

  const memoryDeletedAt = memoryDeletedSessionTombstones.get(sessionId);
  if (memoryDeletedAt) {
    if (!snapshotUpdatedAt || snapshotUpdatedAt.localeCompare(memoryDeletedAt) <= 0) {
      return true;
    }
  }

  if (!hasChromeStorageLocal()) {
    return false;
  }

  try {
    const key = getDeletedSessionStorageKey(sessionId);
    const snapshot = await chrome.storage.local.get(key);
    const storageDeletedAt = snapshot[key];
    if (typeof storageDeletedAt === "string" && storageDeletedAt) {
      if (!snapshotUpdatedAt || snapshotUpdatedAt.localeCompare(storageDeletedAt) <= 0) {
        return true;
      }
    }
  } catch {
    // best-effort
  }

  return false;
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
    lastQueueWriteError: null,
    lastPageExitPersistAttemptAt: null,
    lastPageExitPersistSessionId: null,
    lastPageExitPersistEntryCount: 0,
    lastPageExitPersistError: null,
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
    lastQueueWriteError:
      typeof candidate.lastQueueWriteError === "string" && candidate.lastQueueWriteError
        ? candidate.lastQueueWriteError
        : null,
    lastPageExitPersistAttemptAt: isValidDateString(candidate.lastPageExitPersistAttemptAt)
      ? candidate.lastPageExitPersistAttemptAt
      : null,
    lastPageExitPersistSessionId:
      typeof candidate.lastPageExitPersistSessionId === "string" &&
      candidate.lastPageExitPersistSessionId
        ? candidate.lastPageExitPersistSessionId
        : null,
    lastPageExitPersistEntryCount:
      typeof candidate.lastPageExitPersistEntryCount === "number"
        ? candidate.lastPageExitPersistEntryCount
        : 0,
    lastPageExitPersistError:
      typeof candidate.lastPageExitPersistError === "string" && candidate.lastPageExitPersistError
        ? candidate.lastPageExitPersistError
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

export async function queueExitPersistRecord(record: SessionRecord): Promise<void> {
  if (!record.id || record.status !== "stopped") {
    return;
  }

  if (await isSessionDeleted(record.id, record.updatedAt)) {
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

  try {
    await chrome.storage.local.set({
      [getQueuedRecordStorageKey(record.id)]: cloneQueuedRecord(nextRecord),
    });
    await addSessionIdToExitPersistIndex(record.id);
    await updatePersistReplayDiagnostics((current) => ({
      ...current,
      lastQueueWriteError: null,
    })).catch(() => {
      // Queue write succeeded; diagnostics update is best-effort.
    });
  } catch (error) {
    await updatePersistReplayDiagnostics((current) => ({
      ...current,
      lastQueueWriteError: error instanceof Error ? error.message : "queued exit persist write failed",
    })).catch(() => {
      // Preserve the original queue write failure even if diagnostics cannot be updated.
    });
    throw error;
  }
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

export async function listQueuedExitPersistRecords(): Promise<QueuedExitPersistRecord[]> {
  if (!hasChromeStorageLocal()) {
    return [...memoryQueuedRecords.values()].map(cloneQueuedRecord);
  }

  const memorySnapshotBeforeRead = [...memoryQueuedRecords.values()].map(cloneQueuedRecord);

  // storage 전체에서 durable queue records와 tombstone을 스캔 (인덱스 누락 및 orphan 방지)
  const allStorage = await chrome.storage.local.get(null);
  const deletedTombstones = new Map<string, string>();
  for (const [key, value] of Object.entries(allStorage)) {
    if (key.startsWith(SESSION_DELETED_PREFIX) && typeof value === "string") {
      const sessionId = key.slice(SESSION_DELETED_PREFIX.length);
      deletedTombstones.set(sessionId, value);
      memoryDeletedSessionTombstones.set(sessionId, value);
    }
  }

  const storageRecords: QueuedExitPersistRecord[] = [];
  const durableSessionIds: string[] = [];
  const orphanedKeysToRemove: string[] = [];

  for (const [key, value] of Object.entries(allStorage)) {
    if (key.startsWith(EXIT_PERSIST_RECORD_PREFIX) && key !== EXIT_PERSIST_INDEX_STORAGE_KEY) {
      const sessionId = key.slice(EXIT_PERSIST_RECORD_PREFIX.length);
      const sanitized = sanitizeQueuedRecord(value);
      const deletedAt =
        deletedTombstones.get(sessionId) ?? memoryDeletedSessionTombstones.get(sessionId);

      if (deletedAt && sanitized && sanitized.record.updatedAt.localeCompare(deletedAt) <= 0) {
        orphanedKeysToRemove.push(key);
        continue;
      }

      if (sanitized) {
        storageRecords.push(sanitized);
        durableSessionIds.push(sessionId);
      }
    }
  }

  if (orphanedKeysToRemove.length > 0) {
    await chrome.storage.local.remove(orphanedKeysToRemove).catch(() => {
      // best-effort
    });
  }

  // Durable keys 기준으로 index 재동기화
  const uniqueSessionIds = [...new Set(durableSessionIds)];
  await writeExitPersistIndex(uniqueSessionIds).catch(() => {
    // best-effort
  });

  const memorySnapshotAfterRead = [...memoryQueuedRecords.values()].map(cloneQueuedRecord);
  const mergedRecords = mergeQueuedRecordCollections(storageRecords, memorySnapshotBeforeRead);
  const freshestRecords = mergeQueuedRecordCollections(mergedRecords, memorySnapshotAfterRead);

  // deleted tombstones 필터링
  const activeRecords = freshestRecords.filter((record) => {
    const deletedAt =
      deletedTombstones.get(record.sessionId) ?? memoryDeletedSessionTombstones.get(record.sessionId);
    if (deletedAt && record.record.updatedAt.localeCompare(deletedAt) <= 0) {
      memoryQueuedRecords.delete(record.sessionId);
      return false;
    }
    return true;
  });

  activeRecords.forEach((record) => {
    const current = memoryQueuedRecords.get(record.sessionId);
    if (!current || compareQueuedRecordFreshness(record, current) >= 0) {
      memoryQueuedRecords.set(record.sessionId, cloneQueuedRecord(record));
    }
  });

  return activeRecords.map(cloneQueuedRecord);
}

export async function clearQueuedExitPersistRecord(sessionId: string): Promise<void> {
  if (!sessionId) {
    return;
  }

  memoryQueuedRecords.delete(sessionId);
  if (!hasChromeStorageLocal()) {
    return;
  }

  try {
    await chrome.storage.local.remove(getQueuedRecordStorageKey(sessionId));
    await removeSessionIdFromExitPersistIndex(sessionId);
  } catch {
    // Queue cleanup is best-effort and must not block other persistence work.
  }
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
  try {
    const snapshot = await chrome.storage.local.get(storageKey);
    const queued = sanitizeQueuedRecord(snapshot[storageKey]);
    if (queued && queued.record.updatedAt.localeCompare(updatedAt) <= 0) {
      await chrome.storage.local.remove(storageKey);
      await removeSessionIdFromExitPersistIndex(sessionId);
    }
  } catch {
    // Queue cleanup is best-effort and must not block other persistence work.
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

export function resetPersistRecoveryMemoryForTests(): void {
  memoryQueuedRecords.clear();
  memoryDiagnostics = createEmptyPersistReplayDiagnostics();
  memoryDeletedSessionTombstones.clear();
}

export async function resetPersistRecoveryStateForTests(): Promise<void> {
  resetPersistRecoveryMemoryForTests();
  if (!hasChromeStorageLocal()) {
    return;
  }

  const snapshot = await chrome.storage.local.get(null);
  const keys = Object.keys(snapshot).filter(
    (key) =>
      key === PERSIST_REPLAY_DIAGNOSTICS_STORAGE_KEY ||
      key === EXIT_PERSIST_INDEX_STORAGE_KEY ||
      key.startsWith(EXIT_PERSIST_RECORD_PREFIX) ||
      key.startsWith(SESSION_DELETED_PREFIX),
  );
  if (keys.length) {
    await chrome.storage.local.remove(keys);
  }
}
