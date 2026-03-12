import {
  cloneEntry,
  cloneSessionRecord,
  type SessionBackupBundle,
  type SessionRecord,
  type StoredSessionRecord,
  type SubtitleEntry,
} from "../core/subtitle-models";

export const SESSION_BACKUP_KIND = "assembly-subtitle-session-backup";
export const SESSION_BACKUP_VERSION = "1";

export interface ParsedSessionImportPayload {
  records: StoredSessionRecord[];
  invalidCount: number;
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number");
}

function isSubtitleEntryLike(value: unknown): value is SubtitleEntry {
  if (!isRecordLike(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
      typeof value.text === "string" &&
      typeof value.timestamp === "string" &&
      typeof value.startTime === "string" &&
      typeof value.endTime === "string" &&
    (!("sourceFramePath" in value) ||
      value.sourceFramePath === undefined ||
      isNumberArray(value.sourceFramePath))
  );
}

function isStoredSessionRecordLike(value: unknown): value is StoredSessionRecord {
  if (!isRecordLike(value) || typeof value.id !== "string" || !Array.isArray(value.entries)) {
    return false;
  }

  return value.entries.every((entry) => isSubtitleEntryLike(entry));
}

function cloneImportedRecord(record: StoredSessionRecord): StoredSessionRecord {
  return {
    ...record,
    entries: record.entries.map((entry) => cloneEntry(entry)),
  };
}

function normalizeImportList(value: unknown): ParsedSessionImportPayload {
  if (!Array.isArray(value)) {
    throw new Error("가져온 JSON 형식이 올바르지 않습니다.");
  }

  const records = value.filter((item): item is StoredSessionRecord => isStoredSessionRecordLike(item));
  return {
    records: records.map(cloneImportedRecord),
    invalidCount: value.length - records.length,
  };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function buildSessionBackupBundle(
  sessions: SessionRecord[],
  exportedAt = new Date().toISOString(),
): SessionBackupBundle {
  return {
    kind: SESSION_BACKUP_KIND,
    version: SESSION_BACKUP_VERSION,
    exportedAt,
    sessions: sessions.map((session) => cloneSessionRecord(session)),
  };
}

export function buildSessionBackupFilename(exportedAt = new Date()): string {
  const year = exportedAt.getFullYear();
  const month = pad(exportedAt.getMonth() + 1);
  const date = pad(exportedAt.getDate());
  const hours = pad(exportedAt.getHours());
  const minutes = pad(exportedAt.getMinutes());
  const seconds = pad(exportedAt.getSeconds());
  return `assembly_subtitle_backup_${year}${month}${date}_${hours}${minutes}${seconds}.json`;
}

export function parseSessionImportPayload(value: unknown): ParsedSessionImportPayload {
  if (isStoredSessionRecordLike(value)) {
    return {
      records: [cloneImportedRecord(value)],
      invalidCount: 0,
    };
  }

  if (
    isRecordLike(value) &&
    value.kind === SESSION_BACKUP_KIND &&
    typeof value.version === "string" &&
    typeof value.exportedAt === "string"
  ) {
    return normalizeImportList(value.sessions);
  }

  throw new Error("가져온 JSON 형식이 올바르지 않습니다.");
}
