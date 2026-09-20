/**
 * persist-recovery 공개 API 배럴 — 원래 src/storage/persist-recovery.ts 의 export 표면과 동일.
 * 내부 모듈: keys / state / sanitize / index-store / tombstones / diagnostics / queue / testing
 */
export { EXIT_PERSIST_INDEX_STORAGE_KEY } from "./keys";
export {
  recoverOrphanedExitPersistRecords,
  rebuildExitPersistIndexFromStorage,
} from "./index-store";
export { markSessionDeleted, isSessionDeleted } from "./tombstones";
export { createEmptyPersistReplayDiagnostics } from "./sanitize";
export {
  queueExitPersistRecord,
  listQueuedExitPersistRecords,
  clearQueuedExitPersistRecord,
  clearQueuedExitPersistRecordsUpTo,
} from "./queue";
export {
  recordPageExitPersistAttempt,
  readPersistReplayDiagnostics,
  writePersistReplayDiagnostics,
} from "./diagnostics";
export { resetPersistRecoveryMemoryForTests } from "./state";
export { resetPersistRecoveryStateForTests } from "./testing";
