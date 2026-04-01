import { exportJson } from "../core/exporters/json";
import { exportSrt } from "../core/exporters/srt";
import { exportTxt } from "../core/exporters/txt";
import { exportVtt } from "../core/exporters/vtt";
import {
  cloneEntry,
  cloneSessionRecord,
  getSessionCharCount,
  withSessionEntries,
  type ExportFormat,
  type SessionRecord,
  type StoredSessionRecord,
  type SubtitleEntry,
} from "../core/subtitle-models";
import { buildExportFilename } from "../core/timeline";
import {
  clearQueuedExitPersistRecord,
  clearQueuedExitPersistRecordsUpTo,
  listQueuedExitPersistRecords,
  resetPersistRecoveryStateForTests,
} from "./persist-recovery";
import {
  buildSessionBackupBundle,
  buildSessionBackupFilename,
} from "./session-backup";
import {
  SESSION_DB_SCHEMA_VERSION,
  SESSION_DB_NAME,
  SESSION_RECORD_VERSION,
  SESSION_LIBRARY_REVISION_STORAGE_KEY,
  SESSION_STORE_NAME,
} from "../shared/constants";
import type {
  ExportPayload,
  LibraryBackupExport,
  PersistReplaySummary,
  SessionImportSummary,
  SessionLibraryOverview,
  SessionLibraryPreview,
  SessionListOptions,
  SessionPageOptions,
  SessionPageResult,
  StartupCleanupSummary,
} from "./types";

const LEGACY_FALLBACK_STORAGE_KEY = "assembly-subtitle-session-fallback";
const FALLBACK_INDEX_STORAGE_KEY = "assembly-subtitle-session-fallback:index";
const FALLBACK_RECORD_PREFIX = "assembly-subtitle-session-fallback:record:";

let dbPromise: Promise<IDBDatabase> | null = null;
let indexedDbAvailable = true;
const memoryFallbackStore = new Map<string, SessionRecord>();
let fallbackMutationQueue = Promise.resolve();

interface IndexedDbAttempt<T> {
  ok: boolean;
  value?: T;
  error?: unknown;
}

type SessionRecordSource = "indexeddb" | "fallback";

interface SourcedSessionRecord {
  source: SessionRecordSource;
  record: SessionRecord;
}

interface IndexedDbSessionRecord extends SessionRecord {
  starredIndexKey: 0 | 1;
  sortKey: string;
}

function logStoreError(message: string, error?: unknown): void {
  console.warn(`[session-store] ${message}`, error);
}

function toIndexedDbRecord(record: SessionRecord): IndexedDbSessionRecord {
  return {
    ...cloneSessionRecord(record),
    starredIndexKey: record.starred ? 1 : 0,
    sortKey: buildSessionSortKey(record),
  };
}

function buildSessionSortKey(
  record: Pick<SessionRecord, "id" | "starred" | "pinnedAt" | "updatedAt">,
): string {
  const starredFlag = record.starred ? "1" : "0";
  const primaryTimestamp =
    record.starred && record.pinnedAt ? record.pinnedAt : record.updatedAt;
  return `${starredFlag}|${primaryTimestamp}|${record.updatedAt}|${record.id}`;
}

function withRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

async function withTransaction<T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(SESSION_STORE_NAME, mode);
    const store = transaction.objectStore(SESSION_STORE_NAME);
    let settled = false;
    let transactionCompleted = false;
    let callbackCompleted = false;
    let callbackResult: T | undefined;
    let callbackError: unknown;

    const rejectOnce = (error: unknown): void => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error instanceof Error ? error : new Error("IndexedDB transaction failed"));
    };

    const resolveIfReady = (): void => {
      if (settled || !transactionCompleted || !callbackCompleted) {
        return;
      }
      settled = true;
      resolve(callbackResult as T);
    };

    transaction.oncomplete = () => {
      transactionCompleted = true;
      if (callbackError) {
        rejectOnce(callbackError);
        return;
      }
      resolveIfReady();
    };
    transaction.onerror = () =>
      rejectOnce(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () =>
      rejectOnce(transaction.error ?? callbackError ?? new Error("IndexedDB transaction aborted"));

    try {
      void callback(store)
        .then((result) => {
          callbackResult = result;
          callbackCompleted = true;
          resolveIfReady();
        })
        .catch((error) => {
          callbackError = error;
          try {
            transaction.abort();
          } catch {
            // Ignore abort errors if the transaction already completed.
          }
          rejectOnce(error);
        });
    } catch (error) {
      callbackError = error;
      try {
        transaction.abort();
      } catch {
        // Ignore abort errors if the transaction already completed.
      }
      rejectOnce(error);
    }
  });
}

