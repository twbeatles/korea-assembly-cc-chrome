/**
 * 하위 호환 facade — 기존 import 경로 유지.
 * 구현: ./public-api/
 */
export {
  SESSION_NOTE_MAX_LENGTH,
  saveSession,
  updateRunningSession,
  upsertSessionRecord,
  updateSessionMetadata,
  updateSessionLineageMetadata,
  updateSessionContent,
  loadSession,
  loadSessionsByIds,
  getSessionLibraryOverview,
  buildSessionLibraryBackupExport,
  listSessions,
  listSessionLineageSegments,
  listSessionsPage,
  listSessionLineagesPage,
  searchSessions,
  searchSessionLineagesPage,
  deleteSession,
  deleteSessionLineage,
  deleteAllSessions,
  importSessionRecords,
  exportSessionData,
  exportSessionLineageData,
  replayQueuedExitPersistRecords,
  closeRunningSessionsOnStartup,
  resetSessionStoreForTests,
} from "./public-api/index";
