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

import { loadSession } from "./queries";
import { listSessionLineageSegments } from "./queries";

export async function saveSession(session: SessionRecord): Promise<SessionRecord> {
  if (hasExtensionContextInvalidated()) {
    throw createExtensionContextInvalidatedError();
  }

  const sessionId = typeof session.id === "string" ? session.id : "";
  return enqueueSessionWrite(sessionId, async () => {
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
    // preserve + write 를 동일 큐에서 처리 (running autosave vs History 메타 경쟁 방지)
    return writeSessionRecord(record, { enqueue: false });
  });
}

export async function updateRunningSession(session: SessionRecord): Promise<SessionRecord> {
  if (hasExtensionContextInvalidated()) {
    throw createExtensionContextInvalidatedError();
  }

  const sessionId = typeof session.id === "string" ? session.id : "";
  return enqueueSessionWrite(sessionId, async () => {
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
    return writeSessionRecord(record, { enqueue: false });
  });
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
    return writeSessionRecord(record, { enqueue: false });
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
      // 세그먼트별 session id 큐로 직렬화 (lineage 큐와 id 가 달라 중첩 가능)
      const saved = await enqueueSessionWrite(segment.id, async () => {
        const latest = (await loadSession(segment.id)) ?? segment;
        return writeSessionRecord(applySessionMetadataPatch(latest, patch, updatedAt), {
          notifyRevision: false,
          enqueue: false,
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
      { enqueue: false },
    );
  });
}
