import type {
  CaptureStatus,
  ExportFormat,
  SpeakerChannel,
  SessionRecord,
  SubtitleEntry,
} from "../core/subtitle-models";
import type { CaptureMode } from "../core/live-capture";

export type PersistabilityState =
  | "idle"
  | "persistable"
  | "preview_only"
  | "unstable_only"
  | "filtered"
  | "duplicate";

export type RowKeySource = "attribute" | "class" | "generated";

export type FallbackCommitState =
  | "idle"
  | "pending"
  | "stable"
  | "committed"
  | "duplicate"
  | "filtered";

export interface SegmentDiagnostics {
  lineageId: string;
  segmentNumber: number;
  entryCount: number;
  charCount: number;
  elapsedMs: number | null;
  maxEntriesPerSegment: number;
  maxCharsPerSegment: number;
  maxDurationMs: number;
  remainingEntries: number;
  remainingChars: number;
  remainingDurationMs: number | null;
}

export interface ExportEstimateDiagnostics {
  txtBytes: number;
  srtBytes: number;
  vttBytes: number;
  jsonBytes: number;
  txtIncludesTimestamps: boolean;
}

export interface CaptureDiagnostics {
  captureMode: CaptureMode;
  observerActive: boolean;
  currentSelector: string;
  currentFramePath: number[];
  sourceLabel: string;
  persistabilityState: PersistabilityState;
  persistabilityHint: string;
  stableRowCount: number;
  unstableRowCount: number;
  filteredUnconfirmedCount: number;
  rowKeySources: Partial<Record<RowKeySource, number>>;
  fallbackCommitState: FallbackCommitState;
  segment?: SegmentDiagnostics;
  exportEstimates?: ExportEstimateDiagnostics;
}

export interface ObservedSubtitleRow {
  nodeKey: string;
  text: string;
  speakerColor: string;
  speakerChannel: SpeakerChannel;
  unstableKey: boolean;
  nodeKeySource?: RowKeySource;
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
  observerActive: boolean;
  currentSelector: string;
  currentFramePath: number[];
  diagnostics: CaptureDiagnostics;
  hasPersistableContent: boolean;
}

export interface CaptureStatusPayload {
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
  diagnostics: CaptureDiagnostics;
  hasPersistableContent: boolean;
}

export interface PreviewUpdatePayload {
  sessionId: string;
  previewText: string;
  recentEntries: SubtitleEntry[];
  hasPersistableContent: boolean;
}

export interface SessionStatsPayload {
  sessionId: string;
  subtitleCount: number;
  charCount: number;
  hasPersistableContent: boolean;
}

export interface PopupFeedbackPayload {
  command: "OPEN_INPAGE_PANEL" | "SAVE_SESSION";
  message: string;
  panelOpened?: boolean;
}

export type PopupToContentMessage =
  | { type: "PING" }
  | { type: "GET_STATUS" }
  | { type: "GET_DIAGNOSTICS_STATUS" }
  | { type: "OPEN_INPAGE_PANEL" }
  | { type: "START_CAPTURE" }
  | { type: "STOP_CAPTURE" }
  | { type: "CLEAR_SESSION" }
  | { type: "SAVE_SESSION" }
  | { type: "EXPORT_REQUEST"; format: ExportFormat };

export type ContentToPopupMessage =
  | { type: "CAPTURE_STATUS"; payload: CaptureStatusPayload }
  | { type: "PREVIEW_UPDATE"; payload: PreviewUpdatePayload }
  | { type: "SESSION_STATS"; payload: SessionStatsPayload }
  | { type: "POPUP_FEEDBACK"; payload: PopupFeedbackPayload }
  | { type: "ERROR"; message: string };

export type BackgroundCommandMessage =
  | { type: "ENSURE_CONTENT_SCRIPT"; tabId: number; url?: string }
  | { type: "GET_FRAME_FORWARD_NONCE" }
  | {
      type: "QUEUE_EXIT_PERSIST_RECORD";
      record: SessionRecord;
    }
  | {
      type: "PERSIST_SESSION_RECORD";
      record: SessionRecord;
    }
  | {
      type: "DELETE_SESSION_RECORD";
      sessionId: string;
    }
  | {
      type: "DOWNLOAD_REQUEST";
      filename: string;
      content: string;
      mimeType: string;
    }
  | {
      type: "DOWNLOAD_SESSION_EXPORT";
      sessionId: string;
      format: ExportFormat;
      filenamePattern?: string;
      txtExportTimestampsEnabled?: boolean;
      entryIds?: string[];
      filenameSuffix?: string;
    }
  | {
      type: "DOWNLOAD_SESSION_LINEAGE_EXPORT";
      lineageId: string;
      format: ExportFormat;
      filenamePattern?: string;
      txtExportTimestampsEnabled?: boolean;
      entryIds?: string[];
      filenameSuffix?: string;
    }
  | { type: "OPEN_HISTORY_PAGE" }
  | { type: "OPEN_OPTIONS_PAGE" }
  | { type: "OPEN_SIDE_PANEL"; tabId?: number }
  | { type: "OPEN_DIAGNOSTICS_PAGE"; tabId?: number };

export type BackgroundCommandResponse =
  | {
      ok: true;
      ready?: boolean;
      requiresReload?: boolean;
      downloadId?: number;
      nonce?: string;
      updatedAt?: string;
    }
  | { ok: false; error: string; requiresReload?: boolean };

export interface ObserverBridgeEvent {
  source: string;
  token?: string;
  kind: "subtitle:update" | "subtitle:reset" | "subtitle:health";
  raw?: string;
  rows?: ObservedSubtitleRow[];
  selector?: string;
  framePath?: number[];
  timestamp: number;
  sourceUrl: string;
  observerActive?: boolean;
  filteredUnconfirmedCount?: number;
}

export interface FrameForwardMessage {
  source: string;
  nonce: string;
  event: ObserverBridgeEvent;
}

export interface FrameForwardNonceMessage {
  source: string;
  nonce: string;
}

export type OffscreenDocumentMessage =
  | {
      type: "OFFSCREEN_CREATE_BLOB_URL";
      content?: string;
      contentParts?: string[];
      mimeType: string;
    }
  | {
      type: "OFFSCREEN_REVOKE_BLOB_URL";
      url: string;
    };

export type OffscreenDocumentResponse =
  | { ok: true; url?: string }
  | { ok: false; error: string };