function disableIndexedDb(): void {
  indexedDbAvailable = false;
  dbPromise = null;
}

function openDb(): Promise<IDBDatabase> {
  if (!indexedDbAvailable || typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is unavailable"));
  }

  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest;

      try {
        request = indexedDB.open(SESSION_DB_NAME, SESSION_DB_SCHEMA_VERSION);
      } catch (error) {
        reject(error instanceof Error ? error : new Error("Failed to open session database"));
        return;
      }

      request.onupgradeneeded = () => {
        const db = request.result;
        const store = db.objectStoreNames.contains(SESSION_STORE_NAME)
          ? request.transaction?.objectStore(SESSION_STORE_NAME)
          : db.createObjectStore(SESSION_STORE_NAME, { keyPath: "id" });
        if (!store) {
          return;
        }
        if (!store.indexNames.contains("updatedAt")) {
          store.createIndex("updatedAt", "updatedAt");
        }
        if (!store.indexNames.contains("status")) {
          store.createIndex("status", "status");
        }
        if (!store.indexNames.contains("starred")) {
          store.createIndex("starred", "starredIndexKey");
        }
        if (!store.indexNames.contains("paging")) {
          store.createIndex("paging", "sortKey");
        }

        const cursorRequest = store.openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) {
            return;
          }

          const value = cursor.value as Partial<IndexedDbSessionRecord>;
          const expectedStarredIndexKey = value.starred ? 1 : 0;
          const expectedSortKey =
            typeof value.id === "string" && typeof value.updatedAt === "string"
              ? buildSessionSortKey({
                  id: value.id,
                  starred: Boolean(value.starred),
                  pinnedAt: typeof value.pinnedAt === "string" ? value.pinnedAt : null,
                  updatedAt: value.updatedAt,
                })
              : "";
          if (
            value.starredIndexKey !== expectedStarredIndexKey ||
            value.sortKey !== expectedSortKey
          ) {
            cursor.update({
              ...value,
              starredIndexKey: expectedStarredIndexKey,
              sortKey: expectedSortKey,
            });
          }
          cursor.continue();
        };
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("Failed to open session database"));
      request.onblocked = () => reject(new Error("Session database open request was blocked"));
    }).catch((error) => {
      disableIndexedDb();
      throw error;
    });
  }

  return dbPromise;
}

function normalizeEntries(entries: SubtitleEntry[]): SubtitleEntry[] {
  return entries.map((entry) => cloneEntry(entry));
}

