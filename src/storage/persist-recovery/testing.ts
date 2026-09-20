import { EXIT_PERSIST_INDEX_STORAGE_KEY, EXIT_PERSIST_RECORD_PREFIX, PERSIST_REPLAY_DIAGNOSTICS_STORAGE_KEY, SESSION_DELETED_PREFIX, hasChromeStorageLocal } from "./keys";
import { resetPersistRecoveryMemoryForTests } from "./state";

/** 테스트 전용 상태 초기화 (단일 책임: 테스트 격리). */
export async function resetPersistRecoveryStateForTests(): Promise<void> {
  resetPersistRecoveryMemoryForTests();
  if (!hasChromeStorageLocal()) {
    return;
  }

  const snapshot = await chrome.storage.local.get(null);
  const keys = Object.keys(snapshot).filter(
    (key) =>
      key === PERSIST_REPLAY_DIAGNOSTICS_STORAGE_KEY ||
      key === EXIT_PERSIST_INDEX_STORAGE_KEY ||
      key.startsWith(EXIT_PERSIST_RECORD_PREFIX) ||
      key.startsWith(SESSION_DELETED_PREFIX),
  );
  if (keys.length) {
    await chrome.storage.local.remove(keys);
  }
}
