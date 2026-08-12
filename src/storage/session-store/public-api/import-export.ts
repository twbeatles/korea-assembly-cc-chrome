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

import { loadSessionsByIds } from "../load-session";
import { listSessionLineageSegments } from "./queries";

export async function importSessionRecords(
  sessions: StoredSessionRecord[],
  options: ImportSessionRecordsOptions = {},
): Promise<SessionImportSummary> {
  const importedById = new Map<string, SessionRecord>();
  let sanitizedCount = 0;

  emitLongTaskProgress(options.onProgress, {
    kind: "import",
    phase: "sanitize",
    completed: 0,
    total: sessions.length,
    message: sessions.length
      ? `가져올 기록을 정리하고 있습니다. (0 / ${sessions.length})`
      : "가져올 기록이 없습니다.",
  });

  for (const session of sessions) {
    throwIfAborted(options.signal, "JSON 가져오기를 취소했습니다.");
    const normalized = normalizeSessionRecord(session, {
      preserveTimestamps: true,
      forceStatus: normalizeImportedSessionStatus(session.status),
    });
    const current = importedById.get(normalized.id);
    if (!current || normalized.updatedAt.localeCompare(current.updatedAt) > 0) {
      importedById.set(normalized.id, normalized);
    }
    sanitizedCount += 1;
    emitLongTaskProgress(options.onProgress, {
      kind: "import",
      phase: "sanitize",
      completed: sanitizedCount,
      total: sessions.length,
      message: `가져올 기록을 정리하고 있습니다. (${sanitizedCount} / ${sessions.length})`,
    });
  }

  throwIfAborted(options.signal, "JSON 가져오기를 취소했습니다.");
  emitLongTaskProgress(options.onProgress, {
    kind: "import",
    phase: "compare",
    completed: 0,
    total: importedById.size,
    message: importedById.size
      ? "기존 기록과 비교하고 있습니다."
      : "가져올 기록이 없습니다.",
  });
  const existingSessions = await loadSessionsByIds([...importedById.keys()]);
  throwIfAborted(options.signal, "JSON 가져오기를 취소했습니다.");
  const existingById = new Map(existingSessions.map((session) => [session.id, session]));

  let addedCount = 0;
  let updatedCount = 0;
  let keptCount = 0;
  let failedCount = 0;
  let processedCount = 0;
  const summary = (): SessionImportSummary => ({
    addedCount,
    updatedCount,
    keptCount,
    failedCount,
  });

  emitLongTaskProgress(options.onProgress, {
    kind: "import",
    phase: "write",
    completed: 0,
    total: importedById.size,
    message: importedById.size
      ? `JSON 가져오기를 진행하고 있습니다. (0 / ${importedById.size})`
      : "가져올 기록이 없습니다.",
  });

  for (const record of importedById.values()) {
    if (options.signal?.aborted) {
      if (addedCount > 0 || updatedCount > 0) {
        await bumpSessionLibraryRevision();
      }
      throw createCancelledImportError(summary());
    }

    try {
      const existing = existingById.get(record.id);
      if (!existing) {
        await writeSessionRecord(record, {
          notifyRevision: false,
        });
        addedCount += 1;
      } else if (record.updatedAt.localeCompare(existing.updatedAt) > 0) {
        await writeSessionRecord(record, {
          notifyRevision: false,
        });
        updatedCount += 1;
      } else {
        keptCount += 1;
      }
    } catch (error) {
      failedCount += 1;
      logStoreError(`Failed to import session ${record.id}`, error);
    } finally {
      processedCount += 1;
      emitLongTaskProgress(options.onProgress, {
        kind: "import",
        phase: "write",
        completed: processedCount,
        total: importedById.size,
        message: `JSON 가져오기를 진행하고 있습니다. (${processedCount} / ${importedById.size})`,
      });
    }
  }

  if (addedCount > 0 || updatedCount > 0) {
    await bumpSessionLibraryRevision();
  }

  return {
    addedCount,
    updatedCount,
    keptCount,
    failedCount,
  };
}

export async function exportSessionData(
  session: SessionRecord,
  format: ExportFormat,
  options: SessionExportOptions = {},
): Promise<ExportPayload> {
  return createSessionExportPayload({
    session,
    format,
    normalizeSessionRecord,
    exportOptions: options,
  });
}

export async function exportSessionLineageData(
  lineageId: string,
  format: ExportFormat,
  options: SessionExportOptions = {},
): Promise<ExportPayload> {
  const segments = await listSessionLineageSegments(lineageId);
  if (!segments.length) {
    throw new Error("내보낼 연속 캡처 기록을 찾지 못했습니다.");
  }

  const mergedSession = mergeSessionSegments(segments);
  const entries = Array.isArray(options.entryIds)
    ? mergedSession.entries.filter((entry) => options.entryIds?.includes(entry.id))
    : options.entries;

  return createSessionExportPayload({
    session: mergedSession,
    format,
    normalizeSessionRecord,
    exportOptions: {
      ...options,
      entries,
    },
  });
}
