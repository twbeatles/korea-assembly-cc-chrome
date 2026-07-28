import type { SessionRecord } from "../../core/subtitle-models";
import type { ChunkedSessionMetadataRecord } from "./entry-chunks";

export const LEGACY_FALLBACK_STORAGE_KEY = "assembly-subtitle-session-fallback";
export const FALLBACK_INDEX_STORAGE_KEY = "assembly-subtitle-session-fallback:index";
export const FALLBACK_METADATA_STORAGE_KEY =
  "assembly-subtitle-session-fallback:metadata";
export const FALLBACK_RECORD_PREFIX = "assembly-subtitle-session-fallback:record:";

/** IDB open 일시 실패 후 재시도까지 대기 시간 */
export const INDEXED_DB_DISABLE_TTL_MS = 30_000;

/** IDB open / fallback queue 등 재할당 가능 런타임 상태 */
export const storeRuntime = {
  dbPromise: null as Promise<IDBDatabase> | null,
  indexedDbAvailable: true,
  /** 이 시각 이전까지 IndexedDB 사용을 보류한다. 0 이면 보류 없음. */
  indexedDbDisabledUntil: 0,
  /** 마지막 open 실패 사유(진단용, 선택) */
  lastIndexedDbOpenError: null as string | null,
  fallbackMutationQueue: Promise.resolve() as Promise<unknown>,
};

export const memoryFallbackStore = new Map<string, SessionRecord>();

export type SessionRecordSource = "indexeddb" | "fallback";

export interface SourcedSessionRecord {
  source: SessionRecordSource;
  record: SessionRecord;
}

export interface IndexedDbSessionRecord extends ChunkedSessionMetadataRecord {
  starredIndexKey: 0 | 1;
  sortKey: string;
}

export interface IndexedDbAttempt<T> {
  ok: boolean;
  value?: T;
  error?: unknown;
}
