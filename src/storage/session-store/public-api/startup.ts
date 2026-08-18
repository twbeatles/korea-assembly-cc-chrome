/* eslint-disable @typescript-eslint/no-unused-vars */
import {
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
  recoverOrphanedExitPersistRecords,
  resetPersistRecoveryStateForTests,
} from "../../persist-recovery";
import {
  createExtensionContextInvalidatedError,
  hasExtensionContextInvalidated,
  isExtensionContextInvalidatedError,
  markExtensionContextInvalidated,
  resetExtensionContextInvalidationForTests,
} from "../../../shared/extension-context";
import {
  buildSessionBackupFilename,
} from "../../session-backup";
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
import {
  throwIfAborted,
  emitLongTaskProgress,
  createCancelledImportError,
  logStoreError,
} from "../utils";
import {
  toIndexedDbRecord,
  writeChunkedSessionRecord,
  hydrateIndexedDbSessionRecord,
  listIndexedDbSessions,
  listIndexedDbSessionPage,
  listIndexedDbLineageSessions,
  listAllIndexedDbSessions,
  listIndexedDbSessionIds,
  listIndexedDbSessionsByStatus,
} from "../idb/records";
import {
  withRequest,
  withSessionStoresTransaction,
  tryIndexedDb,
} from "../idb/database";
import {
  bumpSessionLibraryRevision,
  stopRunningRecord,
  preserveStoredSessionMetadata,
  writeSessionRecord,
} from "../mutations-internal";
import {
  sortSessions,
  cloneLineageSummary,
  buildSessionLineageSummaries,
  mergeSessionCollections,
  toSessionLibraryPreview,
} from "../lineage-helpers";
import {
  bestEffortDeleteFallbackRecord,
  toSessionMetadataOnly,
  clearChromeFallbackRecordsForTests,
  clearFallbackRecords,
  listFallbackSessionIds,
  saveFallbackRecord,
  loadFallbackRecord,
  listFallbackRecords,
  listFallbackMetadataRecords,
  deleteFallbackRecord,
} from "../fallback/storage";

import { loadSession } from "../load-session";
import { saveSession } from "./mutations";

export async function replayQueuedExitPersistRecords(): Promise<PersistReplaySummary> {
  await recoverOrphanedExitPersistRecords().catch(() => {
    // 고아 복구 실패해도 기존 인덱스 기준으로 replay 를 시도한다.
  });
  const queuedRecords = (await listQueuedExitPersistRecords()).sort((left, right) =>
    left.record.updatedAt.localeCompare(right.record.updatedAt),
  );
  let replayedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const queuedRecord of queuedRecords) {
    try {
      const existingRecord = await loadSession(queuedRecord.sessionId);
      if (
        existingRecord &&
        existingRecord.updatedAt.localeCompare(queuedRecord.record.updatedAt) >= 0
      ) {
        skippedCount += 1;
        await clearQueuedExitPersistRecord(queuedRecord.sessionId);
        continue;
      }

      await saveSession(queuedRecord.record);
      replayedCount += 1;
      await clearQueuedExitPersistRecord(queuedRecord.sessionId);
    } catch (error) {
      failedCount += 1;
      logStoreError(`Failed to replay queued exit persist record for ${queuedRecord.sessionId}`, error);
    }
  }

  return {
    queuedCount: queuedRecords.length,
    replayedCount,
    skippedCount,
    failedCount,
  };
}

