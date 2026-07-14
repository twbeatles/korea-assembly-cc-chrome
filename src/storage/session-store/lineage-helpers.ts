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
  buildSessionSortKey,
} from "./idb/records";

export function sortSessions(records: SessionRecord[], options: SessionListOptions = {}): SessionRecord[] {
  const limit = Math.max(1, options.limit ?? 100);
  return [...records]
    .sort((left, right) => buildSessionSortKey(right).localeCompare(buildSessionSortKey(left)))
    .slice(0, limit)
    .map(cloneSessionRecord);
}

export function compareLineageSummaries(left: SessionLineageSummary, right: SessionLineageSummary): number {
  const leftKey = buildSessionSortKey({
    id: left.lineageId,
    starred: left.starred,
    pinnedAt: left.pinnedAt,
    updatedAt: left.updatedAt,
  });
  const rightKey = buildSessionSortKey({
    id: right.lineageId,
    starred: right.starred,
    pinnedAt: right.pinnedAt,
    updatedAt: right.updatedAt,
  });
  return rightKey.localeCompare(leftKey);
}

export function cloneLineageSummary(summary: SessionLineageSummary): SessionLineageSummary {
  return {
    ...summary,
    sessionIds: [...summary.sessionIds],
    representativeSession: cloneSessionRecord(summary.representativeSession),
  };
}

export function buildSessionLineageSummaries(sessions: SessionRecord[]): SessionLineageSummary[] {
  const groups = new Map<string, SessionRecord[]>();
  sessions.forEach((session) => {
    const lineageId = resolveSessionLineageId(session.id, session.lineageId);
    const group = groups.get(lineageId) ?? [];
    group.push(session);
    groups.set(lineageId, group);
  });

  return [...groups.entries()]
    .map(([lineageId, groupSessions]) => {
      const sorted = sortSessionSegments(groupSessions);
      const first = sorted[0]!;
      const last = sorted[sorted.length - 1]!;
      const representative = cloneSessionRecord(last);
      const commonNote = sorted.every((session) => session.note === first.note)
        ? first.note
        : "";
      const latestPinnedAt = sorted
        .map((session) => session.pinnedAt)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) ?? null;

      return {
        lineageId,
        representativeSessionId: representative.id,
        title: representative.title || first.title,
        committeeName: representative.committeeName || first.committeeName,
        sourceUrl: representative.sourceUrl || first.sourceUrl,
        startedAt: first.startedAt,
        endedAt: last.endedAt ?? last.updatedAt,
        updatedAt: sorted
          .map((session) => session.updatedAt)
          .sort()
          .at(-1) ?? last.updatedAt,
        segmentCount: sorted.length,
        subtitleCount: sorted.reduce((sum, session) => sum + session.subtitleCount, 0),
        charCount: sorted.reduce((sum, session) => sum + session.charCount, 0),
        status: last.status,
        starred: sorted.some((session) => session.starred),
        pinnedAt: latestPinnedAt,
        note: commonNote,
        sessionIds: sorted.map((session) => session.id),
        representativeSession: representative,
      } satisfies SessionLineageSummary;
    })
    .sort(compareLineageSummaries)
    .map(cloneLineageSummary);
}

export function compareSessionFreshness(left: SourcedSessionRecord, right: SourcedSessionRecord): number {
  const updatedCompare = left.record.updatedAt.localeCompare(right.record.updatedAt);
  if (updatedCompare !== 0) {
    return updatedCompare;
  }

  if (left.source === right.source) {
    return 0;
  }

  return left.source === "indexeddb" ? 1 : -1;
}

export function mergeSessionCollections(
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

export function toSessionLibraryPreview(record: SessionRecord): SessionLibraryPreview {
  return {
    id: record.id,
    title: record.title,
    committeeName: record.committeeName,
    updatedAt: record.updatedAt,
  };
}
