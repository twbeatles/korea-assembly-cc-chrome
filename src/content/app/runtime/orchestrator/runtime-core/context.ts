import type { LiveCaptureLedger } from "../../../../../core/live-capture";
import type { SessionState } from "../../../../../core/subtitle-models";
import type { FallbackCommitState, ObserverBridgeEvent, PersistabilityState } from "../../../../../shared/message-types";
import type { ExtensionSettings } from "../../../../../storage/types";
import type { InPagePanelController } from "../../../../inpage-panel";
import type { FailedStoppedSessionGuard } from "../../../../failed-stopped-session";
import type { RunningPersistTrigger } from "../../../../autosave";
import type { FallbackCommitCandidate, RowDiagnosticsState } from "../../types";
import type { RuntimeSessionSegmentationReason } from "../../../../runtime/segmentation-policy";
import { createEmptyLiveCaptureLedger } from "../../../../../core/live-capture";
import { createEmptySessionState } from "../../../../../core/subtitle-models";
import { DEFAULT_RUNTIME_SESSION_SEGMENT_MAX_CHARS, DEFAULT_RUNTIME_SESSION_SEGMENT_MAX_DURATION_MINUTES, DEFAULT_RUNTIME_SESSION_SEGMENT_MAX_ENTRIES, PIPELINE_DEFAULTS } from "../../../../../shared/constants";
import { createRandomToken } from "../../../../../shared/random-token";
import { createEmptyFailedStoppedSessionGuard } from "../../../../failed-stopped-session";
import { createCaptureLifecycleLock } from "../../../../runtime/capture-lifecycle-lock";
import { createUrlReconcileController } from "../../../../runtime/url-reconcile";
import { createObserverBridgeToken, resolveDefaultPanelNotice } from "../helpers";

/**
 * runtime-core 가변 상태 bag. 모듈 레벨 상태 대신 인스턴스별로 소유한다.
 * 도메인 모듈 함수는 모두 이 ctx 를 첫 인자로 받는다.
 */
export interface RuntimeCoreContext {
  settings: ExtensionSettings;
  state: SessionState;
  popupPorts: Set<chrome.runtime.Port>;
  diagnosticsPorts: Set<chrome.runtime.Port>;
  localPollingTimer: number | null;
  topFallbackTimer: number | null;
  persistTimer: number | null;
  pendingRunningPersistSince: number | null;
  pendingRunningPersistTrigger: RunningPersistTrigger | null;
  pendingResetTimer: number | null;
  localLastProbeSignature: string;
  localHadProbeText: boolean;
  topFallbackMissStreak: number;
  lastSuccessfulFallbackFramePath: number[] | null;
  localPollingUnconfirmedFallbackBlockStreak: number;
  topFallbackUnconfirmedFallbackBlockStreak: number;
  panelCollapsed: boolean;
  previewCollapsed: boolean;
  panelNotice: string;
  inPagePanel: InPagePanelController | null;
  frameForwardNonce: string;
  frameForwardNonceRefreshTimer: number | null;
  frameForwardNonceRefreshInFlight: boolean;
  observerBridgeToken: string;
  lastSubtitleActivationAttemptAt: number;
  lastNavigationSnapshotAt: number;
  liveCaptureLedger: LiveCaptureLedger;
  extensionContextInvalidated: boolean;
  failedStoppedSessionGuard: FailedStoppedSessionGuard;
  latestPersistabilityState: PersistabilityState;
  latestRowDiagnostics: RowDiagnosticsState;
  latestFallbackCommitState: FallbackCommitState;
  segmentRolloverInFlight: boolean;
  queuedSegmentRolloverEvents: ObserverBridgeEvent[];
  segmentRolloverToken: number;
  segmentRolloverEventsDroppedTotal: number;
  fallbackCommitCandidate: FallbackCommitCandidate | null;
  fallbackCommitTimer: number | null;
  fallbackCommitToken: number;
  capturePipelineStarted: boolean;
  urlChangePollingTimer: number | null;
  captureLifecycleLock: ReturnType<typeof createCaptureLifecycleLock>;
  urlReconcileController: ReturnType<typeof createUrlReconcileController>;
  lastSegmentCapacityWarningReason: RuntimeSessionSegmentationReason | null;
  captureOwnerId: string;
  captureOwnershipHeartbeatTimer: number | null;
}

