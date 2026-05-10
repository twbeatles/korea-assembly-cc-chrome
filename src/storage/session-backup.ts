import {
  cloneEntry,
  cloneSessionRecord,
  type PersistedSessionStatus,
  type SessionBackupBundle,
  type SessionRecord,
  type SessionQualityStats,
  type SpeakerLabels,
  type SpeakerChannel,
  type StoredSessionRecord,
  type SubtitleEntry,
} from "../core/subtitle-models";
import { SESSION_RECORD_VERSION, isSupportedAssemblyUrl } from "../shared/constants";

export const SESSION_BACKUP_KIND = "assembly-subtitle-session-backup";
export const SESSION_BACKUP_VERSION = "1";
export const SESSION_LIBRARY_TRANSFER_LIMIT_BYTES = 25 * 1024 * 1024;
export const SESSION_LIBRARY_TRANSFER_LIMIT_LABEL = "25 MiB";
const SUPPORTED_SESSION_BACKUP_VERSIONS = new Set([SESSION_BACKUP_VERSION]);

export interface ParsedSessionImportPayload {
  records: StoredSessionRecord[];
  invalidCount: number;
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => Number.isInteger(item));
}

function isValidDateString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function sanitizeOptionalString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function sanitizeStringList(value: unknown, maxItems = 50, maxLength = 80): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => item.slice(0, maxLength)),
    ),
  ].slice(0, maxItems);
}

function sanitizeSpeakerLabels(value: unknown): SpeakerLabels | undefined {
  if (!isRecordLike(value)) {
    return undefined;
  }
  const labels: SpeakerLabels = {};
  (["primary", "secondary", "unknown"] satisfies SpeakerChannel[]).forEach((channel) => {
    const label = sanitizeOptionalString(value[channel]).trim();
    if (label) {
      labels[channel] = label.slice(0, 80);
    }
  });
  return Object.keys(labels).length ? labels : undefined;
}

function sanitizeQualityStats(value: unknown): SessionQualityStats | undefined {
  if (!isRecordLike(value)) {
    return undefined;
  }
  const health =
    value.health === "good" || value.health === "warning" || value.health === "unstable"
      ? value.health
      : undefined;
  if (!health || !isValidDateString(value.lastComputedAt)) {
    return undefined;
  }
  return {
    health,
    entryCount: typeof value.entryCount === "number" ? Math.max(0, value.entryCount) : 0,
    charCount: typeof value.charCount === "number" ? Math.max(0, value.charCount) : 0,
    estimatedBytes:
      typeof value.estimatedBytes === "number" ? Math.max(0, value.estimatedBytes) : 0,
    fallbackOnly: typeof value.fallbackOnly === "boolean" ? value.fallbackOnly : undefined,
    lastComputedAt: value.lastComputedAt,
  };
}

function sanitizeOptionalNullableDateString(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  return isValidDateString(value) ? value : undefined;
}

function sanitizePersistedStatus(value: unknown): PersistedSessionStatus | undefined {
  return value === "running" || value === "stopped" || value === "saved" ? value : undefined;
}

function sanitizeSubtitleEntry(value: unknown): SubtitleEntry | undefined {
  if (!isRecordLike(value)) {
    return undefined;
  }

  const id = sanitizeOptionalString(value.id);
  const text = sanitizeOptionalString(value.text);
  const timestamp = isValidDateString(value.timestamp) ? value.timestamp : undefined;
  const startTime = isValidDateString(value.startTime) ? value.startTime : undefined;
  const endTime = isValidDateString(value.endTime) ? value.endTime : undefined;
  if (!id || timestamp === undefined || startTime === undefined || endTime === undefined) {
    return undefined;
  }

  return {
    id,
    text,
    timestamp,
    startTime,
    endTime,
    sourceSelector:
      "sourceSelector" in value ? sanitizeOptionalString(value.sourceSelector, "") || undefined : undefined,
    sourceFramePath:
      "sourceFramePath" in value && value.sourceFramePath !== undefined
        ? isNumberArray(value.sourceFramePath)
          ? [...value.sourceFramePath]
          : undefined
        : undefined,
    sourceNodeKey:
      "sourceNodeKey" in value ? sanitizeOptionalString(value.sourceNodeKey, "") || undefined : undefined,
    speakerColor:
      "speakerColor" in value ? sanitizeOptionalString(value.speakerColor, "") || undefined : undefined,
    speakerChannel:
      value.speakerChannel === "primary" ||
      value.speakerChannel === "secondary" ||
      value.speakerChannel === "unknown"
        ? value.speakerChannel
        : undefined,
    speakerChanged:
      typeof value.speakerChanged === "boolean" ? value.speakerChanged : undefined,
    originalText:
      "originalText" in value ? sanitizeOptionalString(value.originalText, "") || undefined : undefined,
    highlighted: typeof value.highlighted === "boolean" ? value.highlighted : undefined,
    entryNote:
      "entryNote" in value ? sanitizeOptionalString(value.entryNote, "") || undefined : undefined,
    labels: sanitizeStringList(value.labels),
    speakerLabel:
      "speakerLabel" in value ? sanitizeOptionalString(value.speakerLabel, "") || undefined : undefined,
    sourceEntryIds: sanitizeStringList(value.sourceEntryIds, 200, 160),
  };
}

