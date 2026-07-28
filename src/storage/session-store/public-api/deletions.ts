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

import { listSessionLineageSegments } from "./queries";

export async function deleteSession(id: string): Promise<void> {
  if (!id) {
    return;
  }

  const indexedDbResult = await tryIndexedDb(async () => {
    await withSessionStoresTransaction("readwrite", async ({ sessionStore, chunkStore }) => {
      const record = (await withRequest(sessionStore.get(id))) as IndexedDbSessionRecord | undefined;
      const chunkCount =
        typeof record?.entryChunkCount === "number" && record.entryChunkCount >= 0
          ? record.entryChunkCount
          : 0;
      await Promise.all([
        withRequest(sessionStore.delete(id)),
        ...Array.from({ length: chunkCount }, (_value, index) =>
          withRequest(chunkStore.delete(buildSessionEntryChunkKey(id, index))),
        ),
      ]);
    });
    return true;
  });

  if (indexedDbResult.ok && indexedDbResult.value) {
    await bestEffortDeleteFallbackRecord(id);
    await bumpSessionLibraryRevision();
    return;
  }

  await deleteFallbackRecord(id);
  await bumpSessionLibraryRevision();
}

export async function deleteSessionLineage(lineageId: string): Promise<void> {
  const safeLineageId = typeof lineageId === "string" ? lineageId.trim() : "";
  if (!safeLineageId) {
    return;
  }

  const segments = await listSessionLineageSegments(safeLineageId);
  const ids = segments.map((session) => session.id);
  if (!ids.length) {
    return;
  }

  await Promise.all(ids.map((id) => deleteSession(id)));
}

export async function deleteAllSessions(): Promise<void> {
  const errors: string[] = [];
  let clearedAnyStore = false;
  const indexedDbResult = await tryIndexedDb(async () => {
    await withSessionStoresTransaction("readwrite", async ({ sessionStore, chunkStore }) => {
      await Promise.all([
        withRequest(sessionStore.clear()),
        withRequest(chunkStore.clear()),
      ]);
    });
    return true;
  });

  if (indexedDbResult.ok && indexedDbResult.value) {
    clearedAnyStore = true;
  } else if (indexedDbResult.error) {
    const message =
      indexedDbResult.error instanceof Error
        ? indexedDbResult.error.message
        : "알 수 없는 오류";
    errors.push(`IndexedDB 정리 실패: ${message}`);
  }

  try {
    await clearFallbackRecords("전체 세션 삭제");
    clearedAnyStore = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    errors.push(`fallback 저장소 정리 실패: ${message}`);
  }

  if (clearedAnyStore) {
    await bumpSessionLibraryRevision();
  }
  if (errors.length > 0) {
    const partialSuccessLabel = clearedAnyStore ? " 다른 저장소 정리는 완료했습니다." : "";
    throw new Error(`${errors.join(" / ")}.${partialSuccessLabel}`);
  }
}
