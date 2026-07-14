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
  logStoreError,
} from "../utils";
import {
  buildSessionSortKey,
} from "./records";

export function withRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

export async function withTransaction<T>(
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

interface SessionStoreTransactionStores {
  sessionStore: IDBObjectStore;
  chunkStore: IDBObjectStore;
}

export async function withSessionStoresTransaction<T>(
  mode: IDBTransactionMode,
  callback: (stores: SessionStoreTransactionStores) => Promise<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(
      [SESSION_STORE_NAME, SESSION_ENTRY_CHUNK_STORE_NAME],
      mode,
    );
    const stores: SessionStoreTransactionStores = {
      sessionStore: transaction.objectStore(SESSION_STORE_NAME),
      chunkStore: transaction.objectStore(SESSION_ENTRY_CHUNK_STORE_NAME),
    };
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
      void callback(stores)
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

export function disableIndexedDb(): void {
  storeRuntime.indexedDbAvailable = false;
  storeRuntime.dbPromise = null;
}

export function openDb(): Promise<IDBDatabase> {
  if (!storeRuntime.indexedDbAvailable || typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is unavailable"));
  }

  if (!storeRuntime.dbPromise) {
    storeRuntime.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
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
        const chunkStore = db.objectStoreNames.contains(SESSION_ENTRY_CHUNK_STORE_NAME)
          ? request.transaction?.objectStore(SESSION_ENTRY_CHUNK_STORE_NAME)
          : db.createObjectStore(SESSION_ENTRY_CHUNK_STORE_NAME, { keyPath: "id" });
        if (!store) {
          return;
        }
        if (!chunkStore) {
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
        if (!store.indexNames.contains("lineageId")) {
          store.createIndex("lineageId", "lineageId");
        }
        if (!chunkStore.indexNames.contains(SESSION_ENTRY_CHUNK_INDEX_NAME)) {
          chunkStore.createIndex(SESSION_ENTRY_CHUNK_INDEX_NAME, ["sessionId", "chunkIndex"]);
        }

        const cursorRequest = store.openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) {
            return;
          }

          const value = cursor.value as Partial<IndexedDbSessionRecord>;
          const sessionId = typeof value.id === "string" ? value.id : "";
          const expectedStarredIndexKey = value.starred ? 1 : 0;
          const expectedLineageId = sessionId
            ? resolveSessionLineageId(sessionId, value.lineageId)
            : value.lineageId;
          const expectedSegmentNumber = resolveSessionSegmentNumber(value.segmentNumber);
          const expectedSortKey =
            sessionId && typeof value.updatedAt === "string"
              ? buildSessionSortKey({
                  id: sessionId,
                  starred: Boolean(value.starred),
                  pinnedAt: typeof value.pinnedAt === "string" ? value.pinnedAt : null,
                  updatedAt: value.updatedAt,
                })
              : "";
          if (
            value.starredIndexKey !== expectedStarredIndexKey ||
            value.sortKey !== expectedSortKey ||
            value.lineageId !== expectedLineageId ||
            value.segmentNumber !== expectedSegmentNumber
          ) {
            cursor.update({
              ...value,
              starredIndexKey: expectedStarredIndexKey,
              lineageId: expectedLineageId,
              segmentNumber: expectedSegmentNumber,
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

  return storeRuntime.dbPromise;
}

export async function tryIndexedDb<T>(operation: () => Promise<T>): Promise<IndexedDbAttempt<T>> {
  if (!storeRuntime.indexedDbAvailable || typeof indexedDB === "undefined") {
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
    if (markExtensionContextInvalidated(error)) {
      return {
        ok: false,
        error: createExtensionContextInvalidatedError(),
      };
    }
    if (!isExtensionContextInvalidatedError(error)) {
      logStoreError("IndexedDB operation failed, falling back", error);
    }
    return {
      ok: false,
      error,
    };
  }
}
