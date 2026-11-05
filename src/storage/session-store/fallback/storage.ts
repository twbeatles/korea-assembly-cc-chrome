/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  enqueueFallbackLibraryWrite,
  enqueueSessionWrite,
  resetSessionWriteQueuesForTests,
} from "../../session-write-queue";
import {
  applySessionContentPatch,
  applySessionMetadataPatch,
  mergeEditableSessionMetadata,
  normalizeEntries,
  normalizeImportedSessionStatus,
  normalizeSessionRecord,
} from "../normalize";
import {
  normalizeSearchToken,
  sessionMatchesSearchFilters,
} from "../search-helpers";

export { SESSION_NOTE_MAX_LENGTH } from "../normalize";
import {
  resolveSessionLineageId,
  resolveSessionSegmentNumber,
} from "../../../core/subtitle-models";
import {
  mergeSessionSegments,
  sortSessionSegments,
} from "../../../core/session-lineage";
import {
  cloneSessionRecord,
  getSessionCharCount,
  type ExportFormat,
  type SessionRecord,
  type StoredSessionRecord,
} from "../../../core/subtitle-models";
import {
  clearQueuedExitPersistRecord,
  clearQueuedExitPersistRecordsUpTo,
  listQueuedExitPersistRecords,
  resetPersistRecoveryStateForTests,
} from "../../persist-recovery";
import {
  createExtensionContextInvalidatedError,
  hasExtensionContextInvalidated,
  isExtensionContextInvalidatedError,
  markExtensionContextInvalidated,
  resetExtensionContextInvalidationForTests,
} from "../../../shared/extension-context";
import { buildSessionBackupFilename } from "../../session-backup";
import { createRandomToken } from "../../../shared/random-token";
import {
  SESSION_DB_SCHEMA_VERSION,
  SESSION_DB_NAME,
  SESSION_RECORD_VERSION,
  SESSION_LIBRARY_REVISION_STORAGE_KEY,
  SESSION_STORE_NAME,
} from "../../../shared/constants";
import type {
  BuildSessionLibraryBackupExportOptions,
  ExportPayload,
  ImportSessionRecordsOptions,
  LibraryBackupExport,
  PersistReplaySummary,
  SessionExportOptions,
  SessionContentPatch,
  SessionMetadataPatch,
  SessionSearchOptions,
  SessionSearchPageResult,
  SessionSearchResult,
  SessionLongTaskProgress,
  SessionImportSummary,
  SessionLibraryOverview,
  SessionLibraryPreview,
  SessionLineagePageResult,
  SessionLineageSummary,
  SessionListOptions,
  SessionPageOptions,
  SessionPageResult,
  StartupCleanupSummary,
} from "../../types";
import {
  buildSessionEntryChunkKey,
  buildSessionEntryChunks,
  getChunkDigests,
  hasChunkedSessionEntries,
  hydrateChunkedSessionRecord,
  SESSION_ENTRY_CHUNK_INDEX_NAME,
  SESSION_ENTRY_CHUNK_SIZE,
  SESSION_ENTRY_CHUNK_STORE_NAME,
  stripSessionEntries,
  toEntrylessSessionRecord,
  type ChunkedSessionMetadataRecord,
  type SessionEntryChunkRecord,
} from "../entry-chunks";
import { stringifySessionBackupBundleIncrementally } from "../backup-bundle";
import { createSessionExportPayload } from "../export-payload";

import {
  LEGACY_FALLBACK_STORAGE_KEY,
  FALLBACK_INDEX_STORAGE_KEY,
  FALLBACK_METADATA_STORAGE_KEY,
  FALLBACK_RECORD_PREFIX,
  storeRuntime,
  memoryFallbackStore,
} from "../globals";
import type {
  IndexedDbAttempt,
  IndexedDbSessionRecord,
  SourcedSessionRecord,
} from "../globals";
import { logStoreError } from "../utils";
import { sortSessions } from "../lineage-helpers";

export async function bestEffortDeleteFallbackRecord(
  id: string,
  upToUpdatedAt?: string,
): Promise<void> {
  try {
    await deleteChromeFallbackRecord(id, upToUpdatedAt);
    const cached = memoryFallbackStore.get(id);
    if (!upToUpdatedAt || (cached && cached.updatedAt <= upToUpdatedAt)) {
      memoryFallbackStore.delete(id);
    }
  } catch (error) {
    logStoreError(`Failed to heal fallback record for ${id}`, error);
  }
}

export function hasChromeStorageFallback(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}

