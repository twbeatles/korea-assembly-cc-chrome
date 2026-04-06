import { cloneSessionRecord, type SessionRecord } from "../../core/subtitle-models";
import {
  SESSION_DB_NAME,
  SESSION_DB_SCHEMA_VERSION,
  SESSION_REPLAY_QUEUE_STORE_NAME,
  SESSION_STORE_NAME,
} from "../../shared/constants";
import type {
  QueuedExitPersistRecord,
  SessionListOptions,
  SessionPageOptions,
  SessionPageResult,
} from "../types";
import type { IndexedDbAttempt, IndexedDbSessionRecord } from "./internal-types";
import { buildSessionSortKey, sortSessions, toIndexedDbRecord } from "./normalize";
import { logStoreError } from "./shared";
import { sessionStoreState } from "./state";

export function withRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

async function withStoreTransaction<T>(
  storeName: string,
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
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

export async function withTransaction<T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  return withStoreTransaction(SESSION_STORE_NAME, mode, callback);
}

export function disableIndexedDb(): void {
  sessionStoreState.indexedDbAvailable = false;
  sessionStoreState.dbPromise = null;
}

export function openDb(): Promise<IDBDatabase> {
  if (!sessionStoreState.indexedDbAvailable || typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is unavailable"));
  }

  if (!sessionStoreState.dbPromise) {
    sessionStoreState.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest;

      try {
        request = indexedDB.open(SESSION_DB_NAME, SESSION_DB_SCHEMA_VERSION);
      } catch (error) {
        reject(error instanceof Error ? error : new Error("Failed to open session database"));
        return;
      }

      request.onupgradeneeded = () => {
        const db = request.result;
        const sessionStore = db.objectStoreNames.contains(SESSION_STORE_NAME)
          ? request.transaction?.objectStore(SESSION_STORE_NAME)
          : db.createObjectStore(SESSION_STORE_NAME, { keyPath: "id" });
        if (!sessionStore) {
          return;
        }
        if (!sessionStore.indexNames.contains("updatedAt")) {
          sessionStore.createIndex("updatedAt", "updatedAt");
        }
        if (!sessionStore.indexNames.contains("status")) {
          sessionStore.createIndex("status", "status");
        }
        if (!sessionStore.indexNames.contains("starred")) {
          sessionStore.createIndex("starred", "starredIndexKey");
        }
        if (!sessionStore.indexNames.contains("paging")) {
          sessionStore.createIndex("paging", "sortKey");
        }

        if (!db.objectStoreNames.contains(SESSION_REPLAY_QUEUE_STORE_NAME)) {
          db.createObjectStore(SESSION_REPLAY_QUEUE_STORE_NAME, { keyPath: "sessionId" });
        }

        const cursorRequest = sessionStore.openCursor();
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

  return sessionStoreState.dbPromise;
}

export async function tryIndexedDb<T>(operation: () => Promise<T>): Promise<IndexedDbAttempt<T>> {
  if (!sessionStoreState.indexedDbAvailable || typeof indexedDB === "undefined") {
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

export async function listIndexedDbSessions(
  options: SessionListOptions = {},
): Promise<SessionRecord[]> {
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

export async function listIndexedDbSessionPage(
  options: SessionPageOptions,
): Promise<SessionPageResult> {
  return withTransaction("readonly", async (store) => {
    const pageSize = Math.max(1, options.pageSize);
    if (!store.indexNames.contains("paging")) {
      const allSessions = sortSessions((await withRequest(store.getAll())) as SessionRecord[], {
        limit: Number.MAX_SAFE_INTEGER,
      });
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
    const query = options.starredOnly ? IDBKeyRange.bound("1|", "1|\uffff") : null;
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

export async function listAllIndexedDbSessions(): Promise<SessionRecord[]> {
  return withTransaction("readonly", async (store) => {
    const all = await withRequest(store.getAll());
    return all as SessionRecord[];
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

export async function loadIndexedDbSession(id: string): Promise<SessionRecord | undefined> {
  return withTransaction("readonly", async (store) => {
    const record = await withRequest(store.get(id));
    return record as SessionRecord | undefined;
  });
}

export async function putIndexedDbRecord(record: SessionRecord): Promise<SessionRecord> {
  await withTransaction("readwrite", async (store) => {
    await withRequest(store.put(toIndexedDbRecord(record)));
    return record;
  });
  return cloneSessionRecord(record);
}

export async function putIndexedDbRecords(records: SessionRecord[]): Promise<void> {
  if (!records.length) {
    return;
  }

  await withTransaction("readwrite", async (store) => {
    await Promise.all(records.map((record) => withRequest(store.put(toIndexedDbRecord(record)))));
  });
}

export async function deleteIndexedDbSession(id: string): Promise<void> {
  await withTransaction("readwrite", async (store) => {
    await withRequest(store.delete(id));
  });
}

export async function clearIndexedDbSessions(): Promise<void> {
  await withTransaction("readwrite", async (store) => {
    await withRequest(store.clear());
  });
}

function cloneQueuedExitPersistRecord(
  record: QueuedExitPersistRecord,
): QueuedExitPersistRecord {
  return {
    sessionId: record.sessionId,
    queuedAt: record.queuedAt,
    record: cloneSessionRecord(record.record),
  };
}

export async function listIndexedDbQueuedExitPersistRecords(): Promise<QueuedExitPersistRecord[]> {
  return withStoreTransaction(SESSION_REPLAY_QUEUE_STORE_NAME, "readonly", async (store) => {
    const all = await withRequest(store.getAll() as IDBRequest<QueuedExitPersistRecord[]>);
    return (all as QueuedExitPersistRecord[]).map(cloneQueuedExitPersistRecord);
  });
}

export async function loadIndexedDbQueuedExitPersistRecord(
  sessionId: string,
): Promise<QueuedExitPersistRecord | undefined> {
  return withStoreTransaction(SESSION_REPLAY_QUEUE_STORE_NAME, "readonly", async (store) => {
    const record = await withRequest(
      store.get(sessionId) as IDBRequest<QueuedExitPersistRecord | undefined>,
    );
    return record ? cloneQueuedExitPersistRecord(record) : undefined;
  });
}

export async function putIndexedDbQueuedExitPersistRecord(
  record: QueuedExitPersistRecord,
): Promise<QueuedExitPersistRecord> {
  await withStoreTransaction(SESSION_REPLAY_QUEUE_STORE_NAME, "readwrite", async (store) => {
    await withRequest(store.put(cloneQueuedExitPersistRecord(record)));
    return record;
  });
  return cloneQueuedExitPersistRecord(record);
}

export async function deleteIndexedDbQueuedExitPersistRecord(sessionId: string): Promise<void> {
  await withStoreTransaction(SESSION_REPLAY_QUEUE_STORE_NAME, "readwrite", async (store) => {
    await withRequest(store.delete(sessionId));
  });
}

export async function clearIndexedDbQueuedExitPersistRecords(): Promise<void> {
  await withStoreTransaction(SESSION_REPLAY_QUEUE_STORE_NAME, "readwrite", async (store) => {
    await withRequest(store.clear());
  });
}

export async function resetIndexedDbForTests(): Promise<void> {
  sessionStoreState.indexedDbAvailable = true;

  if (sessionStoreState.dbPromise) {
    try {
      const db = await sessionStoreState.dbPromise;
      db.close();
    } catch {
      // Ignore cached open failures while resetting test state.
    }
    sessionStoreState.dbPromise = null;
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
