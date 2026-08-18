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
  searchRequiresEntryHydration,
  sessionMatchesMetadataFilters,
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
  listIndexedDbSessionMetadataRecords,
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

export { loadSession, loadSessionsByIds } from "../load-session";

export async function getSessionLibraryOverview(
  previewLimit = 3,
): Promise<SessionLibraryOverview> {
  const safePreviewLimit = Math.max(0, previewLimit);
  const fallbackSessionIds = await listFallbackSessionIds();
  if (!fallbackSessionIds.length) {
    const indexedDbResult = await tryIndexedDb(async () =>
      listIndexedDbSessionPage({
        page: 1,
        pageSize: Math.max(1, safePreviewLimit || 1),
      }),
    );
    if (indexedDbResult.ok && indexedDbResult.value) {
      return {
        totalCount: indexedDbResult.value.totalCount,
        previewSessions: indexedDbResult.value.sessions
          .slice(0, safePreviewLimit)
          .map(toSessionLibraryPreview),
      };
    }
  }

  const [indexedDbIdsResult, previewSessions] = await Promise.all([
    tryIndexedDb(async () => listIndexedDbSessionIds()),
    safePreviewLimit > 0 ? listSessions({ limit: safePreviewLimit }) : Promise.resolve([]),
  ]);
  const uniqueIds = new Set<string>(fallbackSessionIds);
  if (indexedDbIdsResult.ok && indexedDbIdsResult.value) {
    indexedDbIdsResult.value.forEach((id) => uniqueIds.add(id));
  }

  return {
    totalCount: uniqueIds.size,
    previewSessions: previewSessions.slice(0, safePreviewLimit).map(toSessionLibraryPreview),
  };
}

export async function buildSessionLibraryBackupExport(
  options: BuildSessionLibraryBackupExportOptions = {},
): Promise<LibraryBackupExport> {
  const pageSize = Math.max(1, options.pageSize ?? 200);

  emitLongTaskProgress(options.onProgress, {
    kind: "backup",
    phase: "prepare",
    completed: 0,
    total: 0,
    message: "전체 JSON 백업을 준비하고 있습니다.",
  });

  emitLongTaskProgress(options.onProgress, {
    kind: "backup",
    phase: "package",
    completed: 0,
    total: 0,
    message: "전체 JSON 백업 파일을 생성하고 있습니다.",
  });

  const now = new Date();
  const { content, sessionCount } = await stringifySessionBackupBundleIncrementally({
    exportedAt: now.toISOString(),
    pageSize,
    signal: options.signal,
    listSessionsPage: async ({ page, pageSize: nextPageSize }) =>
      listSessionsPage({
        page,
        pageSize: nextPageSize,
      }),
    loadSessionsByIds,
    onProgress: (completed, total) => {
      emitLongTaskProgress(options.onProgress, {
        kind: "backup",
        phase: "package",
        completed,
        total,
        message: total
          ? `전체 JSON 백업 파일을 생성하고 있습니다. (${completed} / ${total})`
          : "백업 파일을 생성하고 있습니다.",
      });
    },
  });
  throwIfAborted(options.signal, "전체 JSON 백업을 취소했습니다.");

  return {
    sessionCount,
    payload: {
      filename: buildSessionBackupFilename(now),
      format: "json",
      mimeType: "application/json;charset=utf-8",
      content,
    },
  };
}

export async function listSessions(options: SessionListOptions = {}): Promise<SessionRecord[]> {
  const [indexedDbResult, fallbackRecords] = await Promise.all([
    tryIndexedDb(async () => listIndexedDbSessions(options)),
    listFallbackMetadataRecords({ limit: Number.MAX_SAFE_INTEGER }),
  ]);

  return sortSessions(
    mergeSessionCollections(
      indexedDbResult.ok && indexedDbResult.value
        ? indexedDbResult.value.map((record) =>
            normalizeSessionRecord(record as StoredSessionRecord, { preserveTimestamps: true }),
          )
        : [],
      fallbackRecords.map(toSessionMetadataOnly),
    ),
    options,
  );
}

export async function listSessionLineageSegments(lineageId: string): Promise<SessionRecord[]> {
  const safeLineageId = typeof lineageId === "string" ? lineageId.trim() : "";
  if (!safeLineageId) {
    return [];
  }

  const [indexedDbResult, fallbackRecords] = await Promise.all([
    tryIndexedDb(async () => listIndexedDbLineageSessions(safeLineageId)),
    listFallbackMetadataRecords({ limit: Number.MAX_SAFE_INTEGER }),
  ]);
  const fallbackLineageIds = fallbackRecords
    .filter((session) => resolveSessionLineageId(session.id, session.lineageId) === safeLineageId)
    .map((session) => session.id);
  const fallbackLineageRecords = await Promise.all(
    fallbackLineageIds.map((sessionId) => loadFallbackRecord(sessionId)),
  );

  return sortSessionSegments(
    mergeSessionCollections(
      indexedDbResult.ok && indexedDbResult.value ? indexedDbResult.value : [],
      fallbackLineageRecords.filter((record): record is SessionRecord => Boolean(record)),
    ),
  );
}

