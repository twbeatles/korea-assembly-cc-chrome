import type {
  CaptureStatus,
  ExportFormat,
  SubtitleEntry,
} from "../core/subtitle-models";

export interface StatusSnapshot {
  connected: boolean;
  requiresReload: boolean;
  status: CaptureStatus;
  sessionId: string;
  title: string;
  committeeName: string;
  sourceUrl: string;
  subtitleCount: number;
  charCount: number;
  previewText: string;
  recentEntries: SubtitleEntry[];
  startedAt: string | null;
  endedAt: string | null;
  updatedAt: string | null;
  lastPersistedAt: string | null;
  observerActive: boolean;
  currentSelector: string;
  currentFramePath: number[];
}

export interface CaptureStatusPayload {
  connected: boolean;
  requiresReload: boolean;
  status: CaptureStatus;
  sessionId: string;
  title: string;
  committeeName: string;
  sourceUrl: string;
  startedAt: string | null;
  endedAt: string | null;
  updatedAt: string | null;
  lastPersistedAt: string | null;
  observerActive: boolean;
  currentSelector: string;
  currentFramePath: number[];
}

export interface PreviewUpdatePayload {
  sessionId: string;
  previewText: string;
  recentEntries: SubtitleEntry[];
}

export interface SessionStatsPayload {
  sessionId: string;
  subtitleCount: number;
  charCount: number;
}

export type PopupToContentMessage =
  | { type: "PING" }
  | { type: "GET_STATUS" }
  | { type: "START_CAPTURE" }
  | { type: "STOP_CAPTURE" }
  | { type: "CLEAR_SESSION" }
  | { type: "SAVE_SESSION" }
  | { type: "EXPORT_REQUEST"; format: ExportFormat };

export type ContentToPopupMessage =
  | { type: "CAPTURE_STATUS"; payload: CaptureStatusPayload }
  | { type: "PREVIEW_UPDATE"; payload: PreviewUpdatePayload }
  | { type: "SESSION_STATS"; payload: SessionStatsPayload }
  | { type: "ERROR"; message: string };

export type BackgroundCommandMessage =
  | { type: "ENSURE_CONTENT_SCRIPT"; tabId: number; url?: string }
  | {
      type: "DOWNLOAD_REQUEST";
      filename: string;
      content: string;
      mimeType: string;
    }
  | { type: "OPEN_HISTORY_PAGE" }
  | { type: "OPEN_OPTIONS_PAGE" };

export type BackgroundCommandResponse =
  | { ok: true; ready?: boolean; requiresReload?: boolean; downloadId?: number }
  | { ok: false; error: string; requiresReload?: boolean };

export interface ObserverBridgeEvent {
  source: string;
  kind: "subtitle:update" | "subtitle:reset" | "subtitle:health";
  raw?: string;
  selector?: string;
  framePath?: number[];
  timestamp: number;
  sourceUrl: string;
  observerActive?: boolean;
}

export interface FrameForwardMessage {
  source: string;
  event: ObserverBridgeEvent;
}
