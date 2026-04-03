import { cloneSessionRecord, type SessionRecord } from "../../core/subtitle-models";
import type { SessionListOptions } from "../types";
import { mergeFallbackSnapshots } from "./merge";
import { sortSessions } from "./normalize";
import { logStoreError } from "./shared";
import {
  FALLBACK_INDEX_STORAGE_KEY,
  FALLBACK_RECORD_PREFIX,
  LEGACY_FALLBACK_STORAGE_KEY,
  sessionStoreState,
} from "./state";

export async function bestEffortDeleteFallbackRecord(id: string): Promise<void> {
  try {
    await deleteFallbackRecord(id);
  } catch (error) {
    logStoreError(`Failed to heal fallback record for ${id}`, error);
  }
}

function hasChromeStorageFallback(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}

function sanitizeFallbackIndex(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0)),
  ];
}

function enqueueFallbackMutation<T>(action: () => Promise<T>): Promise<T> {
  const next = sessionStoreState.fallbackMutationQueue.then(action, action);
  sessionStoreState.fallbackMutationQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function setMemorySnapshot(snapshot: Record<string, SessionRecord>): void {
  sessionStoreState.memoryFallbackStore.clear();
  Object.entries(snapshot).forEach(([key, value]) => {
    sessionStoreState.memoryFallbackStore.set(key, cloneSessionRecord(value));
  });
}

function getMemorySnapshot(): Record<string, SessionRecord> {
  return Object.fromEntries(
    [...sessionStoreState.memoryFallbackStore.entries()].map(([key, value]) => [
      key,
      cloneSessionRecord(value),
    ]),
  );
}

function getFallbackRecordStorageKey(id: string): string {
  return `${FALLBACK_RECORD_PREFIX}${id}`;
}

function getFallbackStorageKeys(snapshot: Record<string, unknown>): string[] {
  return Object.keys(snapshot).filter(
    (key) =>
      key === LEGACY_FALLBACK_STORAGE_KEY ||
      key === FALLBACK_INDEX_STORAGE_KEY ||
      key.startsWith(FALLBACK_RECORD_PREFIX),
  );
}

function isQuotaExceededError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /quota|QUOTA|MAX_ITEMS|bytes/i.test(message);
}

function buildFallbackWriteError(action: string, error: unknown): Error {
  if (isQuotaExceededError(error)) {
    return new Error(`브라우저 저장소 용량이 가득 차 ${action} 내용을 영구 저장하지 못했습니다.`);
  }

  if (error instanceof Error) {
    return new Error(`${action} 처리 중 저장소 fallback에 실패했습니다: ${error.message}`);
  }

  return new Error(`${action} 처리 중 저장소 fallback에 실패했습니다.`);
}

async function migrateLegacyChromeFallbackIfNeeded(): Promise<void> {
  if (!hasChromeStorageFallback()) {
    return;
  }
  if (sessionStoreState.legacyFallbackMigrationCompleted) {
    return;
  }

  if (!sessionStoreState.legacyFallbackMigrationPromise) {
    sessionStoreState.legacyFallbackMigrationPromise = (async () => {
      const result = await chrome.storage.local.get([
        FALLBACK_INDEX_STORAGE_KEY,
        LEGACY_FALLBACK_STORAGE_KEY,
      ]);
      const existingIndex = sanitizeFallbackIndex(result[FALLBACK_INDEX_STORAGE_KEY]);

      if (existingIndex.length === 0) {
        const legacySnapshot = result[LEGACY_FALLBACK_STORAGE_KEY];
        if (legacySnapshot && typeof legacySnapshot === "object") {
          const snapshot = legacySnapshot as Record<string, SessionRecord>;
          const nextIndex = Object.keys(snapshot);
          if (!nextIndex.length) {
            await chrome.storage.local.remove(LEGACY_FALLBACK_STORAGE_KEY);
          } else {
            const writes: Record<string, SessionRecord | string[]> = {
              [FALLBACK_INDEX_STORAGE_KEY]: nextIndex,
            };
            nextIndex.forEach((id) => {
              writes[getFallbackRecordStorageKey(id)] = cloneSessionRecord(snapshot[id]);
            });

            await chrome.storage.local.set(writes);
            await chrome.storage.local.remove(LEGACY_FALLBACK_STORAGE_KEY);
            setMemorySnapshot(snapshot);
          }
        }
      }

      sessionStoreState.legacyFallbackMigrationCompleted = true;
    })()
      .catch((error) => {
        sessionStoreState.legacyFallbackMigrationPromise = null;
        throw error;
      })
      .finally(() => {
        if (sessionStoreState.legacyFallbackMigrationCompleted) {
          sessionStoreState.legacyFallbackMigrationPromise = null;
        }
      });
  }

  await sessionStoreState.legacyFallbackMigrationPromise;
}

async function readChromeFallbackIndex(): Promise<string[] | undefined> {
  if (!hasChromeStorageFallback()) {
    return undefined;
  }

  try {
    await migrateLegacyChromeFallbackIfNeeded();
    const result = await chrome.storage.local.get(FALLBACK_INDEX_STORAGE_KEY);
    return sanitizeFallbackIndex(result[FALLBACK_INDEX_STORAGE_KEY]);
  } catch (error) {
    logStoreError("Failed to read chrome.storage.local fallback index", error);
    return undefined;
  }
}