export function sanitizeFallbackIndex(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value.filter(
        (item): item is string => typeof item === "string" && item.length > 0,
      ),
    ),
  ];
}

export function enqueueFallbackMutation<T>(
  action: () => Promise<T>,
): Promise<T> {
  // Every context uses the same library lock, inside any session lock.
  // Internal helpers below must not acquire a session lock while holding it.
  const run = () => enqueueFallbackLibraryWrite(action);
  const next = storeRuntime.fallbackMutationQueue.then(run, run);
  storeRuntime.fallbackMutationQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export function setMemorySnapshot(
  snapshot: Record<string, SessionRecord>,
): void {
  memoryFallbackStore.clear();
  Object.entries(snapshot).forEach(([key, value]) => {
    memoryFallbackStore.set(key, cloneSessionRecord(value));
  });
}

export function toSessionMetadataOnly(record: SessionRecord): SessionRecord {
  return {
    ...cloneSessionRecord(record),
    entries: [],
  };
}

export function cloneFallbackMetadataRecord(
  record: SessionRecord,
): SessionRecord {
  return toSessionMetadataOnly(record);
}

export function sanitizeFallbackMetadataSnapshot(
  value: unknown,
): Record<string, SessionRecord> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const snapshot: Record<string, SessionRecord> = {};
  Object.entries(value as Record<string, SessionRecord>).forEach(
    ([key, record]) => {
      if (
        !record ||
        typeof record !== "object" ||
        typeof record.id !== "string" ||
        !record.id
      ) {
        return;
      }
      snapshot[key] = cloneFallbackMetadataRecord({
        ...record,
        entries: Array.isArray(record.entries) ? record.entries : [],
      });
    },
  );
  return snapshot;
}

export async function readChromeFallbackMetadataSnapshot(): Promise<
  Record<string, SessionRecord> | undefined
> {
  if (!hasChromeStorageFallback()) {
    return undefined;
  }

  try {
    const result = await chrome.storage.local.get(
      FALLBACK_METADATA_STORAGE_KEY,
    );
    return sanitizeFallbackMetadataSnapshot(
      result[FALLBACK_METADATA_STORAGE_KEY],
    );
  } catch (error) {
    logStoreError(
      "Failed to read chrome.storage.local fallback metadata",
      error,
    );
    return undefined;
  }
}

export async function persistChromeFallbackMetadataSnapshot(
  snapshot: Record<string, SessionRecord>,
): Promise<void> {
  if (!hasChromeStorageFallback()) {
    return;
  }

  await chrome.storage.local.set({
    [FALLBACK_METADATA_STORAGE_KEY]: Object.fromEntries(
      Object.entries(snapshot).map(([id, record]) => [
        id,
        cloneFallbackMetadataRecord(record),
      ]),
    ),
  });
}

export function getFallbackRecordStorageKey(id: string): string {
  return `${FALLBACK_RECORD_PREFIX}${id}`;
}

export function getFallbackStorageKeys(
  snapshot: Record<string, unknown>,
): string[] {
  return Object.keys(snapshot).filter(
    (key) =>
      key === LEGACY_FALLBACK_STORAGE_KEY ||
      key === FALLBACK_INDEX_STORAGE_KEY ||
      key === FALLBACK_METADATA_STORAGE_KEY ||
      key.startsWith(FALLBACK_RECORD_PREFIX),
  );
}

export function isQuotaExceededError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /quota|QUOTA|MAX_ITEMS|bytes/i.test(message);
}

export function buildFallbackWriteError(action: string, error: unknown): Error {
  if (
    hasExtensionContextInvalidated() ||
    markExtensionContextInvalidated(error)
  ) {
    return createExtensionContextInvalidatedError();
  }

  if (isQuotaExceededError(error)) {
    return new Error(
      `브라우저 저장소 용량이 가득 차 ${action} 내용을 영구 저장하지 못했습니다.`,
    );
  }

  if (error instanceof Error) {
    return new Error(
      `${action} 처리 중 저장소 fallback에 실패했습니다: ${error.message}`,
    );
  }

  return new Error(`${action} 처리 중 저장소 fallback에 실패했습니다.`);
}