export function createRuntimeCoreContext(): RuntimeCoreContext {
  return {
    settings: {
      autoScroll: true,
      segmentPreset: "balanced",
      keepaliveIntervalMs: PIPELINE_DEFAULTS.keepaliveIntervalMs,
      pollingFallbackIntervalMs: 200,
      maxBufferLength: PIPELINE_DEFAULTS.confirmedCompactMaxLength,
      maxEntriesPerSegment: DEFAULT_RUNTIME_SESSION_SEGMENT_MAX_ENTRIES,
      maxCharsPerSegment: DEFAULT_RUNTIME_SESSION_SEGMENT_MAX_CHARS,
      maxSegmentDurationMinutes:
        DEFAULT_RUNTIME_SESSION_SEGMENT_MAX_DURATION_MINUTES,
      noiseFilterEnabled: true,
      recentDuplicateMinLength: PIPELINE_DEFAULTS.recentDuplicateMinLength,
      filenamePattern: "{date}_{committee}_{time}",
      txtExportTimestampsEnabled: false,
      txtExportSpeakerEnabled: false,
      txtExportEntryNotesEnabled: false,
      panelSpeakerHighlightEnabled: false,
      runningAutoSaveEnabled: true,
      runningAutoSaveDebounceMs: 800,
      recentCopyLineCount: 5,
      debugLogging: false,
      autoStartEnabled: true,
      filterUnconfirmedEnabled: true,
      presets: [],
    },
    state: createEmptySessionState(
      window.location.href,
      document.title,
    ),
    popupPorts: new Set<chrome.runtime.Port>(),
    diagnosticsPorts: new Set<chrome.runtime.Port>(),
    localPollingTimer: null,
    topFallbackTimer: null,
    persistTimer: null,
    pendingRunningPersistSince: null,
    pendingRunningPersistTrigger: null,
    pendingResetTimer: null,
    localLastProbeSignature: "",
    localHadProbeText: false,
    topFallbackMissStreak: 0,
    lastSuccessfulFallbackFramePath: null,
    localPollingUnconfirmedFallbackBlockStreak: 0,
    topFallbackUnconfirmedFallbackBlockStreak: 0,
    panelCollapsed: false,
    previewCollapsed: true,
    panelNotice: resolveDefaultPanelNotice(),
    inPagePanel: null,
    frameForwardNonce: "",
    frameForwardNonceRefreshTimer: null,
    frameForwardNonceRefreshInFlight: false,
    observerBridgeToken: createObserverBridgeToken(),
    lastSubtitleActivationAttemptAt: 0,
    lastNavigationSnapshotAt: 0,
    liveCaptureLedger: createEmptyLiveCaptureLedger(),
    extensionContextInvalidated: false,
    failedStoppedSessionGuard: createEmptyFailedStoppedSessionGuard(),
    latestPersistabilityState: "idle",
    latestRowDiagnostics: {
      stableRowCount: 0,
      unstableRowCount: 0,
      filteredUnconfirmedCount: 0,
      rowKeySources: {},
    },
    latestFallbackCommitState: "idle",
    segmentRolloverInFlight: false,
    queuedSegmentRolloverEvents: [],
    segmentRolloverToken: 0,
    segmentRolloverEventsDroppedTotal: 0,
    fallbackCommitCandidate: null,
    fallbackCommitTimer: null,
    fallbackCommitToken: 0,
    capturePipelineStarted: false,
    urlChangePollingTimer: null,
    captureLifecycleLock: createCaptureLifecycleLock(),
    urlReconcileController: createUrlReconcileController(window.location.href),
    lastSegmentCapacityWarningReason: null,
    captureOwnerId: createRandomToken(),
    captureOwnershipHeartbeatTimer: null,
  };
}
