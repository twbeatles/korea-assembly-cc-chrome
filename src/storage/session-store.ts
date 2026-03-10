import { exportJson } from "../core/exporters/json";
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

const FALLBACK_STORAGE_KEY = "assembly-subtitle-session-fallback";

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

function getMemorySnapshot(): Record<string, SessionRecord> {
  return Object.fromEntries(
    [...memoryFallbackStore.entries()].map(([key, value]) => [key, cloneSessionRecord(value)]),
  );
}

function setMemorySnapshot(snapshot: Record<string, SessionRecord>): void {
  memoryFallbackStore.clear();
  Object.entries(snapshot).forEach(([key, value]) => {
    memoryFallbackStore.set(key, cloneSessionRecord(value));
  });
}

async function readChromeFallbackSnapshot(): Promise<Record<string, SessionRecord> | undefined> {
  if (!hasChromeStorageFallback()) {
    return undefined;
  }

  try {
    const result = await chrome.storage.local.get(FALLBACK_STORAGE_KEY);
    const snapshot = result[FALLBACK_STORAGE_KEY];
    if (!snapshot || typeof snapshot !== "object") {
      return {};
    }
    return snapshot as Record<string, SessionRecord>;
  } catch (error) {
    logStoreError("Failed to read chrome.storage.local fallback", error);
    return undefined;
  }
}

async function writeChromeFallbackSnapshot(
  snapshot: Record<string, SessionRecord>,
): Promise<boolean> {
  if (!hasChromeStorageFallback()) {
    return false;
  }

  try {
    await chrome.storage.local.set({
      [FALLBACK_STORAGE_KEY]: snapshot,
    });
    return true;
  } catch (error) {
    logStoreError("Failed to write chrome.storage.local fallback", error);
    return false;
  }
}

async function clearChromeFallbackSnapshot(): Promise<void> {
  if (!hasChromeStorageFallback()) {
    return;
  }

  try {
    await chrome.storage.local.remove(FALLBACK_STORAGE_KEY);
  } catch (error) {
    logStoreError("Failed to clear chrome.storage.local fallback", error);
  }
}

async function readFallbackSnapshot(): Promise<Record<string, SessionRecord>> {
  const chromeSnapshot = await readChromeFallbackSnapshot();
  if (chromeSnapshot) {
    setMemorySnapshot(chromeSnapshot);
    return getMemorySnapshot();
  }

  return getMemorySnapshot();
}

async function writeFallbackSnapshot(snapshot: Record<string, SessionRecord>): Promise<void> {
  setMemorySnapshot(snapshot);
  const wroteChrome = await writeChromeFallbackSnapshot(snapshot);
  if (!wroteChrome) {
    setMemorySnapshot(snapshot);
  }
}

async function withFallbackRecords<T>(
  callback: (records: Record<string, SessionRecord>) => Promise<T> | T,
): Promise<T> {
  const snapshot = await readFallbackSnapshot();
  return callback(snapshot);
}

async function saveFallbackRecord(session: SessionRecord): Promise<SessionRecord> {
  const record = cloneSessionRecord(session);
  await withFallbackRecords(async (records) => {
    records[record.id] = record;
    await writeFallbackSnapshot(records);
  });
  return cloneSessionRecord(record);
}

async function loadFallbackRecord(id: string): Promise<SessionRecord | undefined> {
  if (!id) {
    return undefined;
  }

  return withFallbackRecords((records) => {
    const record = records[id];
    return record ? cloneSessionRecord(record) : undefined;
  });
}

async function listFallbackRecords(options: SessionListOptions = {}): Promise<SessionRecord[]> {
  return withFallbackRecords((records) => sortSessions(Object.values(records), options));
}

async function deleteFallbackRecord(id: string): Promise<void> {
  if (!id) {
    return;
  }

  await withFallbackRecords(async (records) => {
    delete records[id];
    await writeFallbackSnapshot(records);
  });
}

function toExportPayload(
  session: SessionRecord,
  format: ExportFormat,
  filenamePattern?: string,
): ExportPayload {
  const normalized = normalizeSessionRecord(session);

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

export async function listSessions(
  options: SessionListOptions = {},
): Promise<SessionRecord[]> {
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

export async function resetSessionStoreForTests(): Promise<void> {
  memoryFallbackStore.clear();
  await clearChromeFallbackSnapshot();
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