function normalizeSessionRecord(
  session: StoredSessionRecord,
  options: {
    preserveTimestamps?: boolean;
    forceStatus?: SessionRecord["status"];
  } = {},
): SessionRecord {
  const now = new Date().toISOString();
  const entries = normalizeEntries(session.entries);
  const status = options.forceStatus ?? session.status ?? "saved";
  const createdAt =
    typeof session.createdAt === "string" && session.createdAt
      ? session.createdAt
      : typeof session.startedAt === "string" && session.startedAt
        ? session.startedAt
        : now;
  const startedAt =
    typeof session.startedAt === "string" && session.startedAt
      ? session.startedAt
      : createdAt;
  const updatedAt =
    options.preserveTimestamps &&
    typeof session.updatedAt === "string" &&
    session.updatedAt
      ? session.updatedAt
      : now;
  const starred = typeof session.starred === "boolean" ? session.starred : false;
  const pinnedAt =
    starred && typeof session.pinnedAt === "string" && session.pinnedAt
      ? session.pinnedAt
      : starred
        ? updatedAt
        : null;
  const note = typeof session.note === "string" ? session.note : "";
  const endedAt =
    status === "running"
      ? null
      : session.endedAt ?? updatedAt;

  return {
    id: session.id,
    version: SESSION_RECORD_VERSION,
    title: session.title || "국회 자막 세션",
    committeeName: session.committeeName || "",
    sourceUrl: typeof session.sourceUrl === "string" ? session.sourceUrl : "",
    startedAt,
    endedAt,
    createdAt,
    updatedAt,
    subtitleCount: entries.length,
    charCount: getSessionCharCount(entries),
    status,
    starred,
    pinnedAt,
    note,
    entries,
  };
}

function mergeEditableSessionMetadata(
  record: SessionRecord,
  existingRecord?: SessionRecord,
): SessionRecord {
  if (!existingRecord) {
    return cloneSessionRecord(record);
  }

  return {
    ...cloneSessionRecord(record),
    starred: existingRecord.starred,
    pinnedAt: existingRecord.pinnedAt,
    note: existingRecord.note,
  };
}

async function bumpSessionLibraryRevision(): Promise<void> {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    return;
  }

  try {
    await chrome.storage.local.set({
      [SESSION_LIBRARY_REVISION_STORAGE_KEY]: `${Date.now()}:${Math.random().toString(16).slice(2)}`,
    });
  } catch (error) {
    logStoreError("Failed to bump session library revision", error);
  }
}

function sortSessions(records: SessionRecord[], options: SessionListOptions = {}): SessionRecord[] {
  const limit = Math.max(1, options.limit ?? 100);
  return [...records]
    .sort((left, right) => buildSessionSortKey(right).localeCompare(buildSessionSortKey(left)))
    .slice(0, limit)
    .map(cloneSessionRecord);
}

async function tryIndexedDb<T>(operation: () => Promise<T>): Promise<IndexedDbAttempt<T>> {
  if (!indexedDbAvailable || typeof indexedDB === "undefined") {
    return {
      ok: false,
    };
  }

  try {
    return {
      ok: true,
      value: await operation(),
    };
  } catch (error) {
    logStoreError("IndexedDB operation failed, falling back", error);
    return {
      ok: false,
      error,
    };
  }
}

function compareSessionFreshness(left: SourcedSessionRecord, right: SourcedSessionRecord): number {
  const updatedCompare = left.record.updatedAt.localeCompare(right.record.updatedAt);
  if (updatedCompare !== 0) {
    return updatedCompare;
  }

  if (left.source === right.source) {
    return 0;
  }

  return left.source === "indexeddb" ? 1 : -1;
}

function mergeSessionCollections(
  indexedDbRecords: SessionRecord[],
  fallbackRecords: SessionRecord[],
): SessionRecord[] {
  const merged = new Map<string, SourcedSessionRecord>();

  indexedDbRecords.forEach((record) => {
    merged.set(record.id, {
      source: "indexeddb",
      record: cloneSessionRecord(record),
    });
  });

  fallbackRecords.forEach((record) => {
    const next: SourcedSessionRecord = {
      source: "fallback",
      record: cloneSessionRecord(record),
    };
    const current = merged.get(record.id);
    if (!current || compareSessionFreshness(next, current) > 0) {
      merged.set(record.id, next);
    }
  });

  return Array.from(merged.values(), (value) => cloneSessionRecord(value.record));
}

