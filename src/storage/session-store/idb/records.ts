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
  withRequest,
  withTransaction,
  withSessionStoresTransaction,
} from "./database";
import {
  sortSessions,
} from "../lineage-helpers";

export function toIndexedDbRecord(record: SessionRecord): IndexedDbSessionRecord {
  const metadata = stripSessionEntries(record);
  return {
    ...metadata,
    starredIndexKey: record.starred ? 1 : 0,
    sortKey: buildSessionSortKey(record),
  };
}

export function readChunkRecordsBySessionId(
  chunkStore: IDBObjectStore,
  sessionId: string,
): Promise<SessionEntryChunkRecord[]> {
  return new Promise<SessionEntryChunkRecord[]>((resolve, reject) => {
    const index = chunkStore.index(SESSION_ENTRY_CHUNK_INDEX_NAME);
    const request = index.openCursor(
      IDBKeyRange.bound([sessionId, 0], [sessionId, Number.MAX_SAFE_INTEGER]),
      "next",
    );
    const chunks: SessionEntryChunkRecord[] = [];

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(chunks);
        return;
      }

      chunks.push(cursor.value as SessionEntryChunkRecord);
      cursor.continue();
    };
    request.onerror = () => reject(request.error ?? new Error("IndexedDB chunk read failed"));
  });
}

export function writeChunkedSessionRecord(
  chunkStore: IDBObjectStore,
  metadataRecord: IndexedDbSessionRecord,
  chunks: SessionEntryChunkRecord[],
  previousMetadataRecord?: Partial<IndexedDbSessionRecord>,
): Promise<void> {
  const previousChunkDigests = getChunkDigests(previousMetadataRecord ?? {});
  const previousChunkCount =
    typeof previousMetadataRecord?.entryChunkCount === "number" &&
    previousMetadataRecord.entryChunkCount >= 0
      ? previousMetadataRecord.entryChunkCount
      : 0;

  return Promise.all([
    ...chunks.flatMap((chunk, chunkIndex) =>
      previousChunkDigests[chunkIndex] === chunk.digest
        ? []
        : [withRequest(chunkStore.put(chunk))],
    ),
    ...Array.from(
      { length: Math.max(0, previousChunkCount - chunks.length) },
      (_value, index) =>
        withRequest(
          chunkStore.delete(
            buildSessionEntryChunkKey(metadataRecord.id, chunks.length + index),
          ),
        ),
    ),
  ]).then(() => undefined);
}

export async function hydrateIndexedDbSessionRecord(
  metadataRecord: IndexedDbSessionRecord,
  chunkStore: IDBObjectStore,
): Promise<SessionRecord> {
  if (!hasChunkedSessionEntries(metadataRecord)) {
    return normalizeSessionRecord(metadataRecord as StoredSessionRecord, {
      preserveTimestamps: true,
    });
  }

  const chunks = await readChunkRecordsBySessionId(chunkStore, metadataRecord.id);
  if (chunks.length !== metadataRecord.entryChunkCount) {
    throw new Error(`Session chunk count mismatch for ${metadataRecord.id}`);
  }

  return normalizeSessionRecord(
    hydrateChunkedSessionRecord(metadataRecord, chunks),
    {
      preserveTimestamps: true,
      forceStatus: metadataRecord.status,
    },
  );
}

export function normalizeIndexedDbSessionMetadataRecord(
  record: IndexedDbSessionRecord,
): SessionRecord {
  const normalized = normalizeSessionRecord(
    toEntrylessSessionRecord(record),
    {
      preserveTimestamps: true,
      forceStatus: record.status,
    },
  );
  return {
    ...normalized,
    subtitleCount:
      typeof record.subtitleCount === "number" && Number.isFinite(record.subtitleCount)
        ? Math.max(0, Math.floor(record.subtitleCount))
        : normalized.subtitleCount,
    charCount:
      typeof record.charCount === "number" && Number.isFinite(record.charCount)
        ? Math.max(0, Math.floor(record.charCount))
        : normalized.charCount,
    entries: [],
  };
}

export function buildSessionSortKey(
  record: Pick<SessionRecord, "id" | "starred" | "pinnedAt" | "updatedAt">,
): string {
  const starredFlag = record.starred ? "1" : "0";
  const primaryTimestamp =
    record.starred && record.pinnedAt ? record.pinnedAt : record.updatedAt;
  return `${starredFlag}|${primaryTimestamp}|${record.updatedAt}|${record.id}`;
}

export function readCursorRecords(
  source: IDBObjectStore | IDBIndex,
  options: {
    direction?: IDBCursorDirection;
    limit?: number;
    offset?: number;
    query?: IDBValidKey | IDBKeyRange | null;
  } = {},
): Promise<SessionRecord[]> {
  const direction = options.direction ?? "next";
  const limit = Math.max(1, options.limit ?? Number.MAX_SAFE_INTEGER);
  const offset = Math.max(0, options.offset ?? 0);
  const query = options.query ?? null;

  return new Promise<SessionRecord[]>((resolve, reject) => {
    const records: SessionRecord[] = [];
    const request = source.openCursor(query, direction);
    let skipped = false;

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || records.length >= limit) {
        resolve(records);
        return;
      }

      if (offset > 0 && !skipped) {
        skipped = true;
        cursor.advance(offset);
        return;
      }

      records.push(cursor.value as SessionRecord);
      if (records.length >= limit) {
        resolve(records);
        return;
      }
      cursor.continue();
    };
    request.onerror = () => reject(request.error ?? new Error("IndexedDB cursor request failed"));
  });
}