async function migrateLegacyChromeFallbackUnlocked(): Promise<void> {
  if (!hasChromeStorageFallback()) {
    return;
  }

  const result = await chrome.storage.local.get([
    FALLBACK_INDEX_STORAGE_KEY,
    LEGACY_FALLBACK_STORAGE_KEY,
  ]);
  const legacySnapshot = result[LEGACY_FALLBACK_STORAGE_KEY];
  if (!legacySnapshot || typeof legacySnapshot !== "object") {
    return;
  }

  const all = await chrome.storage.local.get(null);
  const snapshot = { ...(legacySnapshot as Record<string, SessionRecord>) };
  // An interrupted migration can leave both formats. Never replace newer keys.
  for (const [key, value] of Object.entries(all)) {
    if (
      !key.startsWith(FALLBACK_RECORD_PREFIX) ||
      !value ||
      typeof value !== "object"
    )
      continue;
    const durable = value as SessionRecord;
    if (
      key !== getFallbackRecordStorageKey(durable.id) ||
      !Array.isArray(durable.entries)
    )
      continue;
    const legacy = snapshot[durable.id];
    if (!legacy || durable.updatedAt >= legacy.updatedAt)
      snapshot[durable.id] = durable;
  }
  const nextIndex = Object.keys(snapshot);
  if (!nextIndex.length) {
    await chrome.storage.local.remove(LEGACY_FALLBACK_STORAGE_KEY);
    return;
  }

  const writes: Record<
    string,
    SessionRecord | string[] | Record<string, SessionRecord>
  > = {
    [FALLBACK_INDEX_STORAGE_KEY]: nextIndex,
    [FALLBACK_METADATA_STORAGE_KEY]: Object.fromEntries(
      nextIndex.map((id) => [id, cloneFallbackMetadataRecord(snapshot[id])]),
    ),
  };
  nextIndex.forEach((id) => {
    writes[getFallbackRecordStorageKey(id)] = cloneSessionRecord(snapshot[id]);
  });

  await chrome.storage.local.set(writes);
  await chrome.storage.local.remove(LEGACY_FALLBACK_STORAGE_KEY);
  setMemorySnapshot(snapshot);
}

export async function migrateLegacyChromeFallbackIfNeeded(): Promise<void> {
  if (hasChromeStorageFallback()) {
    await enqueueFallbackMutation(migrateLegacyChromeFallbackUnlocked);
  }
}

async function recoverFallbackIndexUnlocked(): Promise<{
  index: string[];
  metadata: Record<string, SessionRecord>;
}> {
  await migrateLegacyChromeFallbackUnlocked();
  const all = await chrome.storage.local.get(null);
  const metadata: Record<string, SessionRecord> = {};
  for (const [key, value] of Object.entries(all)) {
    if (
      !key.startsWith(FALLBACK_RECORD_PREFIX) ||
      !value ||
      typeof value !== "object"
    )
      continue;
    const record = value as SessionRecord;
    if (
      key === getFallbackRecordStorageKey(record.id) &&
      record.id &&
      Array.isArray(record.entries)
    ) {
      metadata[record.id] = cloneFallbackMetadataRecord(record);
    }
  }
  const index = Object.keys(metadata).sort();
  if (
    JSON.stringify(
      sanitizeFallbackIndex(all[FALLBACK_INDEX_STORAGE_KEY]).sort(),
    ) !== JSON.stringify(index) ||
    JSON.stringify(all[FALLBACK_METADATA_STORAGE_KEY] ?? {}) !==
      JSON.stringify(metadata)
  ) {
    await chrome.storage.local.set({
      [FALLBACK_INDEX_STORAGE_KEY]: index,
      [FALLBACK_METADATA_STORAGE_KEY]: metadata,
    });
  }
  return { index, metadata };
}

export async function readChromeFallbackIndex(
  strict = false,
): Promise<string[] | undefined> {
  if (!hasChromeStorageFallback()) {
    return undefined;
  }

  try {
    return await enqueueFallbackMutation(
      async () => (await recoverFallbackIndexUnlocked()).index,
    );
  } catch (error) {
    if (strict) throw error;
    logStoreError("Failed to read chrome.storage.local fallback index", error);
    return undefined;
  }
}

export async function readChromeFallbackRecords(
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
      const record = result[getFallbackRecordStorageKey(id)] as
        SessionRecord | undefined;
      if (record) {
        snapshot[id] = cloneSessionRecord(record);
      }
    });
    return snapshot;
  } catch (error) {
    logStoreError(
      "Failed to read chrome.storage.local fallback records",
      error,
    );
    return undefined;
  }
}

export async function readChromeFallbackMetadataRecords(
  ids: string[],
): Promise<Record<string, SessionRecord> | undefined> {
  const records = await readChromeFallbackRecords(ids);
  return records
    ? Object.fromEntries(
        Object.entries(records).map(([id, record]) => [
          id,
          cloneFallbackMetadataRecord(record),
        ]),
      )
    : undefined;
}