async function bestEffortDeleteFallbackRecord(id: string): Promise<void> {
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
  const next = fallbackMutationQueue.then(action, action);
  fallbackMutationQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function setMemorySnapshot(snapshot: Record<string, SessionRecord>): void {
  memoryFallbackStore.clear();
  Object.entries(snapshot).forEach(([key, value]) => {
    memoryFallbackStore.set(key, cloneSessionRecord(value));
  });
}

function getMemorySnapshot(): Record<string, SessionRecord> {
  return Object.fromEntries(
    [...memoryFallbackStore.entries()].map(([key, value]) => [key, cloneSessionRecord(value)]),
  );
}

function compareFallbackFreshness(left: SessionRecord, right: SessionRecord): number {
  const updatedCompare = left.updatedAt.localeCompare(right.updatedAt);
  if (updatedCompare !== 0) {
    return updatedCompare;
  }

  return 0;
}

function mergeFallbackSnapshots(
  storageSnapshot: Record<string, SessionRecord>,
  memorySnapshot: Record<string, SessionRecord>,
): Record<string, SessionRecord> {
  const merged = new Map<string, SessionRecord>();

  Object.entries(storageSnapshot).forEach(([key, value]) => {
    merged.set(key, cloneSessionRecord(value));
  });

  Object.entries(memorySnapshot).forEach(([key, value]) => {
    const current = merged.get(key);
    if (!current || compareFallbackFreshness(value, current) >= 0) {
      merged.set(key, cloneSessionRecord(value));
    }
  });

  return Object.fromEntries(
    [...merged.entries()].map(([key, value]) => [key, cloneSessionRecord(value)]),
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

  const result = await chrome.storage.local.get([
    FALLBACK_INDEX_STORAGE_KEY,
    LEGACY_FALLBACK_STORAGE_KEY,
  ]);
  const existingIndex = sanitizeFallbackIndex(result[FALLBACK_INDEX_STORAGE_KEY]);
  if (existingIndex.length > 0) {
    return;
  }

  const legacySnapshot = result[LEGACY_FALLBACK_STORAGE_KEY];
  if (!legacySnapshot || typeof legacySnapshot !== "object") {
    return;
  }

  const snapshot = legacySnapshot as Record<string, SessionRecord>;
  const nextIndex = Object.keys(snapshot);
  if (!nextIndex.length) {
    await chrome.storage.local.remove(LEGACY_FALLBACK_STORAGE_KEY);
    return;
  }

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

async function readChromeFallbackRecords(ids: string[]): Promise<Record<string, SessionRecord> | undefined> {
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

async function clearChromeFallbackRecordsForTests(): Promise<void> {
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

async function clearFallbackRecords(action: string): Promise<void> {
  memoryFallbackStore.clear();
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

function readCursorRecords(
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

async function listIndexedDbSessions(options: SessionListOptions = {}): Promise<SessionRecord[]> {
  return withTransaction("readonly", async (store) => {
    const limit = Math.max(1, options.limit ?? 100);
    if (store.indexNames.contains("paging")) {
      return readCursorRecords(store.index("paging"), {
        direction: "prev",
        limit,
      });
    }

    return readCursorRecords(store.index("updatedAt"), {
      direction: "prev",
      limit,
    });
  });
}

async function listIndexedDbSessionPage(
  options: SessionPageOptions,
): Promise<SessionPageResult> {
  return withTransaction("readonly", async (store) => {
    const pageSize = Math.max(1, options.pageSize);
    if (!store.indexNames.contains("paging")) {
      const allSessions = sortSessions(
        (await withRequest(store.getAll())) as SessionRecord[],
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
      sessions: sessions.map(cloneSessionRecord),
      totalCount,
      page,
      pageSize,
    };
  });
}

async function listAllIndexedDbSessions(): Promise<SessionRecord[]> {
  return withTransaction("readonly", async (store) => {
    const all = await withRequest(store.getAll());
    return all as SessionRecord[];
  });
}

async function listIndexedDbSessionIds(): Promise<string[]> {
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

async function listFallbackSessionIds(): Promise<string[]> {
  const index = await readChromeFallbackIndex();
  return [...new Set([...(index ?? []), ...memoryFallbackStore.keys()])];
}

async function saveFallbackRecord(session: SessionRecord): Promise<SessionRecord> {
  const record = cloneSessionRecord(session);
  memoryFallbackStore.set(record.id, cloneSessionRecord(record));
  await saveChromeFallbackRecord(record);
  return cloneSessionRecord(record);
}

async function loadFallbackRecord(id: string): Promise<SessionRecord | undefined> {
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

  memoryFallbackStore.set(id, cloneSessionRecord(record));
  return cloneSessionRecord(record);
}

async function listFallbackRecords(options: SessionListOptions = {}): Promise<SessionRecord[]> {
  const records = await readUnifiedFallbackSnapshot();
  return sortSessions(Object.values(records), options);
}

async function deleteFallbackRecord(id: string): Promise<void> {
  if (!id) {
    return;
  }

  memoryFallbackStore.delete(id);
  await deleteChromeFallbackRecord(id);
}

function toExportPayload(
  session: SessionRecord,
  format: ExportFormat,
  filenamePattern?: string,
  entries?: SubtitleEntry[],
  stripTxtTimestamps = false,
): ExportPayload {
  const baseSession = entries ? withSessionEntries(session, entries) : session;
  const exportSession = normalizeSessionRecord(baseSession, {
    preserveTimestamps: true,
    forceStatus: baseSession.status,
  });

  switch (format) {
    case "txt":
      return {
        filename: buildExportFilename(exportSession, format, filenamePattern),
        format,
        mimeType: "text/plain;charset=utf-8",
        content: exportTxt(exportSession, {
          includeTimestamp: !stripTxtTimestamps,
        }),
      };
    case "srt":
      return {
        filename: buildExportFilename(exportSession, format, filenamePattern),
        format,
        mimeType: "application/x-subrip;charset=utf-8",
        content: exportSrt(exportSession),
      };
    case "vtt":
      return {
        filename: buildExportFilename(exportSession, format, filenamePattern),
        format,
        mimeType: "text/vtt;charset=utf-8",
        content: exportVtt(exportSession),
      };
    case "json":
      return {
        filename: buildExportFilename(exportSession, format, filenamePattern),
        format,
        mimeType: "application/json;charset=utf-8",
        content: exportJson(exportSession),
      };
  }
}

function stopRunningRecord(record: SessionRecord): SessionRecord {
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
  const indexedDbResult = await tryIndexedDb(async () => {
    await withTransaction("readwrite", async (store) => {
      await withRequest(store.put(toIndexedDbRecord(record)));
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
    tryIndexedDb(async () =>
      withTransaction("readonly", async (store) => {
        const record = await withRequest(store.get(id));
        return record as SessionRecord | undefined;
      }),
    ),
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

function toSessionLibraryPreview(record: SessionRecord): SessionLibraryPreview {
  return {
    id: record.id,
    title: record.title,
    committeeName: record.committeeName,
    updatedAt: record.updatedAt,
  };
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
  const pageSize = Math.max(1, options.pageSize);
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

export async function deleteSession(id: string): Promise<void> {
  if (!id) {
    return;
  }

  const indexedDbResult = await tryIndexedDb(async () => {
    await withTransaction("readwrite", async (store) => {
      await withRequest(store.delete(id));
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

export async function deleteAllSessions(): Promise<void> {
  const errors: string[] = [];
  let clearedAnyStore = false;
  const indexedDbResult = await tryIndexedDb(async () => {
    await withTransaction("readwrite", async (store) => {
      await withRequest(store.clear());
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
      withTransaction("readwrite", async (store) => {
        await Promise.all(
          indexedDbRunning.map((record) =>
            withRequest(store.put(toIndexedDbRecord(stopRunningRecord(record)))),
          ),
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
  await clearChromeFallbackRecordsForTests();
  await resetPersistRecoveryStateForTests();
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    await chrome.storage.local.remove(SESSION_LIBRARY_REVISION_STORAGE_KEY);
  }
  indexedDbAvailable = true;

  if (dbPromise) {
    try {
      const db = await dbPromise;
      db.close();
    } catch {
      // Ignore cached open failures while resetting test state.
    }
    dbPromise = null;
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
