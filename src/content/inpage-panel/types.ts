import type { CaptureMode, LivePanelRow } from "../../core/live-capture";
import type { CaptureStatus, ExportFormat } from "../../core/subtitle-models";

export const IN_PAGE_PANEL_HOST_ID = "assembly-subtitle-panel-host";

export interface InPagePanelState {
  visible: boolean;
  collapsed: boolean;
  previewCollapsed: boolean;
  autoScroll: boolean;
  status: CaptureStatus;
  statusLabel: string;
  committeeName: string;
  startedAt: string | null;
  lastPersistedAt: string | null;
  previewText: string;
  livePreviewText: string;
  liveRows: LivePanelRow[];
  captureMode: CaptureMode;
  subtitleCount: number;
  charCount: number;
  recentCopyLineCount: number;
  notice: string;
  hasPersistableContent: boolean;
  canClearSession: boolean;
  showNotice: boolean;
  canHighlightLatestEntry: boolean;
}

export interface InPagePanelActions {
  onStartCapture: () => void;
  onStopCapture: () => void;
  onClearSession: () => void;
  onSaveSession: () => void;
  onSaveAndStartNewSession?: () => void;
  onHighlightLatestEntry?: () => void;
  onExport: (format: ExportFormat) => void;
  onCopyRecent: () => void;
  onOpenHistory: () => void;
  onOpenOptions: () => void;
  onOpenDiagnostics: () => void;
  onExpand: () => void;
  onCollapse: () => void;
  onTogglePreviewCollapsed: () => void;
}

export interface InPagePanelController {
  update: (state: InPagePanelState) => void;
  destroy: () => void;
}
