import { exportJson } from "../core/exporters/json";
import { normalizeSessionForExport } from "../core/exporters/normalize-session";
import { exportSrt } from "../core/exporters/srt";
import { exportTxt } from "../core/exporters/txt";
import { exportVtt } from "../core/exporters/vtt";
import {
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
  SESSION_DB_SCHEMA_VERSION,
  SESSION_DB_NAME,
  SESSION_RECORD_VERSION,
  SESSION_STORE_NAME,
} from "../shared/constants";
import type { ExportPayload, SessionImportSummary, SessionListOptions } from "./types";

const LEGACY_FALLBACK_STORAGE_KEY = "assembly-subtitle-session-fallback";
const FALLBACK_INDEX_STORAGE_KEY = "assembly-subtitle-session-fallback:index";
const FALLBACK_RECORD_PREFIX = "assembly-subtitle-session-fallback:record:";

let dbPromise: Promise<IDBDatabase> | null = null;
let indexedDbAvailable = true;
const memoryFallbackStore = new Map<string, SessionRecord>();

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

function logStoreError(message: string, error?: unknown): void {
  console.warn(`[session-store] ${message}`, error);
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

    callback(store)
      .then((result) => {
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () =>
          reject(transaction.error ?? new Error("IndexedDB transaction failed"));
        transaction.onabort = () =>
          reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
      })
      .catch(reject);
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
        if (!db.objectStoreNames.contains(SESSION_STORE_NAME)) {
          const store = db.createObjectStore(SESSION_STORE_NAME, { keyPath: "id" });
          store.createIndex("updatedAt", "updatedAt");
          store.createIndex("status", "status");
        }
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
  return entries.map((entry) => ({
    ...entry,
    sourceFramePath: entry.sourceFramePath ? [...entry.sourceFramePath] : undefined,
  }));
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
    ...session,
    version: SESSION_RECORD_VERSION,
    title: session.title || "국회 자막 세션",
    committeeName: session.committeeName || "",
    createdAt,
    startedAt,
    updatedAt,
    endedAt,
    subtitleCount: entries.length,
    charCount: getSessionCharCount(entries),
    status,
    starred,
    pinnedAt,
    note,
    entries,
  };
}

