import { exportJson } from "../../core/exporters/json";
import { exportSrt } from "../../core/exporters/srt";
import { exportTxt } from "../../core/exporters/txt";
import { exportVtt } from "../../core/exporters/vtt";
import {
  cloneEntry,
  cloneSessionRecord,
  getSessionCharCount,
  withSessionEntries,
  type ExportFormat,
  type SessionRecord,
  type StoredSessionRecord,
  type SubtitleEntry,
} from "../../core/subtitle-models";
import { buildExportFilename } from "../../core/timeline";
import { SESSION_RECORD_VERSION } from "../../shared/constants";
import type { ExportPayload, SessionLibraryPreview, SessionListOptions } from "../types";
import type { IndexedDbSessionRecord } from "./internal-types";

export function buildSessionSortKey(
  record: Pick<SessionRecord, "id" | "starred" | "pinnedAt" | "updatedAt">,
): string {
  const starredFlag = record.starred ? "1" : "0";
  const primaryTimestamp =
    record.starred && record.pinnedAt ? record.pinnedAt : record.updatedAt;
  return `${starredFlag}|${primaryTimestamp}|${record.updatedAt}|${record.id}`;
}

export function toIndexedDbRecord(record: SessionRecord): IndexedDbSessionRecord {
  return {
    ...cloneSessionRecord(record),
    starredIndexKey: record.starred ? 1 : 0,
    sortKey: buildSessionSortKey(record),
  };
}

export function normalizeEntries(entries: SubtitleEntry[]): SubtitleEntry[] {
  return entries.map((entry) => cloneEntry(entry));
}

export function normalizeSessionRecord(
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
  const endedAt = status === "running" ? null : session.endedAt ?? updatedAt;

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

export function mergeEditableSessionMetadata(
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

export function sortSessions(
  records: SessionRecord[],
  options: SessionListOptions = {},
): SessionRecord[] {
  const limit = Math.max(1, options.limit ?? 100);
  return [...records]
    .sort((left, right) => buildSessionSortKey(right).localeCompare(buildSessionSortKey(left)))
    .slice(0, limit)
    .map(cloneSessionRecord);
}

export function paginateItems<T>(
  items: T[],
  page: number,
  pageSizeInput: number,
): {
  items: T[];
  totalCount: number;
  page: number;
  pageSize: number;
} {
  const pageSize = Math.max(1, pageSizeInput);
  const totalCount = items.length;
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const start = (safePage - 1) * pageSize;

  return {
    items: items.slice(start, start + pageSize),
    totalCount,
    page: safePage,
    pageSize,
  };
}

export function toExportPayload(
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

export function stopRunningRecord(record: SessionRecord): SessionRecord {
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

export function toSessionLibraryPreview(record: SessionRecord): SessionLibraryPreview {
  return {
    id: record.id,
    title: record.title,
    committeeName: record.committeeName,
    updatedAt: record.updatedAt,
  };
}