export async function closeRunningSessionsOnStartup(): Promise<StartupCleanupSummary> {
  const [indexedDbRecords, fallbackRecords] = await Promise.all([
    tryIndexedDb(async () => listIndexedDbSessionsByStatus("running")),
    listFallbackRecords({ limit: Number.MAX_SAFE_INTEGER }),
  ]);

  const indexedDbRunning =
    indexedDbRecords.ok && indexedDbRecords.value
      ? indexedDbRecords.value.filter((record) => record.status === "running")
      : [];
  const fallbackRunning = fallbackRecords.filter((record) => record.status === "running");
  const statusById = new Map<
    string,
    {
      indexedDbRequired: boolean;
      fallbackRequired: boolean;
      indexedDbClosed: boolean;
      fallbackClosed: boolean;
    }
  >();

  indexedDbRunning.forEach((record) => {
    statusById.set(record.id, {
      indexedDbRequired: true,
      fallbackRequired: statusById.get(record.id)?.fallbackRequired ?? false,
      indexedDbClosed: false,
      fallbackClosed: statusById.get(record.id)?.fallbackClosed ?? false,
    });
  });
  fallbackRunning.forEach((record) => {
    const current = statusById.get(record.id);
    statusById.set(record.id, {
      indexedDbRequired: current?.indexedDbRequired ?? false,
      fallbackRequired: true,
      indexedDbClosed: current?.indexedDbClosed ?? false,
      fallbackClosed: false,
    });
  });

  if (indexedDbRunning.length) {
    const indexedDbWriteResult = await tryIndexedDb(async () =>
      withSessionStoresTransaction("readwrite", async ({ sessionStore, chunkStore }) => {
        await Promise.all(
          indexedDbRunning.map(async (record) => {
            const stoppedRecord = stopRunningRecord(record);
            const chunks = buildSessionEntryChunks(
              stoppedRecord.id,
              stoppedRecord.entries,
              SESSION_ENTRY_CHUNK_SIZE,
            );
            const previousRecord = (await withRequest(
              sessionStore.get(stoppedRecord.id),
            )) as IndexedDbSessionRecord | undefined;
            const metadataRecord = toIndexedDbRecord(stoppedRecord);
            await writeChunkedSessionRecord(
              chunkStore,
              metadataRecord,
              chunks,
              previousRecord,
            );
            await withRequest(sessionStore.put(metadataRecord));
          }),
        );
      }),
    );
    if (indexedDbWriteResult.ok) {
      indexedDbRunning.forEach((record) => {
        const current = statusById.get(record.id);
        if (current) {
          current.indexedDbClosed = true;
        }
      });
    }
  }

  const fallbackResults = await Promise.allSettled(
    fallbackRunning.map(async (record) => {
      await saveFallbackRecord(stopRunningRecord(record));
      return record.id;
    }),
  );
  fallbackResults.forEach((result, index) => {
    if (result.status !== "fulfilled") {
      logStoreError(`Failed to close fallback running session ${fallbackRunning[index]?.id}`, result.reason);
      return;
    }
    const current = statusById.get(result.value);
    if (current) {
      current.fallbackClosed = true;
    }
  });

  const detectedCount = statusById.size;
  const closedCount = [...statusById.values()].filter((status) => {
    const indexedDbDone = status.indexedDbRequired ? status.indexedDbClosed : true;
    const fallbackDone = status.fallbackRequired ? status.fallbackClosed : true;
    return indexedDbDone && fallbackDone;
  }).length;
  if (closedCount > 0) {
    await bumpSessionLibraryRevision();
  }
  return {
    detectedCount,
    closedCount,
    failedCount: detectedCount - closedCount,
  };
}

export async function resetSessionStoreForTests(): Promise<void> {
  memoryFallbackStore.clear();
  resetSessionWriteQueuesForTests();
  resetExtensionContextInvalidationForTests();
  await clearChromeFallbackRecordsForTests();
  await resetPersistRecoveryStateForTests();
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    await chrome.storage.local.remove(SESSION_LIBRARY_REVISION_STORAGE_KEY);
  }
  storeRuntime.indexedDbAvailable = true;
  storeRuntime.indexedDbDisabledUntil = 0;
  storeRuntime.lastIndexedDbOpenError = null;

  if (storeRuntime.dbPromise) {
    try {
      const db = await storeRuntime.dbPromise;
      db.close();
    } catch {
      // Ignore cached open failures while resetting test state.
    }
    storeRuntime.dbPromise = null;
  }

  if (typeof indexedDB === "undefined") {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(SESSION_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to reset session database"));
    request.onblocked = () => resolve();
  });
}
