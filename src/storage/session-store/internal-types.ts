import type { SessionRecord } from "../../core/subtitle-models";

export interface IndexedDbAttempt<T> {
  ok: boolean;
  value?: T;
  error?: unknown;
}

export type SessionRecordSource = "indexeddb" | "fallback";

export interface SourcedSessionRecord {
  source: SessionRecordSource;
  record: SessionRecord;
}

export interface IndexedDbSessionRecord extends SessionRecord {
  starredIndexKey: 0 | 1;
  sortKey: string;
}