function sanitizeStoredSessionRecord(value: unknown): StoredSessionRecord | undefined {
  if (!isRecordLike(value) || typeof value.id !== "string" || !Array.isArray(value.entries)) {
    return undefined;
  }

  const entries = value.entries.map((entry) => sanitizeSubtitleEntry(entry));
  if (entries.some((entry) => entry === undefined)) {
    return undefined;
  }

  const startedAt = isValidDateString(value.startedAt) ? value.startedAt : undefined;
  const createdAt = isValidDateString(value.createdAt) ? value.createdAt : undefined;
  const updatedAt = isValidDateString(value.updatedAt) ? value.updatedAt : undefined;
  const endedAt = sanitizeOptionalNullableDateString(value.endedAt);
  if (startedAt === undefined || createdAt === undefined || updatedAt === undefined) {
    return undefined;
  }
  if ("endedAt" in value && endedAt === undefined) {
    return undefined;
  }

  const status = sanitizePersistedStatus(value.status);
  if ("status" in value && status === undefined) {
    return undefined;
  }

  if ("pinnedAt" in value && sanitizeOptionalNullableDateString(value.pinnedAt) === undefined) {
    return undefined;
  }

  const sourceUrlCandidate = sanitizeOptionalString(value.sourceUrl);
  const sourceUrl = isSupportedAssemblyUrl(sourceUrlCandidate) ? sourceUrlCandidate : "";

  return {
    id: value.id,
    version: typeof value.version === "string" && value.version ? value.version : SESSION_RECORD_VERSION,
    title: sanitizeOptionalString(value.title, "국회 자막 세션"),
    committeeName: sanitizeOptionalString(value.committeeName),
    sourceUrl,
    startedAt,
    endedAt: endedAt ?? null,
    createdAt,
    updatedAt,
    subtitleCount:
      typeof value.subtitleCount === "number" && Number.isFinite(value.subtitleCount)
        ? value.subtitleCount
        : entries.length,
    charCount:
      typeof value.charCount === "number" && Number.isFinite(value.charCount)
        ? value.charCount
        : entries.reduce((sum, entry) => sum + entry!.text.length, 0),
    status: status ?? "saved",
    starred: typeof value.starred === "boolean" ? value.starred : undefined,
    pinnedAt: sanitizeOptionalNullableDateString(value.pinnedAt) ?? undefined,
    note: typeof value.note === "string" ? value.note : undefined,
    tags: sanitizeStringList(value.tags),
    category: sanitizeOptionalString(value.category).trim().slice(0, 120),
    speakerLabels: sanitizeSpeakerLabels(value.speakerLabels),
    qualityStats: sanitizeQualityStats(value.qualityStats),
    entries: entries.map((entry) => cloneEntry(entry!)),
  };
}

function cloneImportedRecord(record: StoredSessionRecord): StoredSessionRecord {
  return {
    id: record.id,
    version: record.version,
    title: record.title,
    committeeName: record.committeeName,
    sourceUrl: record.sourceUrl,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    subtitleCount: record.subtitleCount,
    charCount: record.charCount,
    status: record.status,
    starred: record.starred,
    pinnedAt: record.pinnedAt,
    note: record.note,
    tags: record.tags ? [...record.tags] : undefined,
    category: record.category,
    speakerLabels: record.speakerLabels ? { ...record.speakerLabels } : undefined,
    qualityStats: record.qualityStats ? { ...record.qualityStats } : undefined,
    entries: record.entries.map((entry) => cloneEntry(entry)),
  };
}

function normalizeImportList(value: unknown): ParsedSessionImportPayload {
  if (!Array.isArray(value)) {
    throw new Error("가져온 JSON 형식이 올바르지 않습니다.");
  }

  const records = value
    .map((item) => sanitizeStoredSessionRecord(item))
    .filter((item): item is StoredSessionRecord => Boolean(item));
  return {
    records: records.map(cloneImportedRecord),
    invalidCount: value.length - records.length,
  };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function assertSessionLibraryTransferSizeWithinLimit(
  byteLength: number,
  actionLabel: "전체 JSON 백업" | "JSON 가져오기",
): void {
  if (!Number.isFinite(byteLength) || byteLength < 0) {
    return;
  }

  if (byteLength <= SESSION_LIBRARY_TRANSFER_LIMIT_BYTES) {
    return;
  }

  throw new Error(
    `${actionLabel} 작업은 ${SESSION_LIBRARY_TRANSFER_LIMIT_LABEL} 이하에서만 지원합니다.`,
  );
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
  const singleRecord = sanitizeStoredSessionRecord(value);
  if (singleRecord) {
    return {
      records: [cloneImportedRecord(singleRecord)],
      invalidCount: 0,
    };
  }

  if (
    isRecordLike(value) &&
    value.kind === SESSION_BACKUP_KIND &&
    typeof value.version === "string" &&
    SUPPORTED_SESSION_BACKUP_VERSIONS.has(value.version) &&
    isValidDateString(value.exportedAt)
  ) {
    return normalizeImportList(value.sessions);
  }

  throw new Error("가져온 JSON 형식이 올바르지 않습니다.");
}
