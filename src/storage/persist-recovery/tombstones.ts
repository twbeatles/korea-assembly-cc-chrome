import { getDeletedSessionStorageKey, getQueuedRecordStorageKey, hasChromeStorageLocal } from "./keys";
import { removeSessionIdFromExitPersistIndex } from "./index-store";
import { memoryDeletedSessionTombstones, memoryQueuedRecords } from "./state";

/** 삭제 세션 tombstone 기록·조회 (단일 책임: 삭제된 세션의 큐 부활 방지). */
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
