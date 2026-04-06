import {
  cloneSessionRecord,
  type ExportFormat,
  type SessionRecord,
  type StoredSessionRecord,
  type SubtitleEntry,
} from "../../core/subtitle-models";
import {
  clearAllQueuedExitPersistRecords,
  clearQueuedExitPersistRecord,
  clearQueuedExitPersistRecordsUpTo,
  listQueuedExitPersistRecords,
  recordStopPersistSuccess,
} from "../persist-recovery";
import {
  buildSessionBackupBundle,
  buildSessionBackupFilename,
} from "../session-backup";
import type {
  ExportPayload,
  LibraryBackupExport,
  PersistReplaySummary,
  SessionImportSummary,
  SessionLibraryOverview,
  SessionPageOptions,
  SessionPageResult,
  SessionSearchHit,
  SessionSearchPageOptions,
  SessionSearchPageResult,
  SessionListOptions,
  StartupCleanupSummary,
} from "../types";
import {
  clearIndexedDbSessions,
  deleteIndexedDbSession,
  listAllIndexedDbSessions,
  listIndexedDbSessionIds,
  listIndexedDbSessionPage,
  listIndexedDbSessions,
  loadIndexedDbSession,
  putIndexedDbRecord,
  putIndexedDbRecords,
  tryIndexedDb,
} from "./db";
import {
  bestEffortDeleteFallbackRecord,
  clearFallbackRecords,
  deleteFallbackRecord,
  listFallbackRecords,
  listFallbackSessionIds,
  loadFallbackRecord,
  saveFallbackRecord,
} from "./fallback";
import { mergeSessionCollections } from "./merge";
import {
  mergeEditableSessionMetadata,
  normalizeSessionRecord,
  paginateItems,
  sortSessions,
  stopRunningRecord,
  toExportPayload,
  toSessionLibraryPreview,
} from "./normalize";
import { buildSessionSearchHit, normalizeSearchQuery } from "./search";
import { bumpSessionLibraryRevision, logStoreError } from "./shared";
import { resetSessionStoreForTestsInternal } from "./test-reset";

async function preserveStoredSessionMetadata(record: SessionRecord): Promise<SessionRecord> {
  const existingRecord = await loadSession(record.id);
  return mergeEditableSessionMetadata(record, existingRecord);
}

