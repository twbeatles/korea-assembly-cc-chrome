import { cloneSessionRecord, type SessionRecord } from "../../core/subtitle-models";
import type { PersistReplayDiagnostics, QueuedExitPersistRecord } from "../types";
import { EXIT_PERSIST_INDEX_STORAGE_KEY, EXIT_PERSIST_RECORD_PREFIX } from "./keys";

/** 순수 정규화·비교·병합 헬퍼 (단일 책임: 입력 검증과 병합 의미론). */
export function sanitizeExitPersistIndex(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [
    ...new Set(
      value.filter((item): item is string => typeof item === "string" && item.trim().length > 0),
    ),
  ];
}

export function collectExitPersistSessionIdsFromSnapshot(snapshot: Record<string, unknown>): string[] {
  return [
    ...new Set(
      Object.keys(snapshot)
        .filter(
          (key) =>
            key.startsWith(EXIT_PERSIST_RECORD_PREFIX) && key !== EXIT_PERSIST_INDEX_STORAGE_KEY,
        )
        .map((key) => key.slice(EXIT_PERSIST_RECORD_PREFIX.length))
        .filter((id) => id.length > 0),
    ),
  ];
}

export function cloneQueuedRecord(record: QueuedExitPersistRecord): QueuedExitPersistRecord {
  return {
    sessionId: record.sessionId,
    queuedAt: record.queuedAt,
    record: cloneSessionRecord(record.record),
  };
}

export function compareQueuedRecordFreshness(
  left: QueuedExitPersistRecord,
  right: QueuedExitPersistRecord,
): number {
  const updatedAtCompare = left.record.updatedAt.localeCompare(right.record.updatedAt);
  if (updatedAtCompare !== 0) {
    return updatedAtCompare;
  }

  return left.queuedAt.localeCompare(right.queuedAt);
}

export function mergeQueuedRecordCollections(
  storageRecords: QueuedExitPersistRecord[],
  memoryRecords: QueuedExitPersistRecord[],
): QueuedExitPersistRecord[] {
  const merged = new Map<string, QueuedExitPersistRecord>();

  [...storageRecords, ...memoryRecords].forEach((record) => {
    const current = merged.get(record.sessionId);
    if (!current || compareQueuedRecordFreshness(record, current) > 0) {
      merged.set(record.sessionId, cloneQueuedRecord(record));
    }
  });

  return [...merged.values()];
}

export function resolvePersistReplayLastError(diagnostics: PersistReplayDiagnostics): string | null {
  return (
    diagnostics.lastCleanupError ??
    diagnostics.lastReplayError ??
    diagnostics.lastPageExitPersistError ??
    diagnostics.lastQueueWriteError ??
    null
  );
}

export function isValidDateString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

export function isSessionRecordLike(value: unknown): value is SessionRecord {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as SessionRecord).id === "string" &&
    typeof (value as SessionRecord).updatedAt === "string" &&
    Array.isArray((value as SessionRecord).entries)
  );
}

export function isQueuedExitPersistRecordLike(value: unknown): value is QueuedExitPersistRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<QueuedExitPersistRecord>;
  return (
    typeof candidate.sessionId === "string" &&
    candidate.sessionId.length > 0 &&
    isValidDateString(candidate.queuedAt) &&
    isSessionRecordLike(candidate.record) &&
    candidate.record.status === "stopped"
  );
}

export function sanitizeQueuedRecord(value: unknown): QueuedExitPersistRecord | undefined {
  if (!isQueuedExitPersistRecordLike(value)) {
    return undefined;
  }

  return {
    sessionId: value.sessionId,
    queuedAt: value.queuedAt,
    record: cloneSessionRecord(value.record),
  };
}

export function createEmptyPersistReplayDiagnostics(): PersistReplayDiagnostics {
  return {
    lastReplayAt: null,
    lastReplayQueuedCount: 0,
    lastReplayReplayedCount: 0,
    lastReplaySkippedCount: 0,
    lastReplayFailedCount: 0,
    lastReplayError: null,
    lastCleanupAt: null,
    lastCleanupDetectedCount: 0,
    lastCleanupClosedCount: 0,
    lastCleanupFailedCount: 0,
    lastCleanupError: null,
    lastQueueWriteError: null,
    lastPageExitPersistAttemptAt: null,
    lastPageExitPersistSessionId: null,
    lastPageExitPersistEntryCount: 0,
    lastPageExitPersistError: null,
    lastError: null,
  };
}

export function sanitizePersistReplayDiagnostics(value: unknown): PersistReplayDiagnostics {
  if (!value || typeof value !== "object") {
    return createEmptyPersistReplayDiagnostics();
  }

  const candidate = value as Partial<PersistReplayDiagnostics>;
  return {
    lastReplayAt: isValidDateString(candidate.lastReplayAt) ? candidate.lastReplayAt : null,
    lastReplayQueuedCount:
      typeof candidate.lastReplayQueuedCount === "number" ? candidate.lastReplayQueuedCount : 0,
    lastReplayReplayedCount:
      typeof candidate.lastReplayReplayedCount === "number"
        ? candidate.lastReplayReplayedCount
        : 0,
    lastReplaySkippedCount:
      typeof candidate.lastReplaySkippedCount === "number" ? candidate.lastReplaySkippedCount : 0,
    lastReplayFailedCount:
      typeof candidate.lastReplayFailedCount === "number" ? candidate.lastReplayFailedCount : 0,
    lastReplayError:
      typeof candidate.lastReplayError === "string" && candidate.lastReplayError
        ? candidate.lastReplayError
        : null,
    lastCleanupAt: isValidDateString(candidate.lastCleanupAt) ? candidate.lastCleanupAt : null,
    lastCleanupDetectedCount:
      typeof candidate.lastCleanupDetectedCount === "number"
        ? candidate.lastCleanupDetectedCount
        : 0,
    lastCleanupClosedCount:
      typeof candidate.lastCleanupClosedCount === "number" ? candidate.lastCleanupClosedCount : 0,
    lastCleanupFailedCount:
      typeof candidate.lastCleanupFailedCount === "number" ? candidate.lastCleanupFailedCount : 0,
    lastCleanupError:
      typeof candidate.lastCleanupError === "string" && candidate.lastCleanupError
        ? candidate.lastCleanupError
        : null,
    lastQueueWriteError:
      typeof candidate.lastQueueWriteError === "string" && candidate.lastQueueWriteError
        ? candidate.lastQueueWriteError
        : null,
    lastPageExitPersistAttemptAt: isValidDateString(candidate.lastPageExitPersistAttemptAt)
      ? candidate.lastPageExitPersistAttemptAt
      : null,
    lastPageExitPersistSessionId:
      typeof candidate.lastPageExitPersistSessionId === "string" &&
      candidate.lastPageExitPersistSessionId
        ? candidate.lastPageExitPersistSessionId
        : null,
    lastPageExitPersistEntryCount:
      typeof candidate.lastPageExitPersistEntryCount === "number"
        ? candidate.lastPageExitPersistEntryCount
        : 0,
    lastPageExitPersistError:
      typeof candidate.lastPageExitPersistError === "string" && candidate.lastPageExitPersistError
        ? candidate.lastPageExitPersistError
        : null,
    lastError: typeof candidate.lastError === "string" && candidate.lastError ? candidate.lastError : null,
  };
}