async function readChromeFallbackRecords(
  ids: string[],
): Promise<Record<string, SessionRecord> | undefined> {
  if (!hasChromeStorageFallback()) {
    return undefined;
  }

  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (!uniqueIds.length) {
    return {};
  }

  try {
    const keys = uniqueIds.map(getFallbackRecordStorageKey);
    const result = await chrome.storage.local.get(keys);
    const snapshot: Record<string, SessionRecord> = {};
    uniqueIds.forEach((id) => {
      const record = result[getFallbackRecordStorageKey(id)] as SessionRecord | undefined;
      if (record) {
        snapshot[id] = cloneSessionRecord(record);
      }
    });
    return snapshot;
  } catch (error) {
    logStoreError("Failed to read chrome.storage.local fallback records", error);
    return undefined;
  }
}

async function readUnifiedFallbackSnapshot(): Promise<Record<string, SessionRecord>> {
  const memorySnapshot = getMemorySnapshot();
  const index = await readChromeFallbackIndex();
  const uniqueIds = [...new Set([...(index ?? []), ...Object.keys(memorySnapshot)])];

  if (!uniqueIds.length) {
    return memorySnapshot;
  }

  const storageSnapshot = (await readChromeFallbackRecords(uniqueIds)) ?? {};
  const mergedSnapshot = mergeFallbackSnapshots(storageSnapshot, memorySnapshot);
  setMemorySnapshot(mergedSnapshot);
  return mergedSnapshot;
}

async function saveChromeFallbackRecord(record: SessionRecord): Promise<void> {
  if (!hasChromeStorageFallback()) {
    return;
  }

  try {
    await enqueueFallbackMutation(async () => {
      await migrateLegacyChromeFallbackIfNeeded();
      const index = (await readChromeFallbackIndex()) ?? [];
      const nextIndex = index.includes(record.id) ? index : [...index, record.id];
      await chrome.storage.local.set({
        [FALLBACK_INDEX_STORAGE_KEY]: nextIndex,
        [getFallbackRecordStorageKey(record.id)]: cloneSessionRecord(record),
      });
    });
  } catch (error) {
    throw buildFallbackWriteError("세션", error);
  }
}

async function deleteChromeFallbackRecord(id: string): Promise<void> {
  if (!hasChromeStorageFallback()) {
    return;
  }

  try {
    await enqueueFallbackMutation(async () => {
      await migrateLegacyChromeFallbackIfNeeded();
      const index = (await readChromeFallbackIndex()) ?? [];
      const nextIndex = index.filter((item) => item !== id);
      await chrome.storage.local.set({
        [FALLBACK_INDEX_STORAGE_KEY]: nextIndex,
      });
      await chrome.storage.local.remove(getFallbackRecordStorageKey(id));
    });
  } catch (error) {
    throw buildFallbackWriteError("세션 삭제", error);
  }
}

export async function clearChromeFallbackRecordsForTests(): Promise<void> {
  if (!hasChromeStorageFallback()) {
    return;
  }

  try {
    const all = await chrome.storage.local.get(null);
    const keys = getFallbackStorageKeys(all);
    if (keys.length) {
      await chrome.storage.local.remove(keys);
    }
  } catch (error) {
    logStoreError("Failed to clear chrome.storage.local fallback", error);
  }
}

export async function clearFallbackRecords(action: string): Promise<void> {
  sessionStoreState.memoryFallbackStore.clear();
  if (!hasChromeStorageFallback()) {
    return;
  }

  try {
    await enqueueFallbackMutation(async () => {
      const all = await chrome.storage.local.get(null);
      const keys = getFallbackStorageKeys(all);
      if (keys.length) {
        await chrome.storage.local.remove(keys);
      }
    });
  } catch (error) {
    throw buildFallbackWriteError(action, error);
  }
}

export async function listFallbackSessionIds(): Promise<string[]> {
  const index = await readChromeFallbackIndex();
  return [...new Set([...(index ?? []), ...sessionStoreState.memoryFallbackStore.keys()])];
}

export async function saveFallbackRecord(session: SessionRecord): Promise<SessionRecord> {
  const record = cloneSessionRecord(session);
  sessionStoreState.memoryFallbackStore.set(record.id, cloneSessionRecord(record));
  await saveChromeFallbackRecord(record);
  return cloneSessionRecord(record);
}

export async function loadFallbackRecord(id: string): Promise<SessionRecord | undefined> {
  if (!id) {
    return undefined;
  }

  const memorySnapshot = getMemorySnapshot();
  const storageSnapshot = (await readChromeFallbackRecords([id])) ?? {};
  const mergedSnapshot = mergeFallbackSnapshots(
    storageSnapshot,
    memorySnapshot[id] ? { [id]: memorySnapshot[id] } : {},
  );
  const record = mergedSnapshot[id];
  if (!record) {
    return undefined;
  }

  sessionStoreState.memoryFallbackStore.set(id, cloneSessionRecord(record));
  return cloneSessionRecord(record);
}

export async function listFallbackRecords(
  options: SessionListOptions = {},
): Promise<SessionRecord[]> {
  const records = await readUnifiedFallbackSnapshot();
  return sortSessions(Object.values(records), options);
}

export async function deleteFallbackRecord(id: string): Promise<void> {
  if (!id) {
    return;
  }

  sessionStoreState.memoryFallbackStore.delete(id);
  await deleteChromeFallbackRecord(id);
}

export function resetFallbackModuleState(): void {
  sessionStoreState.memoryFallbackStore.clear();
  sessionStoreState.fallbackMutationQueue = Promise.resolve();
  sessionStoreState.legacyFallbackMigrationPromise = null;
  sessionStoreState.legacyFallbackMigrationCompleted = false;
}
