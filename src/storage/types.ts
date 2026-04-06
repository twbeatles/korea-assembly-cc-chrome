import type {
  ExportFormat,
  SessionRecord,
  StoredSessionRecord,
  SubtitleEntry,
} from "../core/subtitle-models";

export interface ExtensionSettings {
  autoScroll: boolean;
  keepaliveIntervalMs: number;
  pollingFallbackIntervalMs: number;
  maxBufferLength: number;
  noiseFilterEnabled: boolean;
  recentDuplicateMinLength: number;
  filenamePattern: string;
  runningAutoSaveEnabled: boolean;
  runningAutoSaveDebounceMs: number;
  recentCopyLineCount: number;
  exportTxtWithoutTimestamps: boolean;
  debugLogging: boolean;
  autoStartEnabled: boolean;
  filterUnconfirmedEnabled: boolean;
}

export interface ExportPayload {
  filename: string;
  format: ExportFormat;
  mimeType: string;
  content: string;
}

export interface SessionListOptions {
  limit?: number;
}

export interface SessionPageOptions {
  page: number;
  pageSize: number;
  starredOnly?: boolean;
}

export interface SessionPageResult {
  sessions: SessionRecord[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export interface SessionSearchPageOptions {
  query: string;
  page: number;
  pageSize: number;
  starredOnly?: boolean;
}

export interface SessionSearchHit {
  sessionId: string;
  title: string;
  committeeName: string;
  sourceUrl: string;
  startedAt: string;
  updatedAt: string;
  subtitleCount: number;
  charCount: number;
  status: SessionRecord["status"];
  starred: boolean;
  hasNote: boolean;
  matchedEntryIds: string[];
  matchedCount: number;
  firstSnippet: string;
}

export interface SessionSearchPageResult {
  results: SessionSearchHit[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export interface SessionExportOptions {
  filenamePattern?: string;
  entries?: SubtitleEntry[];
  stripTxtTimestamps?: boolean;
}

export interface SessionImportSummary {
  addedCount: number;
  updatedCount: number;
  keptCount: number;
  failedCount: number;
}

export interface StartupCleanupSummary {
  detectedCount: number;
  closedCount: number;
  failedCount: number;
}

export interface PersistReplaySummary {
  queuedCount: number;
  replayedCount: number;
  skippedCount: number;
  failedCount: number;
}

export interface PersistReplayDiagnostics {
  lastReplayAt: string | null;
  lastReplayQueuedCount: number;
  lastReplayReplayedCount: number;
  lastReplaySkippedCount: number;
  lastReplayFailedCount: number;
  lastReplayError: string | null;
  lastCleanupAt: string | null;
  lastCleanupDetectedCount: number;
  lastCleanupClosedCount: number;
  lastCleanupFailedCount: number;
  lastCleanupError: string | null;
  lastQueueWriteSessionId: string | null;
  lastQueueWriteRecordUpdatedAt: string | null;
  lastQueueWriteApproxBytes: number | null;
  lastQueueWriteError: string | null;
  lastStopPersistAt: string | null;
  lastStopPersistMode: "direct" | "background" | "replay" | null;
  lastError: string | null;
}

export interface QueuedExitPersistRecord {
  sessionId: string;
  queuedAt: string;
  record: SessionRecord;
}

export interface SessionLibraryPreview {
  id: string;
  title: string;
  committeeName: string;
  updatedAt: string;
}

export interface SessionLibraryOverview {
  totalCount: number;
  previewSessions: SessionLibraryPreview[];
}

export interface LibraryBackupExport {
  sessionCount: number;
  payload: ExportPayload;
}

export interface SessionStoreApi {
  saveSession: (session: SessionRecord) => Promise<SessionRecord>;
  upsertSessionRecord: (session: SessionRecord) => Promise<SessionRecord>;
  loadSession: (id: string) => Promise<SessionRecord | undefined>;
  loadSessionsByIds: (ids: string[]) => Promise<SessionRecord[]>;
  listSessions: (options?: SessionListOptions) => Promise<SessionRecord[]>;
  listSessionsPage: (options: SessionPageOptions) => Promise<SessionPageResult>;
  searchSessionsPage: (options: SessionSearchPageOptions) => Promise<SessionSearchPageResult>;
  getSessionLibraryOverview: (previewLimit?: number) => Promise<SessionLibraryOverview>;
  buildSessionLibraryBackupExport: () => Promise<LibraryBackupExport>;
  deleteSession: (id: string) => Promise<void>;
  deleteAllSessions: () => Promise<void>;
  updateRunningSession: (session: SessionRecord) => Promise<SessionRecord>;
  replayQueuedExitPersistRecords: () => Promise<PersistReplaySummary>;
  importSessionRecords: (
    sessions: StoredSessionRecord[],
  ) => Promise<SessionImportSummary>;
  exportSessionData: (
    session: SessionRecord,
    format: ExportFormat,
    filenamePattern?: string,
    entries?: SubtitleEntry[],
    stripTxtTimestamps?: boolean,
  ) => Promise<ExportPayload>;
  closeRunningSessionsOnStartup: () => Promise<StartupCleanupSummary>;
}