function sortSessions(records: SessionRecord[], options: SessionListOptions = {}): SessionRecord[] {
  const limit = Math.max(1, options.limit ?? 100);
  return [...records]
    .sort((left, right) => {
      if (left.starred !== right.starred) {
        return left.starred ? -1 : 1;
      }

      const leftPinnedAt = left.starred ? left.pinnedAt || left.updatedAt : "";
      const rightPinnedAt = right.starred ? right.pinnedAt || right.updatedAt : "";
      const pinnedCompare = rightPinnedAt.localeCompare(leftPinnedAt);
      if (pinnedCompare !== 0) {
        return pinnedCompare;
      }

      return right.updatedAt.localeCompare(left.updatedAt);
    })
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

function setMemorySnapshot(snapshot: Record<string, SessionRecord>): void {
  memoryFallbackStore.clear();
  Object.entries(snapshot).forEach(([key, value]) => {
    memoryFallbackStore.set(key, cloneSessionRecord(value));
  });
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

async function saveChromeFallbackRecord(record: SessionRecord): Promise<void> {
  if (!hasChromeStorageFallback()) {
    return;
  }

  try {
    await migrateLegacyChromeFallbackIfNeeded();
    const index = (await readChromeFallbackIndex()) ?? [];
    const nextIndex = index.includes(record.id) ? index : [...index, record.id];
    await chrome.storage.local.set({
      [FALLBACK_INDEX_STORAGE_KEY]: nextIndex,
      [getFallbackRecordStorageKey(record.id)]: cloneSessionRecord(record),
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
    await migrateLegacyChromeFallbackIfNeeded();
    const index = (await readChromeFallbackIndex()) ?? [];
    const nextIndex = index.filter((item) => item !== id);
    await chrome.storage.local.set({
      [FALLBACK_INDEX_STORAGE_KEY]: nextIndex,
    });
    await chrome.storage.local.remove(getFallbackRecordStorageKey(id));
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
    const all = await chrome.storage.local.get(null);
    const keys = getFallbackStorageKeys(all);
    if (keys.length) {
      await chrome.storage.local.remove(keys);
    }
  } catch (error) {
    throw buildFallbackWriteError(action, error);
  }
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

  const index = await readChromeFallbackIndex();
  if (index) {
    const records = await readChromeFallbackRecords([id]);
    if (records && records[id]) {
      memoryFallbackStore.set(id, cloneSessionRecord(records[id]));
      return cloneSessionRecord(records[id]);
    }
  }

  const record = memoryFallbackStore.get(id);
  return record ? cloneSessionRecord(record) : undefined;
}

async function listFallbackRecords(options: SessionListOptions = {}): Promise<SessionRecord[]> {
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
): ExportPayload {
  const baseSession = entries ? withSessionEntries(session, entries) : session;
  const normalized = normalizeSessionForExport(
    normalizeSessionRecord(baseSession, {
      preserveTimestamps: true,
      forceStatus: baseSession.status,
    }),
  );

  switch (format) {
    case "txt":
      return {
        filename: buildExportFilename(normalized, format, filenamePattern),
        format,
        mimeType: "text/plain;charset=utf-8",
        content: exportTxt(normalized),
      };
    case "srt":
      return {
        filename: buildExportFilename(normalized, format, filenamePattern),
        format,
        mimeType: "application/x-subrip;charset=utf-8",
        content: exportSrt(normalized),
      };
    case "vtt":
      return {
        filename: buildExportFilename(normalized, format, filenamePattern),
        format,
        mimeType: "text/vtt;charset=utf-8",
        content: exportVtt(normalized),
      };
    case "json":
      return {
        filename: buildExportFilename(normalized, format, filenamePattern),
        format,
        mimeType: "application/json;charset=utf-8",
        content: exportJson(normalized),
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

async function writeSessionRecord(record: SessionRecord): Promise<SessionRecord> {
  const indexedDbResult = await tryIndexedDb(async () => {
    await withTransaction("readwrite", async (store) => {
      await withRequest(store.put(record));
      return record;
    });
    return record;
  });

  if (indexedDbResult.ok && indexedDbResult.value) {
    await bestEffortDeleteFallbackRecord(record.id);
    return cloneSessionRecord(indexedDbResult.value);
  }

  return saveFallbackRecord(record);
}

export async function saveSession(session: SessionRecord): Promise<SessionRecord> {
  const record = normalizeSessionRecord({
    ...session,
    status: session.status === "running" ? "saved" : session.status,
  }, {
    forceStatus: session.status === "running" ? "saved" : session.status,
  });
  return writeSessionRecord(record);
}

export async function updateRunningSession(session: SessionRecord): Promise<SessionRecord> {
  const record = normalizeSessionRecord({
    ...session,
    status: "running",
  }, {
    forceStatus: "running",
  });
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

export async function listSessions(options: SessionListOptions = {}): Promise<SessionRecord[]> {
  const [indexedDbResult, fallbackRecords] = await Promise.all([
    tryIndexedDb(async () =>
      withTransaction("readonly", async (store) => {
        const all = await withRequest(store.getAll());
        return all as SessionRecord[];
      }),
    ),
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
    return;
  }

  await deleteFallbackRecord(id);
}

export async function deleteAllSessions(): Promise<void> {
  const indexedDbResult = await tryIndexedDb(async () => {
    await withTransaction("readwrite", async (store) => {
      await withRequest(store.clear());
    });
    return true;
  });

  await clearFallbackRecords("전체 세션 삭제");

  if (!indexedDbResult.ok && indexedDbResult.error) {
    if (indexedDbResult.error instanceof Error) {
      throw new Error(`저장된 기록 전체 삭제 중 IndexedDB 정리에 실패했습니다: ${indexedDbResult.error.message}`);
    }
    throw new Error("저장된 기록 전체 삭제 중 IndexedDB 정리에 실패했습니다.");
  }
}

export async function importSessionRecords(
  sessions: StoredSessionRecord[],
): Promise<SessionImportSummary> {
  const existingSessions = await listSessions({ limit: Number.MAX_SAFE_INTEGER });
  const existingById = new Map(existingSessions.map((session) => [session.id, session]));
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

  let addedCount = 0;
  let updatedCount = 0;
  let keptCount = 0;

  for (const record of importedById.values()) {
    const existing = existingById.get(record.id);
    if (!existing) {
      await writeSessionRecord(record);
      addedCount += 1;
      continue;
    }

    if (record.updatedAt.localeCompare(existing.updatedAt) > 0) {
      await writeSessionRecord(record);
      updatedCount += 1;
      continue;
    }

    keptCount += 1;
  }

  return {
    addedCount,
    updatedCount,
    keptCount,
  };
}

export async function exportSessionData(
  session: SessionRecord,
  format: ExportFormat,
  filenamePattern?: string,
  entries?: SubtitleEntry[],
): Promise<ExportPayload> {
  return toExportPayload(session, format, filenamePattern, entries);
}

export async function closeRunningSessionsOnStartup(): Promise<number> {
  const [indexedDbRecords, fallbackRecords] = await Promise.all([
    tryIndexedDb(async () =>
      withTransaction("readonly", async (store) => {
        const all = await withRequest(store.getAll());
        return all as SessionRecord[];
      }),
    ),
    listFallbackRecords({ limit: Number.MAX_SAFE_INTEGER }),
  ]);

  const indexedDbRunning =
    indexedDbRecords.ok && indexedDbRecords.value
      ? indexedDbRecords.value.filter((record) => record.status === "running")
      : [];
  const fallbackRunning = fallbackRecords.filter((record) => record.status === "running");
  const uniqueRunningIds = new Set(
    [...indexedDbRunning, ...fallbackRunning].map((record) => record.id),
  );

  if (indexedDbRunning.length) {
    await tryIndexedDb(async () =>
      withTransaction("readwrite", async (store) => {
        await Promise.all(
          indexedDbRunning.map((record) => withRequest(store.put(stopRunningRecord(record)))),
        );
      }),
    );
  }

  await Promise.all(fallbackRunning.map((record) => saveFallbackRecord(stopRunningRecord(record))));
  return uniqueRunningIds.size;
}

export async function resetSessionStoreForTests(): Promise<void> {
  memoryFallbackStore.clear();
  await clearChromeFallbackRecordsForTests();
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
