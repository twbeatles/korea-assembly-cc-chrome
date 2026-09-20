import { cloneSessionRecord, type SessionRecord } from "../../core/subtitle-models";
import type { QueuedExitPersistRecord } from "../types";
import { EXIT_PERSIST_INDEX_STORAGE_KEY, EXIT_PERSIST_RECORD_PREFIX, SESSION_DELETED_PREFIX, getQueuedRecordStorageKey, hasChromeStorageLocal } from "./keys";
import { addSessionIdToExitPersistIndex, removeSessionIdFromExitPersistIndex, writeExitPersistIndex } from "./index-store";
import { isSessionDeleted } from "./tombstones";
import { updatePersistReplayDiagnostics } from "./diagnostics";
import { memoryDeletedSessionTombstones, memoryQueuedRecords } from "./state";
import { cloneQueuedRecord, compareQueuedRecordFreshness, mergeQueuedRecordCollections, sanitizeQueuedRecord } from "./sanitize";

/** 종료 복구 큐 enqueue/list/clear (단일 책임: durable 큐 연산). */
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