async function writeSessionRecord(
  record: SessionRecord,
  options: {
    allowFallbackOnIndexedDbError?: boolean;
    notifyRevision?: boolean;
  } = {},
): Promise<SessionRecord> {
  const allowFallbackOnIndexedDbError = options.allowFallbackOnIndexedDbError !== false;
  const notifyRevision = options.notifyRevision !== false;
  const indexedDbResult = await tryIndexedDb(async () => putIndexedDbRecord(record));

  if (indexedDbResult.ok && indexedDbResult.value) {
    await bestEffortDeleteFallbackRecord(record.id);
    await clearQueuedExitPersistRecordsUpTo(record.id, record.updatedAt);
    if (notifyRevision) {
      await bumpSessionLibraryRevision();
    }
    return cloneSessionRecord(indexedDbResult.value);
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

async function listAllSessions(): Promise<SessionRecord[]> {
  const [indexedDbResult, fallbackRecords] = await Promise.all([
    tryIndexedDb(async () => listAllIndexedDbSessions()),
    listFallbackRecords({ limit: Number.MAX_SAFE_INTEGER }),
  ]);

  return sortSessions(
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
}

export async function saveSession(session: SessionRecord): Promise<SessionRecord> {
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
  const record = normalizeSessionRecord(session, {
    forceStatus: session.status,
  });
  return writeSessionRecord(record);
}

export async function loadSession(id: string): Promise<SessionRecord | undefined> {
  if (!id) {
    return undefined;
  }

  const [indexedDbResult, fallbackRecord] = await Promise.all([
    tryIndexedDb(async () => loadIndexedDbSession(id)),
    loadFallbackRecord(id),
  ]);

  const merged = mergeSessionCollections(
    indexedDbResult.ok && indexedDbResult.value
      ? [normalizeSessionRecord(indexedDbResult.value as StoredSessionRecord, { preserveTimestamps: true })]
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

export async function buildSessionLibraryBackupExport(): Promise<LibraryBackupExport> {
  const sessions = await listAllSessions();
  const now = new Date();
  const backup = buildSessionBackupBundle(sessions, now.toISOString());
  return {
    sessionCount: sessions.length,
    payload: {
      filename: buildSessionBackupFilename(now),
      format: "json",
      mimeType: "application/json;charset=utf-8",
      content: JSON.stringify(backup, null, 2),
    },
  };
}

export async function listSessions(options: SessionListOptions = {}): Promise<SessionRecord[]> {
  const [indexedDbResult, fallbackRecords] = await Promise.all([
    tryIndexedDb(async () => listIndexedDbSessions(options)),
    listFallbackRecords({ limit: Number.MAX_SAFE_INTEGER }),
  ]);

  return sortSessions(
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
    options,
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

  const allSessions = await listAllSessions();
  const filteredSessions = options.starredOnly
    ? allSessions.filter((session) => session.starred)
    : allSessions;
  const paged = paginateItems(filteredSessions, options.page, options.pageSize);

  return {
    sessions: paged.items.map(cloneSessionRecord),
    totalCount: paged.totalCount,
    page: paged.page,
    pageSize: paged.pageSize,
  };
}

export async function searchSessionsPage(
  options: SessionSearchPageOptions,
): Promise<SessionSearchPageResult> {
  const normalizedQuery = normalizeSearchQuery(options.query);
  const emptyPage = paginateItems<SessionSearchHit>([], options.page, options.pageSize);
  if (!normalizedQuery) {
    return {
      results: emptyPage.items,
      totalCount: emptyPage.totalCount,
      page: emptyPage.page,
      pageSize: emptyPage.pageSize,
    };
  }

  const allSessions = await listAllSessions();
  const filteredSessions = options.starredOnly
    ? allSessions.filter((session) => session.starred)
    : allSessions;
  const matchedResults = filteredSessions
    .map((session) => buildSessionSearchHit(session, normalizedQuery))
    .filter((result): result is SessionSearchHit => Boolean(result));
  const paged = paginateItems(matchedResults, options.page, options.pageSize);

  return {
    results: paged.items.map((result) => ({
      ...result,
      matchedEntryIds: [...result.matchedEntryIds],
    })),
    totalCount: paged.totalCount,
    page: paged.page,
    pageSize: paged.pageSize,
  };
}

export async function deleteSession(id: string): Promise<void> {
  if (!id) {
    return;
  }

  const indexedDbResult = await tryIndexedDb(async () => {
    await deleteIndexedDbSession(id);
    return true;
  });

  if (indexedDbResult.ok && indexedDbResult.value) {
    await bestEffortDeleteFallbackRecord(id);
    await clearQueuedExitPersistRecord(id);
    await bumpSessionLibraryRevision();
    return;
  }

  await deleteFallbackRecord(id);
  await clearQueuedExitPersistRecord(id);
  await bumpSessionLibraryRevision();
}

export async function deleteAllSessions(): Promise<void> {
  const errors: string[] = [];
  let clearedAnyStore = false;
  const indexedDbResult = await tryIndexedDb(async () => {
    await clearIndexedDbSessions();
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

  await clearAllQueuedExitPersistRecords();

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
): Promise<SessionImportSummary> {
  const importedById = new Map<string, SessionRecord>();

  sessions.forEach((session) => {
    const normalized = normalizeSessionRecord(session, {
      preserveTimestamps: true,
      forceStatus: session.status ?? "saved",
    });
    const current = importedById.get(normalized.id);
    if (!current || normalized.updatedAt.localeCompare(current.updatedAt) > 0) {
      importedById.set(normalized.id, normalized);
    }
  });

  const existingSessions = await loadSessionsByIds([...importedById.keys()]);
  const existingById = new Map(existingSessions.map((session) => [session.id, session]));

  let addedCount = 0;
  let updatedCount = 0;
  let keptCount = 0;
  let failedCount = 0;

  for (const record of importedById.values()) {
    try {
      const existing = existingById.get(record.id);
      if (!existing) {
        await writeSessionRecord(record, {
          notifyRevision: false,
        });
        addedCount += 1;
        continue;
      }

      if (record.updatedAt.localeCompare(existing.updatedAt) > 0) {
        await writeSessionRecord(record, {
          notifyRevision: false,
        });
        updatedCount += 1;
        continue;
      }

      keptCount += 1;
    } catch (error) {
      failedCount += 1;
      logStoreError(`Failed to import session ${record.id}`, error);
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
  filenamePattern?: string,
  entries?: SubtitleEntry[],
  stripTxtTimestamps = false,
): Promise<ExportPayload> {
  return toExportPayload(session, format, filenamePattern, entries, stripTxtTimestamps);
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
      await recordStopPersistSuccess("replay", queuedRecord.record.updatedAt);
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
    const indexedDbWriteResult = await tryIndexedDb(async () => {
      await putIndexedDbRecords(indexedDbRunning.map((record) => stopRunningRecord(record)));
      return true;
    });
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
  await resetSessionStoreForTestsInternal();
}
