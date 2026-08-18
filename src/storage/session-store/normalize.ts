/**
 * 세션 레코드 정규화 · 패치 (순수 함수)
 * 저장 경로 structural sanitize / 메타·본문 패치
 */
import { sanitizeEntriesForStorage } from "../../core/output-normalizer";
import {
  cloneSessionRecord,
  getSessionCharCount,
  resolveSessionLineageId,
  resolveSessionSegmentNumber,
  type SessionRecord,
  type SpeakerChannel,
  type SpeakerLabels,
  type StoredSessionRecord,
  type SubtitleEntry,
} from "../../core/subtitle-models";
import { SESSION_RECORD_VERSION, isSupportedAssemblyUrl } from "../../shared/constants";
import type { SessionContentPatch, SessionMetadataPatch } from "../types";

export const SESSION_NOTE_MAX_LENGTH = 4096;

export function clampSessionNote(note: string): string {
  if (typeof note !== "string") {
    return "";
  }
  if (note.length <= SESSION_NOTE_MAX_LENGTH) {
    return note;
  }
  return note.slice(0, SESSION_NOTE_MAX_LENGTH);
}

export function sanitizeStringList(
  value: unknown,
  maxItems = 50,
  maxLength = 80,
): string[] {
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

export function sanitizeSpeakerLabels(value: unknown): SpeakerLabels {
  if (!value || typeof value !== "object") {
    return {};
  }

  const labels: SpeakerLabels = {};
  (["primary", "secondary", "unknown"] satisfies SpeakerChannel[]).forEach((channel) => {
    const label = (value as Partial<Record<SpeakerChannel, unknown>>)[channel];
    if (typeof label === "string" && label.trim()) {
      labels[channel] = label.trim().slice(0, 80);
    }
  });
  return labels;
}

function isValidIsoDateString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

/** qualityStats 구조 검증. 비정상이면 undefined. */
export function sanitizeQualityStats(
  value: unknown,
): SessionRecord["qualityStats"] | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const stats = value as Partial<NonNullable<SessionRecord["qualityStats"]>>;
  const health = stats.health;
  const lastComputedAt = stats.lastComputedAt;
  if (health !== "good" && health !== "warning" && health !== "unstable") {
    return undefined;
  }
  if (!isValidIsoDateString(lastComputedAt)) {
    return undefined;
  }

  const entryCount = Number(stats.entryCount);
  const charCount = Number(stats.charCount);
  const estimatedBytes = Number(stats.estimatedBytes);
  if (
    !Number.isFinite(entryCount) ||
    !Number.isFinite(charCount) ||
    !Number.isFinite(estimatedBytes)
  ) {
    return undefined;
  }

  return {
    health,
    entryCount: Math.max(0, Math.floor(entryCount)),
    charCount: Math.max(0, Math.floor(charCount)),
    estimatedBytes: Math.max(0, Math.floor(estimatedBytes)),
    fallbackOnly: typeof stats.fallbackOnly === "boolean" ? stats.fallbackOnly : undefined,
    lastComputedAt,
  };
}

/** 세션 id 최대 길이. persist/저장 키 비대화 방지. */
export const SESSION_ID_MAX_LENGTH = 128;

/** 세션 id 정규화. 비어 있으면 빈 문자열. */
export function sanitizeSessionId(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().slice(0, SESSION_ID_MAX_LENGTH);
}

export function normalizeEntries(entries: SubtitleEntry[]): SubtitleEntry[] {
  // 저장 경로는 carry-over dedupe를 적용하지 않는다. export/copy 직전 정규화만 사용.
  return sanitizeEntriesForStorage(entries);
}

export function normalizeSessionRecord(
  session: StoredSessionRecord,
  options: {
    preserveTimestamps?: boolean;
    forceStatus?: SessionRecord["status"];
  } = {},
): SessionRecord {
  const now = new Date().toISOString();
  const sessionId = sanitizeSessionId(session.id);
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
  const note = typeof session.note === "string" ? clampSessionNote(session.note) : "";
  const tags = sanitizeStringList(session.tags);
  const category =
    typeof session.category === "string" ? session.category.trim().slice(0, 120) : "";
  const speakerLabels = sanitizeSpeakerLabels(session.speakerLabels);
  const qualityStats = sanitizeQualityStats(session.qualityStats);
  const lineageId = resolveSessionLineageId(sessionId, session.lineageId);
  const segmentNumber = resolveSessionSegmentNumber(session.segmentNumber);
  const endedAt = status === "running" ? null : (session.endedAt ?? updatedAt);

  return {
    id: sessionId,
    version: SESSION_RECORD_VERSION,
    title: session.title || "국회 자막 세션",
    committeeName: session.committeeName || "",
    sourceUrl:
      typeof session.sourceUrl === "string" && isSupportedAssemblyUrl(session.sourceUrl)
        ? session.sourceUrl
        : "",
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
    tags,
    category,
    speakerLabels,
    qualityStats,
    lineageId,
    segmentNumber,
    entries,
  };
}

export function normalizeImportedSessionStatus(
  status: StoredSessionRecord["status"] | undefined,
): SessionRecord["status"] {
  if (status === "running") {
    return "saved";
  }

  return status ?? "saved";
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
    tags: existingRecord.tags ? [...existingRecord.tags] : [],
    category: existingRecord.category ?? "",
    speakerLabels: existingRecord.speakerLabels
      ? { ...existingRecord.speakerLabels }
      : {},
    qualityStats: existingRecord.qualityStats
      ? { ...existingRecord.qualityStats }
      : undefined,
  };
}

export function applySessionMetadataPatch(
  record: SessionRecord,
  patch: SessionMetadataPatch,
  updatedAt: string,
): SessionRecord {
  const starred = patch.starred ?? record.starred;
  const pinnedAt = starred
    ? patch.pinnedAt !== undefined
      ? patch.pinnedAt
      : (record.pinnedAt ?? updatedAt)
    : null;
  const note =
    patch.note !== undefined ? clampSessionNote(patch.note) : clampSessionNote(record.note);
  const tags = patch.tags !== undefined ? sanitizeStringList(patch.tags) : (record.tags ?? []);
  const category =
    patch.category !== undefined
      ? patch.category.trim().slice(0, 120)
      : (record.category ?? "");
  const speakerLabels =
    patch.speakerLabels !== undefined
      ? sanitizeSpeakerLabels(patch.speakerLabels)
      : (record.speakerLabels ?? {});

  return normalizeSessionRecord(
    {
      ...record,
      starred,
      pinnedAt,
      note,
      tags,
      category,
      speakerLabels,
      updatedAt,
    },
    {
      preserveTimestamps: true,
      forceStatus: record.status,
    },
  );
}

export function applySessionContentPatch(
  record: SessionRecord,
  patch: SessionContentPatch,
  updatedAt: string,
): SessionRecord {
  const entries = patch.entries !== undefined ? normalizeEntries(patch.entries) : record.entries;
  return normalizeSessionRecord(
    {
      ...record,
      entries,
      tags: patch.tags !== undefined ? sanitizeStringList(patch.tags) : (record.tags ?? []),
      category:
        patch.category !== undefined
          ? patch.category.trim().slice(0, 120)
          : (record.category ?? ""),
      speakerLabels:
        patch.speakerLabels !== undefined
          ? sanitizeSpeakerLabels(patch.speakerLabels)
          : (record.speakerLabels ?? {}),
      subtitleCount: entries.length,
      charCount: getSessionCharCount(entries),
      updatedAt,
    },
    {
      preserveTimestamps: true,
      forceStatus: record.status,
    },
  );
}
