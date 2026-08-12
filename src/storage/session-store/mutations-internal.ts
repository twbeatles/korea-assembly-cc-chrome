/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  enqueueSessionWrite,
  resetSessionWriteQueuesForTests,
} from "../session-write-queue";
import {
  applySessionContentPatch,
  applySessionMetadataPatch,
  mergeEditableSessionMetadata,
  normalizeEntries,
  normalizeImportedSessionStatus,
  normalizeSessionRecord,
} from "./normalize";
import {
  normalizeSearchToken,
  sessionMatchesSearchFilters,
} from "./search-helpers";

export { SESSION_NOTE_MAX_LENGTH } from "./normalize";
import {
  resolveSessionLineageId,
  resolveSessionSegmentNumber,
} from "../../core/subtitle-models";
import {
  mergeSessionSegments,
  sortSessionSegments,
} from "../../core/session-lineage";
import {
  cloneSessionRecord,
  getSessionCharCount,
  type ExportFormat,
  type SessionRecord,
  type StoredSessionRecord,
} from "../../core/subtitle-models";
import {
  clearQueuedExitPersistRecord,
  clearQueuedExitPersistRecordsUpTo,
  listQueuedExitPersistRecords,
  resetPersistRecoveryStateForTests,
} from "../persist-recovery";
import {
  createExtensionContextInvalidatedError,
  hasExtensionContextInvalidated,
  isExtensionContextInvalidatedError,
  markExtensionContextInvalidated,
  resetExtensionContextInvalidationForTests,
} from "../../shared/extension-context";
import {
  buildSessionBackupFilename,
} from "../session-backup";
import { createRandomToken } from "../../shared/random-token";
import {
  SESSION_DB_SCHEMA_VERSION,
  SESSION_DB_NAME,
  SESSION_RECORD_VERSION,
  SESSION_LIBRARY_REVISION_STORAGE_KEY,
  SESSION_STORE_NAME,
} from "../../shared/constants";
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
} from "../types";
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
} from "./entry-chunks";
import { stringifySessionBackupBundleIncrementally } from "./backup-bundle";
import { createSessionExportPayload } from "./export-payload";

import {
  LEGACY_FALLBACK_STORAGE_KEY,
  FALLBACK_INDEX_STORAGE_KEY,
  FALLBACK_METADATA_STORAGE_KEY,
  FALLBACK_RECORD_PREFIX,
  storeRuntime,
  memoryFallbackStore,
} from "./globals";
import type {
  IndexedDbAttempt,
  IndexedDbSessionRecord,
  SourcedSessionRecord,
} from "./globals";
import {
  logStoreError,
} from "./utils";
import {
  toIndexedDbRecord,
  writeChunkedSessionRecord,
} from "./idb/records";
import {
  withRequest,
  withSessionStoresTransaction,
  tryIndexedDb,
} from "./idb/database";
import {
  bestEffortDeleteFallbackRecord,
  saveFallbackRecord,
} from "./fallback/storage";
import { loadSession } from "./load-session";

export function stopRunningRecord(record: SessionRecord): SessionRecord {
  const stoppedAt = record.updatedAt || new Date().toISOString();
  const entries = normalizeEntries(record.entries);

  return {
    ...record,
    version: SESSION_RECORD_VERSION,
    status: "stopped",
    endedAt: record.endedAt ?? stoppedAt,
    updatedAt: stoppedAt,
    subtitleCount: entries.length,
    charCount: getSessionCharCount(entries),
    entries,
  };
}

export async function preserveStoredSessionMetadata(record: SessionRecord): Promise<SessionRecord> {
  if (hasExtensionContextInvalidated()) {
    throw createExtensionContextInvalidatedError();
  }

  const existingRecord = await loadSession(record.id);
  return mergeEditableSessionMetadata(record, existingRecord);
}

async function writeSessionRecordUnlocked(
  record: SessionRecord,
  options: {
    allowFallbackOnIndexedDbError?: boolean;
    notifyRevision?: boolean;
  } = {},
): Promise<SessionRecord> {
  if (hasExtensionContextInvalidated()) {
    throw createExtensionContextInvalidatedError();
  }

  const allowFallbackOnIndexedDbError = options.allowFallbackOnIndexedDbError !== false;
  const notifyRevision = options.notifyRevision !== false;
  const indexedDbResult = await tryIndexedDb(async () => {
    const chunks = buildSessionEntryChunks(record.id, record.entries, SESSION_ENTRY_CHUNK_SIZE);
    await withSessionStoresTransaction("readwrite", async ({ sessionStore, chunkStore }) => {
      const previousRecord = (await withRequest(
        sessionStore.get(record.id),
      )) as IndexedDbSessionRecord | undefined;
      const metadataRecord = toIndexedDbRecord(record);
      await writeChunkedSessionRecord(chunkStore, metadataRecord, chunks, previousRecord);
      await withRequest(sessionStore.put(metadataRecord));
      return record;
    });
    return record;
  });

  if (indexedDbResult.ok && indexedDbResult.value) {
    await bestEffortDeleteFallbackRecord(record.id);
    await clearQueuedExitPersistRecordsUpTo(record.id, record.updatedAt);
    if (notifyRevision) {
      await bumpSessionLibraryRevision();
    }
    return cloneSessionRecord(indexedDbResult.value);
  }

  if (hasExtensionContextInvalidated() || markExtensionContextInvalidated(indexedDbResult.error)) {
    throw createExtensionContextInvalidatedError();
  }

  if (!allowFallbackOnIndexedDbError && indexedDbResult.error) {
    throw indexedDbResult.error instanceof Error
      ? indexedDbResult.error
      : new Error("IndexedDB session write failed");
  }

  const savedFallbackRecord = await saveFallbackRecord(record);
  await clearQueuedExitPersistRecordsUpTo(savedFallbackRecord.id, savedFallbackRecord.updatedAt);
  if (notifyRevision) {
    await bumpSessionLibraryRevision();
  }
  return savedFallbackRecord;
}

export interface WriteSessionRecordOptions {
  allowFallbackOnIndexedDbError?: boolean;
  notifyRevision?: boolean;
  /**
   * false 이면 호출측이 이미 enqueueSessionWrite 로 직렬화한 것으로 보고
   * 내부 큐를 생략한다. (중첩 큐 deadlock 방지)
   */
  enqueue?: boolean;
}

/**
 * 세션 영속화 단일 진입점. 기본으로 동일 id 쓰기를 enqueueSessionWrite 로 직렬화한다.
 * load-modify-write 는 같은 큐 안에서 enqueue:false 로 호출한다.
 */
export async function writeSessionRecord(
  record: SessionRecord,
  options: WriteSessionRecordOptions = {},
): Promise<SessionRecord> {
  if (hasExtensionContextInvalidated()) {
    throw createExtensionContextInvalidatedError();
  }

  const { enqueue = true, ...writeOptions } = options;
  if (!enqueue) {
    return writeSessionRecordUnlocked(record, writeOptions);
  }

  return enqueueSessionWrite(record.id, () =>
    writeSessionRecordUnlocked(record, writeOptions),
  );
}

export async function bumpSessionLibraryRevision(): Promise<void> {
  if (hasExtensionContextInvalidated() || typeof chrome === "undefined" || !chrome.storage?.local) {
    return;
  }

  try {
    await chrome.storage.local.set({
      [SESSION_LIBRARY_REVISION_STORAGE_KEY]: `${Date.now()}:${createRandomToken()}`,
    });
  } catch (error) {
    logStoreError("Failed to bump session library revision", error);
  }
}
