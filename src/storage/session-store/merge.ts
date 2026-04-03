import { cloneSessionRecord, type SessionRecord } from "../../core/subtitle-models";
import type { SourcedSessionRecord } from "./internal-types";

export function compareSessionFreshness(
  left: SourcedSessionRecord,
  right: SourcedSessionRecord,
): number {
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

export function compareFallbackFreshness(left: SessionRecord, right: SessionRecord): number {
  const updatedCompare = left.updatedAt.localeCompare(right.updatedAt);
  if (updatedCompare !== 0) {
    return updatedCompare;
  }

  return 0;
}

export function mergeFallbackSnapshots(
  storageSnapshot: Record<string, SessionRecord>,
  memorySnapshot: Record<string, SessionRecord>,
): Record<string, SessionRecord> {
  const merged = new Map<string, SessionRecord>();

  Object.entries(storageSnapshot).forEach(([key, value]) => {
    merged.set(key, cloneSessionRecord(value));
  });

  Object.entries(memorySnapshot).forEach(([key, value]) => {
    const current = merged.get(key);
    if (!current || compareFallbackFreshness(value, current) >= 0) {
      merged.set(key, cloneSessionRecord(value));
    }
  });

  return Object.fromEntries(
    [...merged.entries()].map(([key, value]) => [key, cloneSessionRecord(value)]),
  );
}
