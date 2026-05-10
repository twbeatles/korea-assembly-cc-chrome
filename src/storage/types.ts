import type {
  ExportFormat,
  SessionRecord,
  SpeakerLabels,
  StoredSessionRecord,
  SubtitleEntry,
} from "../core/subtitle-models";

export interface AssemblyPreset {
  id: string;
  name: string;
  url: string;
  committeeName: string;
  autoStartEnabled: boolean;
  noiseFilterEnabled: boolean;
}

export interface ExtensionSettings {
  autoScroll: boolean;
  keepaliveIntervalMs: number;
  pollingFallbackIntervalMs: number;
  maxBufferLength: number;
  noiseFilterEnabled: boolean;
  recentDuplicateMinLength: number;
  filenamePattern: string;
  txtExportTimestampsEnabled: boolean;
  txtExportSpeakerEnabled: boolean;
  txtExportEntryNotesEnabled: boolean;
  runningAutoSaveEnabled: boolean;
  runningAutoSaveDebounceMs: number;
  recentCopyLineCount: number;
  debugLogging: boolean;
  autoStartEnabled: boolean;
  filterUnconfirmedEnabled: boolean;
  presets: AssemblyPreset[];
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

export interface SessionExportOptions {
  filenamePattern?: string;
  entries?: SubtitleEntry[];
  txtExportTimestampsEnabled?: boolean;
  txtExportSpeakerEnabled?: boolean;
  txtExportEntryNotesEnabled?: boolean;
  timeRange?: {
    from?: string;
    to?: string;
  };
}

export interface SessionMetadataPatch {
  starred?: boolean;
  pinnedAt?: string | null;
  note?: string;
  tags?: string[];
  category?: string;
  speakerLabels?: SpeakerLabels;
}

export interface SessionContentPatch {
  entries?: SubtitleEntry[];
  tags?: string[];
  category?: string;
  speakerLabels?: SpeakerLabels;
}

export interface SessionSearchHit {
  field:
    | "title"
    | "committeeName"
    | "note"
    | "tag"
    | "category"
    | "entry";
  entryId?: string;
  text: string;
}

export interface SessionSearchResult {
  session: SessionRecord;
  matchCount: number;
  firstHit: SessionSearchHit | null;
}

export interface SessionSearchOptions {
  query?: string;
  starredOnly?: boolean;
  tag?: string;
  category?: string;
  highlightedOnly?: boolean;
  page: number;
  pageSize: number;
}

export interface SessionSearchPageResult {
  results: SessionSearchResult[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export interface SessionImportSummary {
  addedCount: number;
  updatedCount: number;
  keptCount: number;
  failedCount: number;
}

export type SessionLongTaskKind = "backup" | "import";

export interface SessionLongTaskProgress {
  kind: SessionLongTaskKind;
  phase: string;
  completed: number;
  total: number;
  message: string;
}

export interface SessionLongTaskOptions {
  signal?: AbortSignal;
  onProgress?: (progress: SessionLongTaskProgress) => void;
}

export interface BuildSessionLibraryBackupExportOptions extends SessionLongTaskOptions {
  pageSize?: number;
}

export type ImportSessionRecordsOptions = SessionLongTaskOptions;

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
  lastQueueWriteError: string | null;
  lastPageExitPersistAttemptAt: string | null;
  lastPageExitPersistSessionId: string | null;
  lastPageExitPersistEntryCount: number;
  lastPageExitPersistError: string | null;
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
  updateSessionMetadata: (
    sessionId: string,
    patch: SessionMetadataPatch,
  ) => Promise<SessionRecord>;
  updateSessionContent: (
    sessionId: string,
    patch: SessionContentPatch,
  ) => Promise<SessionRecord>;
  loadSession: (id: string) => Promise<SessionRecord | undefined>;
  loadSessionsByIds: (ids: string[]) => Promise<SessionRecord[]>;
  listSessions: (options?: SessionListOptions) => Promise<SessionRecord[]>;
  listSessionsPage: (options: SessionPageOptions) => Promise<SessionPageResult>;
  searchSessions: (options: SessionSearchOptions) => Promise<SessionSearchPageResult>;
  getSessionLibraryOverview: (previewLimit?: number) => Promise<SessionLibraryOverview>;
  buildSessionLibraryBackupExport: (
    options?: BuildSessionLibraryBackupExportOptions,
  ) => Promise<LibraryBackupExport>;
  deleteSession: (id: string) => Promise<void>;
  deleteAllSessions: () => Promise<void>;
  updateRunningSession: (session: SessionRecord) => Promise<SessionRecord>;
  replayQueuedExitPersistRecords: () => Promise<PersistReplaySummary>;
  importSessionRecords: (
    sessions: StoredSessionRecord[],
    options?: ImportSessionRecordsOptions,
  ) => Promise<SessionImportSummary>;
  exportSessionData: (
    session: SessionRecord,
    format: ExportFormat,
    options?: SessionExportOptions,
  ) => Promise<ExportPayload>;
  closeRunningSessionsOnStartup: () => Promise<StartupCleanupSummary>;
}