export async function saveChromeFallbackRecord(
  record: SessionRecord,
): Promise<void> {
  if (!hasChromeStorageFallback()) {
    return;
  }

  try {
    await enqueueFallbackMutation(async () => {
      const { index, metadata: metadataSnapshot } =
        await recoverFallbackIndexUnlocked();
      const nextIndex = index.includes(record.id)
        ? index
        : [...index, record.id];
      await chrome.storage.local.set({
        [FALLBACK_INDEX_STORAGE_KEY]: nextIndex,
        [FALLBACK_METADATA_STORAGE_KEY]: {
          ...metadataSnapshot,
          [record.id]: cloneFallbackMetadataRecord(record),
        },
        [getFallbackRecordStorageKey(record.id)]: cloneSessionRecord(record),
      });
    });
  } catch (error) {
    throw buildFallbackWriteError("세션", error);
  }
}

export async function deleteChromeFallbackRecord(
  id: string,
  upToUpdatedAt?: string,
): Promise<void> {
  if (!hasChromeStorageFallback()) {
    return;
  }

  try {
    await enqueueFallbackMutation(async () => {
      await migrateLegacyChromeFallbackUnlocked();
      const key = getFallbackRecordStorageKey(id);
      const snapshot = await chrome.storage.local.get(key);
      const current = snapshot[key] as SessionRecord | undefined;
      if (upToUpdatedAt && current && current.updatedAt > upToUpdatedAt) return;
      await chrome.storage.local.remove(getFallbackRecordStorageKey(id));
      await recoverFallbackIndexUnlocked();
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
  if (!hasChromeStorageFallback()) {
    memoryFallbackStore.clear();
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
    memoryFallbackStore.clear();
  } catch (error) {
    throw buildFallbackWriteError(action, error);
  }
}

export async function listFallbackSessionIds(
  strict = false,
): Promise<string[]> {
  const index = await readChromeFallbackIndex(strict);
  if (index) {
    return [...index];
  }

  return [...memoryFallbackStore.keys()];
}

export async function saveFallbackRecord(
  session: SessionRecord,
): Promise<SessionRecord> {
  if (hasExtensionContextInvalidated()) {
    throw createExtensionContextInvalidatedError();
  }

  const record = cloneSessionRecord(session);
  await saveChromeFallbackRecord(record);
  memoryFallbackStore.set(record.id, cloneSessionRecord(record));
  return cloneSessionRecord(record);
}

export async function loadFallbackRecord(
  id: string,
): Promise<SessionRecord | undefined> {
  if (!id) {
    return undefined;
  }

  if (hasChromeStorageFallback()) {
    // Direct keyed read also discovers an orphan, and distinguishes an absent
    // record from a failed read. Never let a stale memory copy undo deletion.
    const key = getFallbackRecordStorageKey(id);
    const result = await chrome.storage.local.get(key);
    const record = result[key] as SessionRecord | undefined;
    if (!record) {
      memoryFallbackStore.delete(id);
      return undefined;
    }
    memoryFallbackStore.set(id, cloneSessionRecord(record));
    return cloneSessionRecord(record);
  }

  const record = memoryFallbackStore.get(id);
  return record ? cloneSessionRecord(record) : undefined;
}

export async function listFallbackRecords(
  options: SessionListOptions = {},
): Promise<SessionRecord[]> {
  const index = await readChromeFallbackIndex();
  if (index) {
    const records = await readChromeFallbackRecords(index);
    if (records) {
      setMemorySnapshot(records);
      return sortSessions(Object.values(records), options);
    }
  }

  return sortSessions([...memoryFallbackStore.values()], options);
}

export async function listFallbackMetadataRecords(
  options: SessionListOptions = {},
): Promise<SessionRecord[]> {
  const index = await readChromeFallbackIndex();
  if (index) {
    const records = await readChromeFallbackMetadataRecords(index);
    if (records) {
      return sortSessions(Object.values(records), options);
    }
  }

  return sortSessions(
    [...memoryFallbackStore.values()].map(cloneFallbackMetadataRecord),
    options,
  );
}

export async function deleteFallbackRecord(id: string): Promise<void> {
  if (!id) {
    return;
  }

  if (hasExtensionContextInvalidated()) {
    throw createExtensionContextInvalidatedError();
  }

  await deleteChromeFallbackRecord(id);
  memoryFallbackStore.delete(id);
}
