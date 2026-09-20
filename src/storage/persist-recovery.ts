/**
 * 하위 호환 facade — 기존 import 경로 유지.
 * 구현: ./persist-recovery/ (keys/state/sanitize/index-store/tombstones/diagnostics/queue/testing)
 */
export { EXIT_PERSIST_INDEX_STORAGE_KEY } from "./persist-recovery/index";
export {
  recoverOrphanedExitPersistRecords,
  rebuildExitPersistIndexFromStorage,
} from "./persist-recovery/index";
export { markSessionDeleted, isSessionDeleted } from "./persist-recovery/index";
export { createEmptyPersistReplayDiagnostics } from "./persist-recovery/index";
export {
  queueExitPersistRecord,
  listQueuedExitPersistRecords,
  clearQueuedExitPersistRecord,
  clearQueuedExitPersistRecordsUpTo,
} from "./persist-recovery/index";
export {
  recordPageExitPersistAttempt,
  readPersistReplayDiagnostics,
  writePersistReplayDiagnostics,
} from "./persist-recovery/index";
export { resetPersistRecoveryMemoryForTests } from "./persist-recovery/index";
export { resetPersistRecoveryStateForTests } from "./persist-recovery/index";
