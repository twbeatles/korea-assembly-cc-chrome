import type { CaptureMode, LiveCaptureLedger } from "../../core/live-capture";
import type { SessionState } from "../../core/subtitle-models";
import type {
  FallbackCommitState,
  ObserverBridgeEvent,
  PersistabilityState,
  RowKeySource,
} from "../../shared/message-types";
import type { ExtensionSettings } from "../../storage/types";
import type { InPagePanelController } from "../inpage-panel";
import type { FailedStoppedSessionGuard } from "../failed-stopped-session";
import type { RunningPersistTrigger } from "../autosave";

export const CONTENT_SCRIPT_BOOTSTRAP_ATTRIBUTE =
  "data-assembly-subtitle-content-script";

export interface ContentRuntime {
  bootstrap: () => Promise<void>;
  handleBootstrapError: (error: unknown) => void;
  services: ContentRuntimeServices;
}

export interface RowDiagnosticsState {
  stableRowCount: number;
  unstableRowCount: number;
  filteredUnconfirmedCount: number;
  rowKeySources: Partial<Record<RowKeySource, number>>;
}

export interface FallbackCommitCandidate {
  raw: string;
  selector?: string;
  framePath?: number[];
  firstSeenAt: number;
  lastSeenAt: number;
  observationCount: number;
  token: number;
}

export interface ContentRuntimeContext {
  environment: {
    isTopFrame: boolean;
    localFramePath: number[];
    injectedScriptId: string;
  };
  session: {
    settings: ExtensionSettings;
    state: SessionState;
    liveCaptureLedger: LiveCaptureLedger;
    failedStoppedSessionGuard: FailedStoppedSessionGuard;
  };
  ports: {
    popupPorts: Set<chrome.runtime.Port>;
    diagnosticsPorts: Set<chrome.runtime.Port>;
  };
  timers: {
    localPollingTimer: number | null;
    topFallbackTimer: number | null;
    persistTimer: number | null;
    pendingResetTimer: number | null;
    frameForwardNonceRefreshTimer: number | null;
    fallbackCommitTimer: number | null;
    urlChangePollingTimer: number | null;
  };
  capture: {
    capturePipelineStarted: boolean;
    latestPersistabilityState: PersistabilityState;
    latestFallbackCommitState: FallbackCommitState;
    latestRowDiagnostics: RowDiagnosticsState;
    fallbackCommitCandidate: FallbackCommitCandidate | null;
    queuedSegmentRolloverEvents: ObserverBridgeEvent[];
    captureMode: CaptureMode;
  };
  ui: {
    panelCollapsed: boolean;
    previewCollapsed: boolean;
    panelNotice: string;
    inPagePanel: InPagePanelController | null;
  };
  persistence: {
    pendingRunningPersistSince: number | null;
    pendingRunningPersistTrigger: RunningPersistTrigger | null;
    lastNavigationSnapshotAt: number;
  };
}

export interface RuntimeUiService {
  updateInPagePanel: () => void;
  syncUserInterfaces: (requiresReload?: boolean) => void;
}

export interface RuntimePersistenceService {
  clearRunningPersistTimer: () => void;
}

export interface RuntimeCapturePipelineService {
  startCapturePipelineForCurrentPage: () => Promise<void>;
  stopCapturePipelineForCurrentPage: () => void;
}

export interface RuntimeSessionActions {
  startCapture: () => Promise<void>;
  stopCapture: () => Promise<void>;
}

export interface RuntimeBindings {
  bindPopupPort: () => void;
  bindSettingsChanges: () => void;
  bindNavigationGuards: () => void;
  bindUrlChangeDetection: () => void;
  bindBridgeMessages: () => void;
}

export interface ContentRuntimeServices {
  ui: RuntimeUiService;
  persistence: RuntimePersistenceService;
  capturePipeline: RuntimeCapturePipelineService;
  sessionActions: RuntimeSessionActions;
  bindings: RuntimeBindings;
}