export async function listIndexedDbSessions(options: SessionListOptions = {}): Promise<SessionRecord[]> {
  return withTransaction("readonly", async (store) => {
    const limit = Math.max(1, options.limit ?? 100);
    if (store.indexNames.contains("paging")) {
      return (await readCursorRecords(store.index("paging"), {
        direction: "prev",
        limit,
      })).map((record) =>
        normalizeIndexedDbSessionMetadataRecord(record as IndexedDbSessionRecord),
      );
    }

    return (await readCursorRecords(store.index("updatedAt"), {
      direction: "prev",
      limit,
    })).map((record) =>
      normalizeIndexedDbSessionMetadataRecord(record as IndexedDbSessionRecord),
    );
  });
}

export async function listIndexedDbSessionPage(
  options: SessionPageOptions,
): Promise<SessionPageResult> {
  return withTransaction("readonly", async (store) => {
    const pageSize = Math.max(1, options.pageSize);
    if (!store.indexNames.contains("paging")) {
      const allSessions = sortSessions(
        ((await withRequest(store.getAll())) as IndexedDbSessionRecord[]).map((record) =>
          normalizeIndexedDbSessionMetadataRecord(record),
        ),
        { limit: Number.MAX_SAFE_INTEGER },
      );
      const filteredSessions = options.starredOnly
        ? allSessions.filter((session) => session.starred)
        : allSessions;
      const totalCount = filteredSessions.length;
      const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
      const page = Math.min(Math.max(1, options.page), pageCount);
      const start = (page - 1) * pageSize;

      return {
        sessions: filteredSessions.slice(start, start + pageSize).map(cloneSessionRecord),
        totalCount,
        page,
        pageSize,
      };
    }

    const pagingIndex = store.index("paging");
    const query = options.starredOnly
      ? IDBKeyRange.bound("1|", "1|\uffff")
      : null;
    const totalCount = await withRequest(pagingIndex.count(query ?? undefined));
    const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
    const page = Math.min(Math.max(1, options.page), pageCount);
    const start = (page - 1) * pageSize;
    const sessions =
      totalCount > 0
        ? await readCursorRecords(pagingIndex, {
            direction: "prev",
            query,
            offset: start,
            limit: pageSize,
          })
        : [];

    return {
      sessions: sessions.map((record) =>
        normalizeIndexedDbSessionMetadataRecord(record as IndexedDbSessionRecord),
      ),
      totalCount,
      page,
      pageSize,
    };
  });
}

export async function listIndexedDbLineageSessions(lineageId: string): Promise<SessionRecord[]> {
  return withSessionStoresTransaction("readonly", async ({ sessionStore, chunkStore }) => {
    const metadataRecords = sessionStore.indexNames.contains("lineageId")
      ? ((await readCursorRecords(sessionStore.index("lineageId"), {
          direction: "next",
          query: lineageId,
        })) as IndexedDbSessionRecord[])
      : ((await withRequest(sessionStore.getAll())) as IndexedDbSessionRecord[]).filter(
          (record) => resolveSessionLineageId(record.id, record.lineageId) === lineageId,
        );

    return Promise.all(
      metadataRecords.map((record) => hydrateIndexedDbSessionRecord(record, chunkStore)),
    );
  });
}

export async function listAllIndexedDbSessions(): Promise<SessionRecord[]> {
  return withSessionStoresTransaction("readonly", async ({ sessionStore, chunkStore }) => {
    const all = (await withRequest(sessionStore.getAll())) as IndexedDbSessionRecord[];
    return Promise.all(
      all.map((record) => hydrateIndexedDbSessionRecord(record, chunkStore)),
    );
  });
}

export async function listIndexedDbSessionMetadataRecords(): Promise<SessionRecord[]> {
  return withTransaction("readonly", async (store) => {
    const all = (await withRequest(store.getAll())) as IndexedDbSessionRecord[];
    return all.map((record) => normalizeIndexedDbSessionMetadataRecord(record));
  });
}

export async function listIndexedDbSessionsByStatus(
  status: SessionRecord["status"],
): Promise<SessionRecord[]> {
  return withSessionStoresTransaction("readonly", async ({ sessionStore, chunkStore }) => {
    const metadataRecords = sessionStore.indexNames.contains("status")
      ? ((await readCursorRecords(sessionStore.index("status"), {
          direction: "next",
          query: status,
        })) as IndexedDbSessionRecord[])
      : ((await withRequest(sessionStore.getAll())) as IndexedDbSessionRecord[]).filter(
          (record) => record.status === status,
        );

    return Promise.all(
      metadataRecords.map((record) => hydrateIndexedDbSessionRecord(record, chunkStore)),
    );
  });
}

export async function listIndexedDbSessionIds(): Promise<string[]> {
  return withTransaction("readonly", async (store) => {
    const storeWithGetAllKeys = store as IDBObjectStore & {
      getAllKeys?: () => IDBRequest<IDBValidKey[]>;
    };

    if (typeof storeWithGetAllKeys.getAllKeys === "function") {
      const keys = await withRequest(storeWithGetAllKeys.getAllKeys());
      return keys.filter((key): key is string => typeof key === "string");
    }

    const records = await withRequest(store.getAll() as IDBRequest<Array<{ id?: unknown }>>);
    return (records as Array<{ id?: unknown }>)
      .map((record) => record.id)
      .filter((id): id is string => typeof id === "string");
  });
}