export async function listSessionsPage(
  options: SessionPageOptions,
): Promise<SessionPageResult> {
  const fallbackIds = await listFallbackSessionIds();
  if (!fallbackIds.length) {
    const indexedDbResult = await tryIndexedDb(async () => listIndexedDbSessionPage(options));
    if (indexedDbResult.ok && indexedDbResult.value) {
      return indexedDbResult.value;
    }
  }

  const [indexedDbMetadataResult, fallbackRecords] = await Promise.all([
    tryIndexedDb(async () => listIndexedDbSessions({ limit: Number.MAX_SAFE_INTEGER })),
    listFallbackMetadataRecords({ limit: Number.MAX_SAFE_INTEGER }),
  ]);
  const metadataSessions = sortSessions(
    mergeSessionCollections(
      indexedDbMetadataResult.ok && indexedDbMetadataResult.value
        ? indexedDbMetadataResult.value.map(toSessionMetadataOnly)
        : [],
      fallbackRecords.map(toSessionMetadataOnly),
    ),
    { limit: Number.MAX_SAFE_INTEGER },
  );
  const filteredSessions = options.starredOnly
    ? metadataSessions.filter((session) => session.starred)
    : metadataSessions;
  const pageSize = Math.max(1, options.pageSize);
  const totalCount = filteredSessions.length;
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  const page = Math.min(Math.max(1, options.page), pageCount);
  const start = (page - 1) * pageSize;
  const pageMetadataSessions = filteredSessions.slice(start, start + pageSize);

  return {
    sessions: pageMetadataSessions.map(toSessionMetadataOnly),
    totalCount,
    page,
    pageSize,
  };
}

export async function listSessionLineagesPage(
  options: SessionPageOptions,
): Promise<SessionLineagePageResult> {
  const [indexedDbResult, fallbackRecords] = await Promise.all([
    tryIndexedDb(async () => listIndexedDbSessions({ limit: Number.MAX_SAFE_INTEGER })),
    listFallbackMetadataRecords({ limit: Number.MAX_SAFE_INTEGER }),
  ]);
  const allSessions = mergeSessionCollections(
    indexedDbResult.ok && indexedDbResult.value
      ? indexedDbResult.value.map(toSessionMetadataOnly)
      : [],
    fallbackRecords.map(toSessionMetadataOnly),
  );
  const summaries = buildSessionLineageSummaries(allSessions);
  const filteredSummaries = options.starredOnly
    ? summaries.filter((summary) => summary.starred)
    : summaries;
  const pageSize = Math.max(1, options.pageSize);
  const totalCount = filteredSummaries.length;
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  const page = Math.min(Math.max(1, options.page), pageCount);
  const start = (page - 1) * pageSize;

  return {
    lineages: filteredSummaries.slice(start, start + pageSize).map(cloneLineageSummary),
    totalCount,
    page,
    pageSize,
  };
}

export async function searchSessions(
  options: SessionSearchOptions,
): Promise<SessionSearchPageResult> {
  const pageSize = Math.max(1, options.pageSize);
  const requestedPage = Math.max(1, options.page);
  const token = normalizeSearchToken(options.query);
  const [indexedDbResult, fallbackRecords] = await Promise.all([
    tryIndexedDb(async () => listIndexedDbSessionMetadataRecords()),
    listFallbackRecords({ limit: Number.MAX_SAFE_INTEGER }),
  ]);
  const metadataSessions =
    indexedDbResult.ok && indexedDbResult.value
      ? indexedDbResult.value.filter((session) => sessionMatchesMetadataFilters(session, options))
      : [];
  const indexedDbSessions = searchRequiresEntryHydration(options, token)
    ? await loadSessionsByIds(metadataSessions.map((session) => session.id))
    : metadataSessions;
  const allSessions = sortSessions(
    mergeSessionCollections(
      indexedDbSessions.map((record) =>
        normalizeSessionRecord(record as StoredSessionRecord, { preserveTimestamps: true }),
      ),
      fallbackRecords.map((record) =>
        normalizeSessionRecord(record as StoredSessionRecord, { preserveTimestamps: true }),
      ),
    ),
    { limit: Number.MAX_SAFE_INTEGER },
  );
  const results = allSessions
    .map((session) => sessionMatchesSearchFilters(session, options, token))
    .filter((result): result is SessionSearchResult => Boolean(result));
  const totalCount = results.length;
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  const page = Math.min(requestedPage, pageCount);
  const start = (page - 1) * pageSize;

  return {
    results: results.slice(start, start + pageSize),
    totalCount,
    page,
    pageSize,
  };
}

export async function searchSessionLineagesPage(
  options: SessionSearchOptions,
): Promise<SessionLineagePageResult> {
  const pageSize = Math.max(1, options.pageSize);
  const requestedPage = Math.max(1, options.page);
  const sessionSearch = await searchSessions({
    ...options,
    page: 1,
    pageSize: Number.MAX_SAFE_INTEGER,
  });
  const summaries = buildSessionLineageSummaries(
    sessionSearch.results.map((result) => result.session),
  );
  const totalCount = summaries.length;
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  const page = Math.min(requestedPage, pageCount);
  const start = (page - 1) * pageSize;

  return {
    lineages: summaries.slice(start, start + pageSize).map(cloneLineageSummary),
    totalCount,
    page,
    pageSize,
  };
}
