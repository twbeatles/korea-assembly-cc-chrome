import type { ExportFormat, SessionRecord } from "../core/subtitle-models";

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

export interface SessionStoreApi {
  saveSession: (session: SessionRecord) => Promise<SessionRecord>;
  loadSession: (id: string) => Promise<SessionRecord | undefined>;
  listSessions: (options?: SessionListOptions) => Promise<SessionRecord[]>;
  deleteSession: (id: string) => Promise<void>;
  updateRunningSession: (session: SessionRecord) => Promise<SessionRecord>;
  exportSessionData: (
    session: SessionRecord,
    format: ExportFormat,
    filenamePattern?: string,
  ) => Promise<ExportPayload>;
}
