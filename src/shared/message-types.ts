import type {
  CaptureStatus,
  ExportFormat,
  SpeakerChannel,
  SessionRecord,
  SubtitleEntry,
} from "../core/subtitle-models";
import type { CaptureMode } from "../core/live-capture";

export interface CaptureDiagnostics {
  captureMode: CaptureMode;
  observerActive: boolean;
  currentSelector: string;
  currentFramePath: number[];
  sourceLabel: string;
}

export type PersistContext =
  | "idle"
  | "running_autosave"
  | "stopped_final_save"
  | "page_exit_checkpoint";

export interface ObservedSubtitleRow {
  nodeKey: string;
  text: string;
  speakerColor: string;
  speakerChannel: SpeakerChannel;
  unstableKey: boolean;
}

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
  canPersistPreparedContent: boolean;
  persistContext: PersistContext;
  stopPersistInFlight: boolean;
  observerActive: boolean;
  currentSelector: string;
  currentFramePath: number[];
  diagnostics: CaptureDiagnostics;
}

export interface PopupFeedbackPayload {
  command: "OPEN_INPAGE_PANEL" | "SAVE_SESSION";
  message: string;
  panelOpened?: boolean;
}

export type PopupToContentMessage =
  | { type: "GET_STATUS" }
  | { type: "OPEN_INPAGE_PANEL" }
  | { type: "START_CAPTURE" }
  | { type: "STOP_CAPTURE" }
  | { type: "CLEAR_SESSION" }
  | { type: "SAVE_SESSION" }
  | { type: "EXPORT_REQUEST"; format: ExportFormat };

export type TabCommandResponse =
  | {
      ok: true;
      snapshot?: StatusSnapshot;
      feedback?: PopupFeedbackPayload;
    }
  | {
      ok: false;
      error: string;
      snapshot?: StatusSnapshot;
    };

export type BackgroundCommandMessage =
  | {
      type: "PERSIST_SESSION_RECORD";
      record: SessionRecord;
    }
  | {
      type: "DOWNLOAD_REQUEST";
      filename: string;
      content: string;
      mimeType: string;
    }
  | { type: "OPEN_HISTORY_PAGE" }
  | { type: "OPEN_OPTIONS_PAGE" }
  | { type: "OPEN_DIAGNOSTICS_PAGE"; tabId?: number };

export type BackgroundCommandResponse =
  | { ok: true; downloadId?: number }
  | { ok: false; error: string };

export type OffscreenDocumentMessage =
  | {
      type: "OFFSCREEN_CREATE_BLOB_URL";
      content: string;
      mimeType: string;
    }
  | {
      type: "OFFSCREEN_REVOKE_BLOB_URL";
      url: string;
    };

export type OffscreenDocumentResponse =
  | { ok: true; url?: string }
  | { ok: false; error: string };
