/** storage 키 상수·키 빌더·chrome storage 가드 (단일 책임: 키 관리). */
export const EXIT_PERSIST_RECORD_PREFIX = "assembly-subtitle-exit-persist:";

/** 큐 세션 id 목록. list 시 storage 전체 get(null) 을 피하기 위한 인덱스. */
export const EXIT_PERSIST_INDEX_STORAGE_KEY = "assembly-subtitle-exit-persist:index";

export const PERSIST_REPLAY_DIAGNOSTICS_STORAGE_KEY = "assembly-subtitle-persist-replay-diagnostics";

export const SESSION_DELETED_PREFIX = "assembly-subtitle-deleted-session:";

export function hasChromeStorageLocal(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}

export function getQueuedRecordStorageKey(sessionId: string): string {
  return `${EXIT_PERSIST_RECORD_PREFIX}${sessionId}`;
}

export function getDeletedSessionStorageKey(sessionId: string): string {
  return `${SESSION_DELETED_PREFIX}${sessionId}`;
}
