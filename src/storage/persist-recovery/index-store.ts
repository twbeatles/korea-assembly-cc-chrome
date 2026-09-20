import { EXIT_PERSIST_INDEX_STORAGE_KEY, hasChromeStorageLocal } from "./keys";
import { enqueueExitPersistIndexMutation, memoryQueuedRecords } from "./state";
import { collectExitPersistSessionIdsFromSnapshot, sanitizeExitPersistIndex } from "./sanitize";

/** exit persist 인덱스 read/write와 고아 레코드 복구 (단일 책임: 인덱스 정합성). */
export async function readExitPersistIndex(): Promise<string[]> {
  if (!hasChromeStorageLocal()) {
    return [];
  }
  const snapshot = await chrome.storage.local.get(EXIT_PERSIST_INDEX_STORAGE_KEY);
  return sanitizeExitPersistIndex(snapshot[EXIT_PERSIST_INDEX_STORAGE_KEY]);
}

export async function writeExitPersistIndex(sessionIds: string[]): Promise<void> {
  if (!hasChromeStorageLocal()) {
    return;
  }
  await chrome.storage.local.set({
    [EXIT_PERSIST_INDEX_STORAGE_KEY]: sanitizeExitPersistIndex(sessionIds),
  });
}

export async function addSessionIdToExitPersistIndex(sessionId: string): Promise<void> {
  return enqueueExitPersistIndexMutation(async () => {
    const current = await readExitPersistIndex();
    if (current.includes(sessionId)) {
      return;
    }
    await writeExitPersistIndex([...current, sessionId]);
  });
}

export async function removeSessionIdFromExitPersistIndex(sessionId: string): Promise<void> {
  return enqueueExitPersistIndexMutation(async () => {
    const current = await readExitPersistIndex();
    if (!current.includes(sessionId)) {
      return;
    }
    await writeExitPersistIndex(current.filter((id) => id !== sessionId));
  });
}

/**
 * storage 에 레코드가 있으나 인덱스에서 빠진 고아 id 를 병합한다.
 * startup replay 직전에 1회 호출한다.
 */
export async function recoverOrphanedExitPersistRecords(): Promise<string[]> {
  if (!hasChromeStorageLocal()) {
    return [...memoryQueuedRecords.keys()];
  }

  return enqueueExitPersistIndexMutation(async () => {
    const snapshot = await chrome.storage.local.get(null);
    const scannedIds = collectExitPersistSessionIdsFromSnapshot(snapshot);
    const current = sanitizeExitPersistIndex(snapshot[EXIT_PERSIST_INDEX_STORAGE_KEY]);
    const merged = sanitizeExitPersistIndex([...current, ...scannedIds]);
    if (merged.length !== current.length || merged.some((id) => !current.includes(id))) {
      await writeExitPersistIndex(merged);
    }
    return merged;
  });
}

/**
 * 인덱스가 비어 있을 때 1회성으로 storage 를 스캔해 인덱스를 재구성한다.
 * (마이그레이션 / 구버전 호환)
 */
export async function rebuildExitPersistIndexFromStorage(): Promise<string[]> {
  if (!hasChromeStorageLocal()) {
    return [];
  }
  const snapshot = await chrome.storage.local.get(null);
  const uniqueIds = collectExitPersistSessionIdsFromSnapshot(snapshot);
  await writeExitPersistIndex(uniqueIds);
  return uniqueIds;
}
