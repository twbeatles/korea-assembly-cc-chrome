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
  throwIfAborted,
  emitLongTaskProgress,
  createCancelledImportError,
  logStoreError,
} from "./utils";
import {
  toIndexedDbRecord,
  writeChunkedSessionRecord,
  hydrateIndexedDbSessionRecord,
  listIndexedDbSessions,
  listIndexedDbSessionPage,
  listIndexedDbLineageSessions,
  listAllIndexedDbSessions,
  listIndexedDbSessionIds,
} from "./idb/records";
import {
  withRequest,
  withSessionStoresTransaction,
  tryIndexedDb,
} from "./idb/database";
import {
  bumpSessionLibraryRevision,
  stopRunningRecord,
  preserveStoredSessionMetadata,
  writeSessionRecord,
} from "./mutations-internal";
import {
  sortSessions,
  cloneLineageSummary,
  buildSessionLineageSummaries,
  mergeSessionCollections,
  toSessionLibraryPreview,
} from "./lineage-helpers";
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
} from "./fallback/storage";

export async function saveSession(session: SessionRecord): Promise<SessionRecord> {
  if (hasExtensionContextInvalidated()) {
    throw createExtensionContextInvalidatedError();
  }

  const record = await preserveStoredSessionMetadata(
    normalizeSessionRecord(
      {
        ...session,
        status: session.status === "running" ? "saved" : session.status,
      },
      {
        forceStatus: session.status === "running" ? "saved" : session.status,
      },
    ),
  );
  return writeSessionRecord(record);
}

export async function updateRunningSession(session: SessionRecord): Promise<SessionRecord> {
  if (hasExtensionContextInvalidated()) {
    throw createExtensionContextInvalidatedError();
  }

  const record = await preserveStoredSessionMetadata(
    normalizeSessionRecord(
      {
        ...session,
        status: "running",
      },
      {
        forceStatus: "running",
      },
    ),
  );
  return writeSessionRecord(record);
}

export async function upsertSessionRecord(session: SessionRecord): Promise<SessionRecord> {
  if (hasExtensionContextInvalidated()) {
    throw createExtensionContextInvalidatedError();
  }

  const record = normalizeSessionRecord(session, {
    forceStatus: session.status,
  });
  return writeSessionRecord(record);
}

export async function updateSessionMetadata(
  sessionId: string,
  patch: SessionMetadataPatch,
): Promise<SessionRecord> {
  if (hasExtensionContextInvalidated()) {
    throw createExtensionContextInvalidatedError();
  }
  if (!sessionId) {
    throw new Error("기록을 찾지 못했습니다.");
  }

  return enqueueSessionWrite(sessionId, async () => {
    if (hasExtensionContextInvalidated()) {
      throw createExtensionContextInvalidatedError();
    }
    const existingRecord = await loadSession(sessionId);
    if (!existingRecord) {
      throw new Error("기록을 찾지 못했습니다.");
    }

    const updatedAt = new Date().toISOString();
    const record = applySessionMetadataPatch(existingRecord, patch, updatedAt);
    return writeSessionRecord(record);
  });
}

export async function updateSessionLineageMetadata(
  lineageId: string,
  patch: SessionMetadataPatch,
): Promise<SessionRecord[]> {
  const safeLineageId = typeof lineageId === "string" ? lineageId.trim() : "";
  if (!safeLineageId) {
    throw new Error("기록을 찾지 못했습니다.");
  }

  return enqueueSessionWrite(`lineage:${safeLineageId}`, async () => {
    const segments = await listSessionLineageSegments(safeLineageId);
    if (!segments.length) {
      throw new Error("기록을 찾지 못했습니다.");
    }

    const updatedAt = new Date().toISOString();
    const records: SessionRecord[] = [];
    for (const segment of segments) {
      const saved = await enqueueSessionWrite(segment.id, async () => {
        const latest = (await loadSession(segment.id)) ?? segment;
        return writeSessionRecord(applySessionMetadataPatch(latest, patch, updatedAt), {
          notifyRevision: false,
        });
      });
      records.push(saved);
    }
    await bumpSessionLibraryRevision();
    return records.map(cloneSessionRecord);
  });
}

export async function updateSessionContent(
  sessionId: string,
  patch: SessionContentPatch,
): Promise<SessionRecord> {
  if (hasExtensionContextInvalidated()) {
    throw createExtensionContextInvalidatedError();
  }
  if (!sessionId) {
    throw new Error("기록을 찾지 못했습니다.");
  }

  return enqueueSessionWrite(sessionId, async () => {
    if (hasExtensionContextInvalidated()) {
      throw createExtensionContextInvalidatedError();
    }
    const existingRecord = await loadSession(sessionId);
    if (!existingRecord) {
      throw new Error("기록을 찾지 못했습니다.");
    }

    return writeSessionRecord(
      applySessionContentPatch(existingRecord, patch, new Date().toISOString()),
    );
  });
}

export async function loadSession(id: string): Promise<SessionRecord | undefined> {
  if (!id) {
    return undefined;
  }

  const [indexedDbResult, fallbackRecord] = await Promise.all([
    tryIndexedDb(async () =>
      withSessionStoresTransaction("readonly", async ({ sessionStore, chunkStore }) => {
        const record = (await withRequest(sessionStore.get(id))) as IndexedDbSessionRecord | undefined;
        if (!record) {
          return undefined;
        }

        return hydrateIndexedDbSessionRecord(record, chunkStore);
      }),
    ),
    loadFallbackRecord(id),
  ]);

  const merged = mergeSessionCollections(
    indexedDbResult.ok && indexedDbResult.value
      ? [cloneSessionRecord(indexedDbResult.value)]
      : [],
    fallbackRecord
      ? [normalizeSessionRecord(fallbackRecord as StoredSessionRecord, { preserveTimestamps: true })]
      : [],
  );

  return merged[0] ? cloneSessionRecord(merged[0]) : undefined;
}

export async function loadSessionsByIds(ids: string[]): Promise<SessionRecord[]> {
  const uniqueIds = [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))];
  const sessions = await Promise.all(uniqueIds.map((id) => loadSession(id)));
  return sessions.filter((session): session is SessionRecord => Boolean(session));
}

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
    tryIndexedDb(async () => listAllIndexedDbSessions()),
    listFallbackRecords({ limit: Number.MAX_SAFE_INTEGER }),
  ]);
  const allSessions = sortSessions(
    mergeSessionCollections(
      indexedDbResult.ok && indexedDbResult.value
        ? indexedDbResult.value.map((record) =>
            normalizeSessionRecord(record as StoredSessionRecord, { preserveTimestamps: true }),
          )
        : [],
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

export async function replayQueuedExitPersistRecords(): Promise<PersistReplaySummary> {
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
    tryIndexedDb(async () => listAllIndexedDbSessions()),
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
