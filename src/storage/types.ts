import type { ExportFormat, SessionRecord, StoredSessionRecord, SubtitleEntry } from "../core/subtitle-models";

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

export interface SessionExportOptions {
  filenamePattern?: string;
  entries?: SubtitleEntry[];
}

export interface SessionImportSummary {
  addedCount: number;
  updatedCount: number;
  keptCount: number;
  failedCount: number;
}

export interface SessionStoreApi {
  saveSession: (session: SessionRecord) => Promise<SessionRecord>;
  upsertSessionRecord: (session: SessionRecord) => Promise<SessionRecord>;
  loadSession: (id: string) => Promise<SessionRecord | undefined>;
  listSessions: (options?: SessionListOptions) => Promise<SessionRecord[]>;
  deleteSession: (id: string) => Promise<void>;
  deleteAllSessions: () => Promise<void>;
  updateRunningSession: (session: SessionRecord) => Promise<SessionRecord>;
  importSessionRecords: (
    sessions: StoredSessionRecord[],
  ) => Promise<SessionImportSummary>;
  exportSessionData: (
    session: SessionRecord,
    format: ExportFormat,
    filenamePattern?: string,
    entries?: SubtitleEntry[],
  ) => Promise<ExportPayload>;
}
