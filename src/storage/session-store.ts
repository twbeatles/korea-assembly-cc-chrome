import { exportJson } from "../core/exporters/json";
import { normalizeSessionForExport } from "../core/exporters/normalize-session";
import { exportSrt } from "../core/exporters/srt";
import { exportTxt } from "../core/exporters/txt";
import { exportVtt } from "../core/exporters/vtt";
import type { ExportFormat, SessionRecord } from "../core/subtitle-models";
import { getSessionCharCount } from "../core/subtitle-models";
import { buildExportFilename } from "../core/timeline";
import {
  SESSION_DB_NAME,
  SESSION_SCHEMA_VERSION,
  SESSION_STORE_NAME,
} from "../shared/constants";
import type { ExportPayload, SessionListOptions } from "./types";

const LEGACY_FALLBACK_STORAGE_KEY = "assembly-subtitle-session-fallback";
const FALLBACK_INDEX_STORAGE_KEY = "assembly-subtitle-session-fallback:index";
const FALLBACK_RECORD_PREFIX = "assembly-subtitle-session-fallback:record:";

let dbPromise: Promise<IDBDatabase> | null = null;
let indexedDbAvailable = true;
const memoryFallbackStore = new Map<string, SessionRecord>();

function logStoreError(message: string, error?: unknown): void {
  console.warn(`[session-store] ${message}`, error);
}

function cloneSessionRecord(record: SessionRecord): SessionRecord {
  return {
    ...record,
    entries: record.entries.map((entry) => ({
      ...entry,
      sourceFramePath: entry.sourceFramePath ? [...entry.sourceFramePath] : undefined,
    })),
  };
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
        request = indexedDB.open(SESSION_DB_NAME, 1);
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

function normalizeSessionRecord(session: SessionRecord): SessionRecord {
  const now = new Date().toISOString();
  const entries = session.entries.map((entry) => ({
    ...entry,
    sourceFramePath: entry.sourceFramePath ? [...entry.sourceFramePath] : undefined,
  }));

  return {
    ...session,
    version: session.version || SESSION_SCHEMA_VERSION,
    title: session.title || "국회 자막 세션",
    committeeName: session.committeeName || "",
    createdAt: session.createdAt || session.startedAt || now,
    startedAt: session.startedAt || session.createdAt || now,
    updatedAt: now,
    endedAt: session.status === "running" ? null : session.endedAt ?? now,
    subtitleCount: entries.length,
    charCount: getSessionCharCount(entries),
    entries,
  };
}

function sortSessions(records: SessionRecord[], options: SessionListOptions = {}): SessionRecord[] {
  const limit = Math.max(1, options.limit ?? 100);
  return [...records]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, limit)
    .map(cloneSessionRecord);
}

async function tryIndexedDb<T>(operation: () => Promise<T>): Promise<T | undefined> {
  if (!indexedDbAvailable || typeof indexedDB === "undefined") {
    return undefined;
  }

  try {
    return await operation();
  } catch (error) {
    logStoreError("IndexedDB operation failed, falling back", error);
    disableIndexedDb();
    return undefined;
  }
}

function hasChromeStorageFallback(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}

function sanitizeFallbackIndex(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.filter((item): item is string => typeof item === "string" && item))];
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
    const keys = Object.keys(all).filter(
      (key) =>
        key === LEGACY_FALLBACK_STORAGE_KEY ||
        key === FALLBACK_INDEX_STORAGE_KEY ||
        key.startsWith(FALLBACK_RECORD_PREFIX),
    );
    if (keys.length) {
      await chrome.storage.local.remove(keys);
    }
  } catch (error) {
    logStoreError("Failed to clear chrome.storage.local fallback", error);
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
): ExportPayload {
  const normalized = normalizeSessionForExport(normalizeSessionRecord(session));

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
  const entries = record.entries.map((entry) => ({
    ...entry,
    sourceFramePath: entry.sourceFramePath ? [...entry.sourceFramePath] : undefined,
  }));

  return {
    ...record,
    version: record.version || SESSION_SCHEMA_VERSION,
    status: "stopped",
    endedAt: record.endedAt ?? stoppedAt,
    updatedAt: stoppedAt,
    subtitleCount: entries.length,
    charCount: getSessionCharCount(entries),
    entries,
  };
}

export async function saveSession(session: SessionRecord): Promise<SessionRecord> {
  const record = normalizeSessionRecord({
    ...session,
    status: session.status === "running" ? "saved" : session.status,
  });

  const indexedDbResult = await tryIndexedDb(async () => {
    await withTransaction("readwrite", async (store) => {
      await withRequest(store.put(record));
      return record;
    });
    return record;
  });

  return indexedDbResult ? cloneSessionRecord(indexedDbResult) : saveFallbackRecord(record);
}

export async function updateRunningSession(session: SessionRecord): Promise<SessionRecord> {
  const record = normalizeSessionRecord({
    ...session,
    status: "running",
  });

  const indexedDbResult = await tryIndexedDb(async () => {
    await withTransaction("readwrite", async (store) => {
      await withRequest(store.put(record));
      return record;
    });
    return record;
  });

  return indexedDbResult ? cloneSessionRecord(indexedDbResult) : saveFallbackRecord(record);
}

export async function loadSession(id: string): Promise<SessionRecord | undefined> {
  if (!id) {
    return undefined;
  }

  const indexedDbResult = await tryIndexedDb(async () =>
    withTransaction("readonly", async (store) => {
      const record = await withRequest(store.get(id));
      return record as SessionRecord | undefined;
    }),
  );

  if (indexedDbResult) {
    return cloneSessionRecord(indexedDbResult);
  }

  return loadFallbackRecord(id);
}

export async function listSessions(options: SessionListOptions = {}): Promise<SessionRecord[]> {
  const indexedDbResult = await tryIndexedDb(async () =>
    withTransaction("readonly", async (store) => {
      const all = await withRequest(store.getAll());
      return all as SessionRecord[];
    }),
  );

  if (indexedDbResult) {
    return sortSessions(indexedDbResult, options);
  }

  return listFallbackRecords(options);
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

  if (indexedDbResult) {
    return;
  }

  await deleteFallbackRecord(id);
}

export async function exportSessionData(
  session: SessionRecord,
  format: ExportFormat,
  filenamePattern?: string,
): Promise<ExportPayload> {
  return toExportPayload(session, format, filenamePattern);
}

export async function closeRunningSessionsOnStartup(): Promise<number> {
  const indexedDbResult = await tryIndexedDb(async () => {
    return withTransaction("readwrite", async (store) => {
      const all = (await withRequest(store.getAll())) as SessionRecord[];
      const running = all.filter((record) => record.status === "running");
      await Promise.all(running.map((record) => withRequest(store.put(stopRunningRecord(record)))));
      return running.length;
    });
  });

  if (typeof indexedDbResult === "number") {
    return indexedDbResult;
  }

  const fallbackRecords = await listFallbackRecords({ limit: Number.MAX_SAFE_INTEGER });
  const running = fallbackRecords.filter((record) => record.status === "running");
  await Promise.all(running.map((record) => saveFallbackRecord(stopRunningRecord(record))));
  return running.length;
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
