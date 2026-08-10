import type { ContentRuntime, ContentRuntimeServices } from "../../context";
import {
  applyKeepalive,
  applyPreview,
  applyReset,
  commitLiveRow,
  finalizeSession,
} from "../../../../core/subtitle-pipeline";
import {
  clearLiveCaptureLedger,
  createEmptyLiveCaptureLedger,
  getLiveRow,
  listLivePanelRows,
  markLiveRowCommitted,
  normalizeCaptureEvent,
  reconcileLiveCapture,
  resetLiveCaptureLedgerForNewSegment,
  setLiveRowBaseline,
  type CaptureMode,
  type LivePanelRow,
} from "../../../../core/live-capture";
import {
  cloneState,
  createEmptySessionState,
  cloneEntry,
  type ExportFormat,
  type SessionRecord,
  type SessionState,
} from "../../../../core/subtitle-models";
import {
  DEFAULT_RUNTIME_SESSION_SEGMENT_MAX_CHARS,
  DEFAULT_RUNTIME_SESSION_SEGMENT_MAX_DURATION_MINUTES,
  DEFAULT_RUNTIME_SESSION_SEGMENT_MAX_ENTRIES,
  EXTENSION_STORAGE_KEY,
  FRAME_FORWARD_NONCE_SOURCE,
  OBSERVER_BRIDGE_SOURCE,
  OBSERVER_ACTIVATE_EVENT,
  OBSERVER_CONFIG_EVENT,
  OBSERVER_STOP_EVENT,
  PIPELINE_DEFAULTS,
  POPUP_PORT_NAME,
  SUBTITLE_SELECTOR_CANDIDATES,
} from "../../../../shared/constants";
import { mapDownloadErrorMessage } from "../../../../shared/download-errors";
import {
  applyPersistSuccess,
  clearScheduledRunningPersist,
  hasPersistableRunningContent,
  resolveRunningPersistDelayMs,
  scheduleRunningPersistTimer,
  shouldPersistFinalSession,
  shouldScheduleRunningPersist,
  shouldWarnBeforeUnload,
  type RunningPersistTrigger,
} from "../../../autosave";
import { sendRuntimeMessage } from "../../../../shared/chrome-api";
import {
  buildCopyText,
  copyTextToClipboard,
  selectCopyEntries,
} from "../../../../shared/copy-utils";
import {
  DUPLICATE_START_CAPTURE_NOTICE,
  shouldIgnoreStartCapture,
} from "../../../runtime/capture-start";
import { createCaptureLifecycleLock } from "../../../runtime/capture-lifecycle-lock";
import { createUrlReconcileController } from "../../../runtime/url-reconcile";
import {
  clearAutoStartCooldown,
  hasAutoStartCooldown,
  rememberAutoStartCooldown,
} from "../../../runtime/autostart-cooldown";
import {
  claimCaptureOwnership,
  getChromeLocalOwnershipStorage,
  heartbeatCaptureOwnership,
  releaseCaptureOwnership,
} from "../../../runtime/capture-ownership";
import { createRandomToken } from "../../../../shared/random-token";
import {
  invalidateExtensionContext,
  isExtensionContextInvalidatedError,
  markExtensionContextInvalidated,
} from "../../../../shared/extension-context";
import type {
  BackgroundCommandResponse,
  FrameForwardMessage,
  FallbackCommitState,
  ObservedSubtitleRow,
  ObserverBridgeEvent,
  PersistabilityState,
  RowKeySource,
  PopupToContentMessage,
  StatusSnapshot,
} from "../../../../shared/message-types";
import {
  probeBestAccessibleSubtitle,
  probeFramePath,
} from "../../../frame-probe";
import {
  buildInPagePanelState,
  createInPagePanel,
  type InPagePanelController,
} from "../../../inpage-panel";
import { resolvePanelLiveRows } from "../../../panel-live-rows";
import {
  clearFailedStoppedSessionGuard,
  createEmptyFailedStoppedSessionGuard,
  rememberFailedStoppedSession,
  resolveFailedStoppedSessionGuard,
} from "../../../failed-stopped-session";
import { RESET_CAPTURE_NOTICE } from "../../../capture-notice";
import { shouldEmitLocalProbeUpdate } from "../../../local-polling";
import { estimateRecentRaw } from "../../../dom-probe";
import {
  shouldAllowUnconfirmedContainerFallback,
  updateUnconfirmedFallbackBlockStreak,
} from "../../../unconfirmed-fallback";
import {
  queueExitPersistRecord,
  recordPageExitPersistAttempt,
} from "../../../../storage/persist-recovery";
import {
  getSettings,
  sanitizeSettings,
  saveSettings,
} from "../../../../storage/settings-store";
import type { ExtensionSettings } from "../../../../storage/types";
import {
  tryDomSubtitleActivation,
  waitForSubtitleLayer,
} from "../../../subtitle-layer";
import {
  createPopupFeedbackMessage,
  createPopupMessages,
  postToPopupPort,
} from "../../../popup-bridge";
import {
  forwardFrameEvent,
  isForwardedFrameMessage,
  isObserverBridgeEventMessage,
  resolveForwardedFrameNonceAction,
  resolveTopFallbackDelayMs,
} from "../../../frame-coordinator";
import { persistQueuedPageExitRecord } from "../../../page-exit-persist";
import { createResetSessionState } from "../../../session-lifecycle";
import {
  formatPreviewForDisplay,
  resolveLivePreviewText,
} from "../../../runtime/preview";
import {
  buildRolledOverRunningSessionState,
  buildSegmentRolloverNotice,
} from "../../../runtime/segment-rollover";
import {
  DEFAULT_SEGMENT_ROLLOVER_EVENT_QUEUE_MAX,
  drainSegmentEventQueue,
  enqueueBoundedSegmentEvent,
} from "../../../runtime/segment-event-queue";
import {
  buildPreparedSessionRecord as buildPreparedSessionRecordFromState,
  buildPreparedSessionState as buildPreparedSessionStateFromState,
  buildVisibleOutputEntries as buildVisibleOutputEntriesFromEntries,
  buildVisibleSessionRecord as buildVisibleSessionRecordFromState,
} from "../../../runtime/session-records";
import {
  buildSegmentCapacityWarningNotice,
  resolveRuntimeSessionSegmentationReason,
  resolveRuntimeSessionSegmentationThresholds,
  resolveSegmentCapacityWarning,
  type RuntimeSessionSegmentationReason,
} from "../../../runtime/segmentation-policy";
import {
  buildContentStatusSnapshot,
  canClearCurrentSessionState,
} from "../../../runtime/status-snapshot";
import {
  analyzeCaptureCommit,
  resolveRuntimeCaptureNotice,
} from "../../../subtitle-event-handler";
import {
  buildPersistabilityDiagnostics,
  resolvePreviewPersistabilityState,
} from "../../../persistability";
import {
  FALLBACK_COMMIT_OBSERVATION_THRESHOLD,
  FALLBACK_COMMIT_STABLE_MS,
  FRAME_FORWARD_NONCE_RESYNC_INTERVAL_MS,
  INVALIDATED_CONTEXT_NOTICE,
  SUBTITLE_RESET_GRACE_MS,
  injectedScriptId,
  isTopFrame,
  localFramePath,
} from "../constants";
import type { FallbackCommitCandidate, RowDiagnosticsState } from "../types";

import {
  isCapturePage,
  resolveDefaultPanelNotice,
  createObserverBridgeToken,
  cloneObserverBridgeEventForReplay,
  deriveCommitteeName,
} from "./helpers";

let settings: ExtensionSettings = {
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
};
let state: SessionState = createEmptySessionState(
  window.location.href,
  document.title,
);
const popupPorts = new Set<chrome.runtime.Port>();
const diagnosticsPorts = new Set<chrome.runtime.Port>();
let localPollingTimer: number | null = null;
let topFallbackTimer: number | null = null;
let persistTimer: number | null = null;
let pendingRunningPersistSince: number | null = null;
let pendingRunningPersistTrigger: RunningPersistTrigger | null = null;
let pendingResetTimer: number | null = null;
let localLastProbeSignature = "";
let localHadProbeText = false;
let topFallbackMissStreak = 0;
let lastSuccessfulFallbackFramePath: number[] | null = null;
let localPollingUnconfirmedFallbackBlockStreak = 0;
let topFallbackUnconfirmedFallbackBlockStreak = 0;
let panelCollapsed = false;
let previewCollapsed = true;
let panelNotice = resolveDefaultPanelNotice();
let inPagePanel: InPagePanelController | null = null;
let frameForwardNonce = "";
let frameForwardNonceRefreshTimer: number | null = null;
let frameForwardNonceRefreshInFlight = false;
let observerBridgeToken = createObserverBridgeToken();
let lastSubtitleActivationAttemptAt = 0;
let lastNavigationSnapshotAt = 0;
let liveCaptureLedger = createEmptyLiveCaptureLedger();
let extensionContextInvalidated = false;
let failedStoppedSessionGuard = createEmptyFailedStoppedSessionGuard();
let latestPersistabilityState: PersistabilityState = "idle";
let latestRowDiagnostics = createEmptyRowDiagnostics();
let latestFallbackCommitState: FallbackCommitState = "idle";
let segmentRolloverInFlight = false;
let queuedSegmentRolloverEvents: ObserverBridgeEvent[] = [];
let flushingSegmentRolloverEvents = false;
let segmentRolloverToken = 0;
let fallbackCommitCandidate: FallbackCommitCandidate | null = null;
let fallbackCommitTimer: number | null = null;
let fallbackCommitToken = 0;
let capturePipelineStarted = false;
let urlChangePollingTimer: number | null = null;
const captureLifecycleLock = createCaptureLifecycleLock();
const urlReconcileController = createUrlReconcileController(window.location.href);
let lastSegmentCapacityWarningReason: RuntimeSessionSegmentationReason | null = null;
const captureOwnerId = createRandomToken();
let captureOwnershipHeartbeatTimer: number | null = null;

function setPanelNotice(message: string): boolean {
  if (panelNotice === message) {
    return false;
  }
  panelNotice = message;
  return true;
}

function confirmSessionClear(): boolean {
  if (typeof window === "undefined" || typeof window.confirm !== "function") {
    return true;
  }

  return window.confirm("현재 세션 기록을 비우고 다시 시작할까요?");
}

function confirmFailedStoppedSessionDiscard(message: string): boolean {
  if (typeof window === "undefined" || typeof window.confirm !== "function") {
    return false;
  }

  return window.confirm(message);
}

let segmentRolloverEventsDroppedTotal = 0;

function queueSegmentRolloverEvent(event: ObserverBridgeEvent): void {
  const enqueued = enqueueBoundedSegmentEvent(
    queuedSegmentRolloverEvents,
    cloneObserverBridgeEventForReplay(event),
    DEFAULT_SEGMENT_ROLLOVER_EVENT_QUEUE_MAX,
  );
  queuedSegmentRolloverEvents = enqueued.queue;
  if (enqueued.droppedCount > 0) {
    segmentRolloverEventsDroppedTotal += enqueued.droppedCount;
    setPanelNotice(
      `세그먼트 전환 중 이벤트가 많아 ${enqueued.droppedCount}건을 버퍼에서 비웠습니다. (누적 ${segmentRolloverEventsDroppedTotal}건)`,
    );
    logDebug("segment rollover event queue overflow", {
      droppedCount: enqueued.droppedCount,
      totalDropped: segmentRolloverEventsDroppedTotal,
      queueSize: queuedSegmentRolloverEvents.length,
    });
  }
}

function flushQueuedSegmentRolloverEvent(): void {
  if (segmentRolloverInFlight || !queuedSegmentRolloverEvents.length) {
    return;
  }

  flushingSegmentRolloverEvents = true;
  try {
    queuedSegmentRolloverEvents = drainSegmentEventQueue(
      queuedSegmentRolloverEvents,
      (queuedEvent) => {
        handleTopFrameEvent(queuedEvent);
        return !segmentRolloverInFlight;
      },
    );
  } finally {
    flushingSegmentRolloverEvents = false;
  }
}

function clearLocalPolling(): void {
  if (localPollingTimer) {
    window.clearInterval(localPollingTimer);
    localPollingTimer = null;
  }
}

function clearTopFallbackTimer(): void {
  if (topFallbackTimer) {
    window.clearTimeout(topFallbackTimer);
    topFallbackTimer = null;
  }
}

function clearFallbackCommitTimer(): void {
  if (fallbackCommitTimer) {
    window.clearTimeout(fallbackCommitTimer);
    fallbackCommitTimer = null;
  }
}

function clearFallbackCommitCandidate(
  nextState: FallbackCommitState = "idle",
): void {
  clearFallbackCommitTimer();
  fallbackCommitCandidate = null;
  setFallbackCommitState(nextState);
}

function clearFrameForwardNonceRefresh(): void {
  if (frameForwardNonceRefreshTimer) {
    window.clearInterval(frameForwardNonceRefreshTimer);
    frameForwardNonceRefreshTimer = null;
  }
}

function clearUrlChangePolling(): void {
  if (urlChangePollingTimer) {
    window.clearInterval(urlChangePollingTimer);
    urlChangePollingTimer = null;
  }
}

function shutdownForInvalidatedContext(): void {
  if (extensionContextInvalidated) {
    return;
  }

  extensionContextInvalidated = true;
  invalidateExtensionContext();
  clearLocalPolling();
  clearTopFallbackTimer();
  clearFallbackCommitTimer();
  clearFrameForwardNonceRefresh();
  clearUrlChangePolling();
  clearRunningPersistTimer();
  clearCaptureOwnershipHeartbeat();
  void releaseCaptureOwnershipForStop();
  clearPendingReset();
  state.observerActive = false;

  try {
    window.dispatchEvent(new CustomEvent(OBSERVER_STOP_EVENT));
  } catch {
    // no-op
  }
}

function reportRuntimeError(message: string, error?: unknown): void {
  if (markExtensionContextInvalidated(error)) {
    shutdownForInvalidatedContext();
    message = INVALIDATED_CONTEXT_NOTICE;
  }

  console.warn(`[assembly-subtitle] ${message}`, error);
  setPanelNotice(message);
  updateInPagePanel();
  if (!isTopFrame) {
    return;
  }

  popupPorts.forEach((port) => {
    try {
      postToPopupPort(port, {
        type: "ERROR",
        message,
      });
    } catch {
      // Ignore Invalidated context errors on ports
    }
  });
}

function logDebug(message: string, payload?: unknown): void {
  if (!settings.debugLogging) {
    return;
  }
  console.debug("[assembly-subtitle]", message, payload);
}

function getPanelLiveRows(): LivePanelRow[] {
  return resolvePanelLiveRows({
    structuredRows: listLivePanelRows(liveCaptureLedger),
    entries: state.entries,
    captureMode: getCaptureMode(),
    sourceUrl: state.sourceUrl || window.location.href,
  });
}

function getLivePreviewText(): string {
  return resolveLivePreviewText(
    liveCaptureLedger.previewText,
    state.previewText,
  );
}

function getLivePreviewTextForDisplay(): string {
  return formatPreviewForDisplay(getLivePreviewText(), getCaptureMode());
}

function getCaptureMode(): CaptureMode {
  return liveCaptureLedger.captureMode;
}

function setPersistabilityState(stateValue: PersistabilityState): void {
  latestPersistabilityState = stateValue;
}

function createEmptyRowDiagnostics(): RowDiagnosticsState {
  return {
    stableRowCount: 0,
    unstableRowCount: 0,
    filteredUnconfirmedCount: 0,
    rowKeySources: {},
  };
}

function updateRowDiagnostics(
  rows: ObservedSubtitleRow[] = [],
  filteredUnconfirmedCount = 0,
): void {
  const rowKeySources: Partial<Record<RowKeySource, number>> = {};
  rows.forEach((row) => {
    const source =
      row.nodeKeySource ?? (row.unstableKey ? "generated" : "attribute");
    rowKeySources[source] = (rowKeySources[source] ?? 0) + 1;
  });

  latestRowDiagnostics = {
    stableRowCount: rows.filter((row) => !row.unstableKey).length,
    unstableRowCount: rows.filter((row) => row.unstableKey).length,
    filteredUnconfirmedCount,
    rowKeySources,
  };
}

function setFallbackCommitState(stateValue: FallbackCommitState): void {
  latestFallbackCommitState = stateValue;
}

function resolvePreviewPersistability(
  previewText: string,
  now: number,
): PersistabilityState {
  if (!previewText.trim()) {
    return "idle";
  }

  const previewResult = applyPreview(
    cloneState(state),
    previewText,
    now,
    settings,
    {
      selector: state.currentSelector || undefined,
      framePath: state.currentFramePath.length
        ? state.currentFramePath
        : undefined,
    },
  );

  return resolvePreviewPersistabilityState(previewResult.reason);
}

function shouldShowPanelNotice(message: string): boolean {
  return Boolean(message.trim()) && message !== resolveDefaultPanelNotice();
}

function canClearCurrentSession(
  showNotice = shouldShowPanelNotice(panelNotice),
): boolean {
  return canClearCurrentSessionState({
    status: state.status,
    entryCount: state.entries.length,
    livePreviewText: getLivePreviewText(),
    showNotice,
  });
}

function buildStatusSnapshot(
  requiresReload = false,
  includeExportEstimates = false,
): StatusSnapshot {
  const previewTextRaw = getLivePreviewText();
  return buildContentStatusSnapshot({
    currentUrl: window.location.href,
    sessionState: state,
    settings,
    captureMode: getCaptureMode(),
    livePreviewTextRaw: previewTextRaw,
    livePreviewTextForDisplay: formatPreviewForDisplay(
      previewTextRaw,
      getCaptureMode(),
    ),
    latestPersistabilityState,
    rowDiagnostics: latestRowDiagnostics,
    fallbackCommitState: latestFallbackCommitState,
    includeExportEstimates,
    requiresReload,
  });
}

function broadcastPopupState(requiresReload = false): void {
  if (!isTopFrame) {
    return;
  }

  popupPorts.forEach((port) => {
    try {
      const messages = createPopupMessages(
        buildStatusSnapshot(requiresReload, diagnosticsPorts.has(port)),
      );
      messages.forEach((message) => postToPopupPort(port, message));
    } catch {
      // Ignore Invalidated context errors on ports
    }
  });
}

function syncPortState(
  port: chrome.runtime.Port,
  requiresReload = false,
  includeExportEstimates = diagnosticsPorts.has(port),
): void {
  createPopupMessages(
    buildStatusSnapshot(requiresReload, includeExportEstimates),
  ).forEach((message) => postToPopupPort(port, message));
}

function clearRunningPersistTimer(): void {
  persistTimer = clearScheduledRunningPersist(persistTimer, (timerId) =>
    window.clearTimeout(timerId),
  );
  pendingRunningPersistSince = null;
  pendingRunningPersistTrigger = null;
}

function clearCaptureOwnershipHeartbeat(): void {
  if (captureOwnershipHeartbeatTimer !== null) {
    window.clearInterval(captureOwnershipHeartbeatTimer);
    captureOwnershipHeartbeatTimer = null;
  }
}

function startCaptureOwnershipHeartbeat(): void {
  clearCaptureOwnershipHeartbeat();
  if (!isTopFrame || extensionContextInvalidated) {
    return;
  }
  captureOwnershipHeartbeatTimer = window.setInterval(() => {
    if (state.status !== "running" || extensionContextInvalidated) {
      clearCaptureOwnershipHeartbeat();
      return;
    }
    void heartbeatCaptureOwnership({
      storage: getChromeLocalOwnershipStorage(),
      ownerId: captureOwnerId,
      committeeName: state.committeeName,
    });
  }, 8_000);
}

async function claimCaptureOwnershipForStart(): Promise<boolean> {
  if (!isTopFrame) {
    return false;
  }
  const claim = await claimCaptureOwnership({
    storage: getChromeLocalOwnershipStorage(),
    ownerId: captureOwnerId,
    committeeName: state.committeeName,
  });
  startCaptureOwnershipHeartbeat();
  return claim.foreignActive;
}

async function releaseCaptureOwnershipForStop(): Promise<void> {
  clearCaptureOwnershipHeartbeat();
  if (!isTopFrame) {
    return;
  }
  await releaseCaptureOwnership({
    storage: getChromeLocalOwnershipStorage(),
    ownerId: captureOwnerId,
  });
}

async function persistSessionRecord(
  record: SessionRecord,
): Promise<SessionRecord> {
  const response = await sendRuntimeMessage({
    type: "PERSIST_SESSION_RECORD",
    record,
  });
  if (!response.ok) {
    throw new Error(response.error);
  }

  return {
    ...record,
    updatedAt: response.updatedAt ?? record.updatedAt,
  };
}

async function deletePersistedSession(sessionId: string): Promise<void> {
  const response = await sendRuntimeMessage({
    type: "DELETE_SESSION_RECORD",
    sessionId,
  });
  if (!response.ok) {
    throw new Error(response.error);
  }
}

function canPersistCurrentRunningState(): boolean {
  return hasPersistableRunningContent(state);
}

function buildPreparedSessionState(now = Date.now()): SessionState {
  return buildPreparedSessionStateFromState(state, settings, now);
}

function buildVisibleOutputEntries(now = Date.now()) {
  void now;
  return buildVisibleOutputEntriesFromEntries(state.entries);
}

function buildVisibleSessionRecord(
  persistedStatus: "running" | "saved" | "stopped",
  now = Date.now(),
): SessionRecord {
  return buildVisibleSessionRecordFromState(
    state,
    settings,
    persistedStatus,
    getLivePreviewText(),
    now,
  );
}

function buildPreparedSessionRecord(
  persistedStatus: "running" | "saved" | "stopped",
  now = Date.now(),
): SessionRecord {
  return buildPreparedSessionRecordFromState(
    state,
    settings,
    persistedStatus,
    now,
  );
}

function updateInPagePanel(): void {
  if (!isTopFrame || !inPagePanel) {
    return;
  }

  const showNotice = shouldShowPanelNotice(panelNotice);

  inPagePanel.update(
    buildInPagePanelState(buildStatusSnapshot(false), {
      collapsed: panelCollapsed,
      previewCollapsed,
      notice: panelNotice,
      showNotice,
      autoScroll: settings.autoScroll,
      recentCopyLineCount: settings.recentCopyLineCount,
      showSpeakerHighlight: settings.panelSpeakerHighlightEnabled,
      exportSpeakerEnabled: settings.txtExportSpeakerEnabled,
      livePreviewText: getLivePreviewTextForDisplay(),
      liveRows: getPanelLiveRows(),
      canClearSession: canClearCurrentSession(showNotice),
    }),
  );
}

function syncUserInterfaces(requiresReload = false): void {
  updateInPagePanel();
  broadcastPopupState(requiresReload);
}

function clearPendingReset(): void {
  if (pendingResetTimer) {
    window.clearTimeout(pendingResetTimer);
    pendingResetTimer = null;
  }
}

function clearStructuredRuntimeState(): void {
  clearPendingReset();
  clearFallbackCommitCandidate();
  liveCaptureLedger = clearLiveCaptureLedger();
  localLastProbeSignature = "";
  localHadProbeText = false;
  latestRowDiagnostics = createEmptyRowDiagnostics();
}

function scheduleDeferredSubtitleReset(): void {
  if (!isTopFrame || pendingResetTimer || state.status !== "running") {
    return;
  }

  pendingResetTimer = window.setTimeout(() => {
    pendingResetTimer = null;
    if (state.status !== "running") {
      return;
    }

    state = applyReset(state, Date.now(), settings).state;
    setPersistabilityState("idle");
    clearStructuredRuntimeState();
    setPanelNotice(RESET_CAPTURE_NOTICE);
    syncUserInterfaces();
  }, SUBTITLE_RESET_GRACE_MS);
}

function applyPreviewStateOnly(previewText: string, now: number): boolean {
  if (previewText === state.previewText) {
    return false;
  }

  const next = cloneState(state);
  next.previewText = previewText;
  next.lastObservedRaw = previewText;
  next.updatedAt = new Date(now).toISOString();
  next.lastObserverEventAt = now;
  state = next;
  return true;
}

interface StructuredRowsApplyResult {
  changed: boolean;
  committed: boolean;
  sawDuplicate: boolean;
  sawFiltered: boolean;
}

function applyStructuredRowsEvent(
  rows: ObservedSubtitleRow[],
  previewText: string,
  now: number,
  selector?: string,
  framePath?: number[],
): StructuredRowsApplyResult {
  const captureEvent = normalizeCaptureEvent({
    raw: previewText,
    rows,
    selector,
    framePath,
    timestamp: now,
  });
  const reconciliation = reconcileLiveCapture(liveCaptureLedger, captureEvent);
  liveCaptureLedger = reconciliation.ledger;

  let changed =
    reconciliation.changed ||
    applyPreviewStateOnly(captureEvent.previewText, now);
  let committed = false;
  let sawDuplicate = false;
  let sawFiltered = false;

  reconciliation.rowChanges.forEach((rowChange) => {
    let liveRow = getLiveRow(liveCaptureLedger, rowChange.key);
    if (!liveRow) {
      return;
    }

    if (liveRow.baselineCompact === null) {
      liveCaptureLedger = setLiveRowBaseline(
        liveCaptureLedger,
        rowChange.key,
        state.confirmedCompact,
      );
      liveRow = getLiveRow(liveCaptureLedger, rowChange.key);
      if (!liveRow) {
        return;
      }
    }

    const result = commitLiveRow(
      state,
      liveRow.text,
      captureEvent.previewText,
      now,
      settings,
      {
        selector,
        framePath,
        sourceNodeKey: liveRow.key,
        sourceCaptureMode: "structured",
        speakerColor: liveRow.speakerColor || undefined,
        speakerChannel: liveRow.speakerChannel,
        entryId: liveRow.committedEntryId ?? undefined,
        baselineCompact: liveRow.baselineCompact ?? state.confirmedCompact,
      },
    );
    committed =
      committed ||
      Boolean(result.appendedEntry) ||
      result.reason === "row_append" ||
      result.reason === "row_update";
    sawDuplicate =
      sawDuplicate || Boolean(result.reason?.includes("duplicate"));
    sawFiltered = sawFiltered || Boolean(result.reason?.includes("filtered"));

    if (result.changed) {
      state = result.state;
      changed = true;
    }

    if (!liveRow.committedEntryId && result.appendedEntry) {
      liveCaptureLedger = markLiveRowCommitted(
        liveCaptureLedger,
        rowChange.key,
        result.appendedEntry.id,
      );
    }
  });

  return {
    changed,
    committed,
    sawDuplicate,
    sawFiltered,
  };
}

function scheduleFallbackCommitCandidate(
  candidate: FallbackCommitCandidate,
): void {
  clearFallbackCommitTimer();
  const delayMs = Math.max(
    0,
    FALLBACK_COMMIT_STABLE_MS - (Date.now() - candidate.firstSeenAt),
  );
  fallbackCommitTimer = window.setTimeout(() => {
    fallbackCommitTimer = null;
    commitFallbackCandidate(candidate.token, Date.now());
  }, delayMs);
}

function resolveFallbackResultState(reason?: string): FallbackCommitState {
  if (reason?.includes("duplicate")) {
    return "duplicate";
  }
  if (reason?.includes("filtered")) {
    return "filtered";
  }
  return "stable";
}

function commitFallbackCandidate(token: number, now = Date.now()): boolean {
  const candidate = fallbackCommitCandidate;
  if (!candidate || candidate.token !== token || state.status !== "running") {
    return false;
  }

  const result = applyPreview(state, candidate.raw, now, settings, {
    selector: candidate.selector,
    framePath: candidate.framePath,
    sourceCaptureMode: "fallback",
  });
  const committed = Boolean(result.appendedEntry);
  if (result.changed) {
    state = result.state;
  }

  clearFallbackCommitCandidate(
    committed ? "committed" : resolveFallbackResultState(result.reason),
  );
  setPersistabilityState(
    committed
      ? "persistable"
      : resolvePreviewPersistabilityState(result.reason),
  );
  const persistability = buildPersistabilityDiagnostics(
    latestPersistabilityState,
  );
  setPanelNotice(
    resolveRuntimeCaptureNotice({
      captureMode: "fallback",
      observerActive: state.observerActive,
      hasStableRows: false,
      lastCommittedResetAt: state.lastCommittedResetAt,
      now,
      persistabilityState: persistability.state,
      persistabilityHint: persistability.hint,
    }),
  );

  if (committed) {
    const segmentationReason = resolveRuntimeSessionSegmentationReason(
      state,
      now,
      resolveRuntimeSessionSegmentationThresholds(settings),
    );
    if (segmentationReason) {
      lastSegmentCapacityWarningReason = null;
      segmentRolloverInFlight = true;
      if (!flushingSegmentRolloverEvents) {
        queuedSegmentRolloverEvents = [];
      }
      const rolloverToken = ++segmentRolloverToken;
      setPanelNotice(
        "현재 세그먼트를 저장하고 다음 구간으로 전환하고 있습니다.",
      );
      syncUserInterfaces();
      void rollOverRunningSessionSegment(
        segmentationReason,
        now,
        rolloverToken,
      );
      return true;
    }
    maybeEmitSegmentCapacityWarning(now);
    scheduleRunningPersist("commit", now);
  }

  syncUserInterfaces();
  return committed;
}

function observeFallbackCommitCandidate(
  raw: string,
  now: number,
  selector?: string,
  framePath?: number[],
): boolean {
  const normalizedRaw = raw.trim();
  if (!normalizedRaw) {
    clearFallbackCommitCandidate();
    return false;
  }

  if (fallbackCommitCandidate?.raw === normalizedRaw) {
    fallbackCommitCandidate = {
      ...fallbackCommitCandidate,
      selector,
      framePath: framePath ? [...framePath] : undefined,
      lastSeenAt: now,
      observationCount: fallbackCommitCandidate.observationCount + 1,
    };
  } else {
    fallbackCommitCandidate = {
      raw: normalizedRaw,
      selector,
      framePath: framePath ? [...framePath] : undefined,
      firstSeenAt: now,
      lastSeenAt: now,
      observationCount: 1,
      token: ++fallbackCommitToken,
    };
  }

  setFallbackCommitState("pending");

  if (
    fallbackCommitCandidate.observationCount >=
      FALLBACK_COMMIT_OBSERVATION_THRESHOLD ||
    now - fallbackCommitCandidate.firstSeenAt >= FALLBACK_COMMIT_STABLE_MS
  ) {
    return commitFallbackCandidate(fallbackCommitCandidate.token, now);
  }

  scheduleFallbackCommitCandidate(fallbackCommitCandidate);
  return false;
}

function scheduleRunningPersist(
  trigger: RunningPersistTrigger = "commit",
  now = Date.now(),
): void {
  if (extensionContextInvalidated) {
    clearRunningPersistTimer();
    return;
  }

  if (!shouldScheduleRunningPersist(isTopFrame, state, settings)) {
    clearRunningPersistTimer();
    return;
  }

  if (trigger === "commit") {
    if (pendingRunningPersistTrigger !== "commit") {
      pendingRunningPersistSince = now;
    }
    pendingRunningPersistTrigger = "commit";
  } else if (pendingRunningPersistTrigger === null) {
    pendingRunningPersistSince = now;
    pendingRunningPersistTrigger = "keepalive";
  }

  const effectiveTrigger = pendingRunningPersistTrigger ?? trigger;
  const delayMs = resolveRunningPersistDelayMs({
    trigger: effectiveTrigger,
    now,
    pendingSince:
      effectiveTrigger === "commit" ? pendingRunningPersistSince : null,
    lastPersistedAt: state.lastPersistedAt,
    settings,
  });

  if (delayMs === null) {
    if (effectiveTrigger === "keepalive") {
      pendingRunningPersistSince = null;
      pendingRunningPersistTrigger = null;
    }
    return;
  }

  persistTimer = scheduleRunningPersistTimer({
    currentTimer: persistTimer,
    delayMs,
    shouldSchedule: true,
    clearTimer: (timerId) => window.clearTimeout(timerId),
    setTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
    getSnapshot: () => ({
      status: state.status,
      record: buildPreparedSessionRecord("running"),
    }),
    persistRecord: persistSessionRecord,
    onPersisted: (saved) => {
      persistTimer = null;
      pendingRunningPersistSince = null;
      pendingRunningPersistTrigger = null;
      state = applyPersistSuccess(state, saved.updatedAt);
      syncUserInterfaces();
    },
    onError: (error) => {
      persistTimer = null;
      pendingRunningPersistSince = null;
      pendingRunningPersistTrigger = null;
      reportRuntimeError("수집 중 세션 저장에 실패했습니다.", error);
    },
  });
}

async function persistStoppedSession(record: SessionRecord): Promise<void> {
  if (!shouldPersistFinalSession(isTopFrame, record.entries.length)) {
    try {
      await deletePersistedSession(record.id);
      failedStoppedSessionGuard = clearFailedStoppedSessionGuard();
      state.lastPersistedAt = null;
    } catch (error) {
      reportRuntimeError("빈 종료 세션 정리에 실패했습니다.", error);
    }
    return;
  }

  try {
    const saved = await persistSessionRecord(record);
    failedStoppedSessionGuard = clearFailedStoppedSessionGuard();
    state = applyPersistSuccess(state, saved.updatedAt);
    setPanelNotice("모든 자막을 저장했습니다.");
  } catch (error) {
    failedStoppedSessionGuard = rememberFailedStoppedSession(record, error);
    reportRuntimeError("종료된 세션 저장에 실패했습니다.", error);
  }
}

function persistSessionRecordInBackground(
  record: SessionRecord,
  retryAttempt = 0,
  trackPageExitDiagnostics = false,
): void {
  if (extensionContextInvalidated) {
    return;
  }

  const maxRetryAttempts = 1;

  const handlePersistFailure = (message: string, detail?: unknown): void => {
    if (isExtensionContextInvalidatedError(detail)) {
      reportRuntimeError(INVALIDATED_CONTEXT_NOTICE, detail);
      return;
    }

    if (retryAttempt < maxRetryAttempts) {
      persistSessionRecordInBackground(
        record,
        retryAttempt + 1,
        trackPageExitDiagnostics,
      );
      return;
    }

    if (trackPageExitDiagnostics) {
      void recordPageExitPersistAttempt(record, detail ?? message).catch(() => {
        // Preserve the original background persist failure.
      });
    }

    if (document.visibilityState === "visible") {
      reportRuntimeError(message, detail);
      return;
    }

    console.warn(
      "[assembly-subtitle] Background session persist failed",
      message,
      detail,
    );
  };

  try {
    chrome.runtime.sendMessage(
      {
        type: "PERSIST_SESSION_RECORD",
        record,
      },
      (response?: BackgroundCommandResponse) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          handlePersistFailure(
            "백그라운드 세션 저장 요청이 실패했습니다.",
            lastError.message,
          );
          return;
        }

        if (!response?.ok) {
          handlePersistFailure(
            response?.error || "백그라운드 세션 저장에 실패했습니다.",
            response,
          );
          return;
        }

        if (record.status === "running" && state.sessionId === record.id) {
          state = applyPersistSuccess(
            state,
            response.updatedAt ?? record.updatedAt,
          );
          if (document.visibilityState === "visible") {
            syncUserInterfaces();
          }
        }
      },
    );
  } catch (error) {
    handlePersistFailure("백그라운드 세션 저장 전송이 실패했습니다.", error);
  }
}

function queueExitPersistRecordInBackground(record: SessionRecord): void {
  if (extensionContextInvalidated) {
    return;
  }

  try {
    chrome.runtime.sendMessage(
      {
        type: "QUEUE_EXIT_PERSIST_RECORD",
        record,
      },
      (response?: BackgroundCommandResponse) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          console.warn(
            "[assembly-subtitle] Background queued exit persist request failed",
            lastError.message,
          );
          return;
        }

        if (!response?.ok) {
          console.warn(
            "[assembly-subtitle] Background queued exit persist request was rejected",
            response,
          );
        }
      },
    );
  } catch (error) {
    console.warn(
      "[assembly-subtitle] Failed to queue exit persist record in background",
      error,
    );
  }
}

function persistRunningSnapshotForVisibilityChange(
  now = Date.now(),
  options: { respectAutoSaveSetting?: boolean } = {},
): void {
  if (
    extensionContextInvalidated ||
    !isTopFrame ||
    !canPersistCurrentRunningState()
  ) {
    return;
  }

  // Page-exit (pagehide) snapshots must persist regardless of the autosave
  // toggle so the user does not silently lose work when the tab closes.
  // Routine visibility-hidden snapshots, however, should respect the user's
  // autosave preference.
  if (
    options.respectAutoSaveSetting !== false &&
    !settings.runningAutoSaveEnabled
  ) {
    return;
  }

  if (now - lastNavigationSnapshotAt < 250) {
    return;
  }

  clearRunningPersistTimer();
  const record = buildPreparedSessionRecord("running", now);
  if (!record.entries.length) {
    return;
  }

  lastNavigationSnapshotAt = now;
  persistSessionRecordInBackground(record);
}

function persistStoppedSnapshotForPageExit(now = Date.now()): void {
  if (
    extensionContextInvalidated ||
    !isTopFrame ||
    !canPersistCurrentRunningState()
  ) {
    return;
  }

  clearRunningPersistTimer();
  const record = buildPreparedSessionRecord("stopped", now);
  if (!record.entries.length) {
    return;
  }

  void persistQueuedPageExitRecord(record, {
    queueRecord: queueExitPersistRecord,
    queueRecordInBackground: (queuedRecord) => {
      queueExitPersistRecordInBackground(queuedRecord);
    },
    persistRecordInBackground: (queuedRecord) => {
      persistSessionRecordInBackground(queuedRecord, 0, true);
    },
    onPersistAttempt: (queuedRecord) =>
      recordPageExitPersistAttempt(queuedRecord),
    onPersistAttemptError: (error) => {
      console.warn(
        "[assembly-subtitle] Failed to record page-exit persist attempt",
        error,
      );
    },
    onQueueError: (error) => {
      void recordPageExitPersistAttempt(record, error).catch(() => {
        // The original page-exit failure is already logged below.
      });
      console.warn(
        "[assembly-subtitle] Failed to queue exit persist record",
        error,
      );
    },
  });
}

async function saveCurrentSessionSnapshotUnlocked(): Promise<{
  saved: boolean;
  message?: string;
}> {
  if (!isTopFrame || buildVisibleOutputEntries().length === 0) {
    const message = "저장할 자막이 아직 없습니다.";
    setPanelNotice(message);
    return {
      saved: false,
      message,
    };
  }

  const record = buildVisibleSessionRecord("saved");
  if (!record.entries.length) {
    const message = "저장할 자막이 아직 없습니다.";
    setPanelNotice(message);
    return {
      saved: false,
      message,
    };
  }

  try {
    const saved = await persistSessionRecord(record);
    if (failedStoppedSessionGuard.record?.id === saved.id) {
      failedStoppedSessionGuard = clearFailedStoppedSessionGuard();
    }
    state = applyPersistSuccess(state, saved.updatedAt);
    const message = "현재까지 모든 내용을 저장했습니다.";
    setPanelNotice(message);
    return {
      saved: true,
      message,
    };
  } catch (error) {
    if (state.status !== "running") {
      failedStoppedSessionGuard = rememberFailedStoppedSession(record, error);
    }
    reportRuntimeError("세션 저장에 실패했습니다.", error);
    throw error;
  }
}

async function saveCurrentSessionSnapshot(): Promise<{
  saved: boolean;
  message?: string;
}> {
  return captureLifecycleLock.run("save", () => saveCurrentSessionSnapshotUnlocked());
}

async function saveAndStartNewSession(): Promise<void> {
  return captureLifecycleLock.run("save_and_new", async () => {
  if (state.status !== "running") {
    setPanelNotice("수집 중일 때만 중간 저장 후 새 세션을 시작할 수 있습니다.");
    syncUserInterfaces();
    return;
  }

  const result = await saveCurrentSessionSnapshotUnlocked();
  if (!result.saved) {
    syncUserInterfaces();
    return;
  }

  resetRuntimeState();
  lastSegmentCapacityWarningReason = null;
  clearAutoStartCooldown(isTopFrame);
  const now = new Date().toISOString();
  state.status = "running";
  state.createdAt = now;
  state.startedAt = now;
  state.updatedAt = now;
  state.title = document.title;
  state.committeeName = deriveCommitteeName(document.title);
  setPanelNotice("중간 저장을 마치고 새 세션으로 계속 수집합니다.");
  dispatchObserverConfig();
  syncUserInterfaces();
  });
}

function maybeEmitSegmentCapacityWarning(now = Date.now()): void {
  const warning = resolveSegmentCapacityWarning(
    state,
    now,
    resolveRuntimeSessionSegmentationThresholds(settings),
  );
  if (!warning) {
    if (lastSegmentCapacityWarningReason) {
      lastSegmentCapacityWarningReason = null;
    }
    return;
  }
  if (lastSegmentCapacityWarningReason === warning) {
    return;
  }
  lastSegmentCapacityWarningReason = warning;
  setPanelNotice(buildSegmentCapacityWarningNotice(warning));
}

async function highlightLatestCommittedEntry(): Promise<void> {
  const latestEntry = state.entries[state.entries.length - 1];
  if (!latestEntry) {
    setPanelNotice("중요 표시할 확정 자막이 아직 없습니다.");
    syncUserInterfaces();
    return;
  }

  if (latestEntry.highlighted) {
    setPanelNotice("최신 확정 자막은 이미 중요 표시되어 있습니다.");
    syncUserInterfaces();
    return;
  }

  const now = new Date().toISOString();
  state = {
    ...state,
    updatedAt: now,
    entries: state.entries.map((entry) =>
      entry.id === latestEntry.id
        ? { ...cloneEntry(entry), highlighted: true }
        : entry,
    ),
  };
  setPanelNotice("최신 확정 자막을 중요 표시했습니다.");

  if (state.status === "running") {
    scheduleRunningPersist();
    syncUserInterfaces();
    return;
  }

  try {
    const saved = await persistSessionRecord(
      buildVisibleSessionRecord("stopped"),
    );
    state = applyPersistSuccess(state, saved.updatedAt);
  } catch (error) {
    reportRuntimeError("중요 표시 저장에 실패했습니다.", error);
  }
  syncUserInterfaces();
}

async function refreshFrameForwardNonce(): Promise<void> {
  const response = await sendRuntimeMessage({
    type: "GET_FRAME_FORWARD_NONCE",
  });
  if (!response.ok || !response.nonce) {
    throw new Error(
      response.ok ? "프레임 전달 토큰을 받지 못했습니다." : response.error,
    );
  }
  frameForwardNonce = response.nonce;
}

function requestFrameForwardNonceResync(quiet = true): void {
  if (extensionContextInvalidated || frameForwardNonceRefreshInFlight) {
    return;
  }

  frameForwardNonceRefreshInFlight = true;
  void refreshFrameForwardNonce()
    .catch((error: unknown) => {
      if (isExtensionContextInvalidatedError(error)) {
        reportRuntimeError(INVALIDATED_CONTEXT_NOTICE, error);
        return;
      }

      if (!quiet) {
        reportRuntimeError(
          "프레임 전달 보안 토큰을 다시 확인하지 못했습니다.",
          error,
        );
      } else {
        logDebug("frame forward nonce resync failed", error);
      }
    })
    .finally(() => {
      frameForwardNonceRefreshInFlight = false;
    });
}

function startFrameForwardNonceRefresh(): void {
  clearFrameForwardNonceRefresh();
  if (extensionContextInvalidated) {
    return;
  }

  frameForwardNonceRefreshTimer = window.setInterval(() => {
    requestFrameForwardNonceResync(true);
  }, FRAME_FORWARD_NONCE_RESYNC_INTERVAL_MS);
}

function triggerImmediateTopFallbackProbe(): void {
  if (!isTopFrame || extensionContextInvalidated) {
    return;
  }

  topFallbackMissStreak = Math.max(topFallbackMissStreak, 1);
  scheduleTopFrameFallbackTick(0);
}

function dispatchObserverConfig(): void {
  if (extensionContextInvalidated || !isCapturePage()) {
    return;
  }

  if (!observerBridgeToken) {
    observerBridgeToken = createObserverBridgeToken();
  }

  window.dispatchEvent(
    new CustomEvent(OBSERVER_CONFIG_EVENT, {
      detail: {
        selectors: SUBTITLE_SELECTOR_CANDIDATES,
        pollingIntervalMs: settings.pollingFallbackIntervalMs,
        filterUnconfirmedEnabled: settings.filterUnconfirmedEnabled,
        token: observerBridgeToken,
      },
    }),
  );
}

function requestSubtitleLayerActivation(): void {
  lastSubtitleActivationAttemptAt = Date.now();
  tryDomSubtitleActivation();
  window.dispatchEvent(new CustomEvent(OBSERVER_ACTIVATE_EVENT));
}

async function ensureSubtitleLayerActive(): Promise<boolean> {
  requestSubtitleLayerActivation();
  const layer = await waitForSubtitleLayer({
    timeoutMs: Math.max(1200, settings.pollingFallbackIntervalMs * 10),
    intervalMs: Math.max(80, settings.pollingFallbackIntervalMs),
  });
  return layer.visible && (layer.hasText || layer.controlActive);
}

async function injectObserverScript(): Promise<void> {
  if (document.getElementById(injectedScriptId)) {
    dispatchObserverConfig();
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.id = injectedScriptId;
    script.src = chrome.runtime.getURL("injected-observer.js");
    script.async = false;
    script.onload = () => {
      dispatchObserverConfig();
      resolve();
    };
    script.onerror = () =>
      reject(new Error("Failed to inject observer bridge"));
    (document.head || document.documentElement).appendChild(script);
  });
}

function forwardToTop(event: ObserverBridgeEvent): void {
  forwardFrameEvent(event, {
    isTopFrame,
    frameForwardNonce,
    handleTopFrameEvent,
  });
}

function handleTopFrameEvent(event: ObserverBridgeEvent): void {
  if (!isTopFrame) {
    return;
  }

  try {
    state.observerActive = Boolean(event.observerActive);
    if (event.selector) {
      state.currentSelector = event.selector;
    }
    if (event.framePath) {
      state.currentFramePath = [...event.framePath];
    }

    const now = event.timestamp || Date.now();
    if (event.kind === "subtitle:health") {
      state.lastObserverEventAt = now;
      // SPA-like in-page navigation can change the URL/title without
      // re-bootstrapping the content script. Refresh the cached source
      // metadata on health pings so saved snapshots reflect the current
      // page even if no subtitle:update has arrived yet.
      if (typeof event.sourceUrl === "string" && event.sourceUrl) {
        state.sourceUrl = event.sourceUrl;
      }
      const currentTitle = document.title;
      if (currentTitle && currentTitle !== state.title) {
        state.title = currentTitle;
        state.committeeName = deriveCommitteeName(currentTitle);
      }
      return;
    }

    if (state.status !== "running") {
      return;
    }

    if (segmentRolloverInFlight) {
      queueSegmentRolloverEvent(event);
      return;
    }

    if (event.kind === "subtitle:reset") {
      scheduleDeferredSubtitleReset();
      return;
    }

    clearPendingReset();
    const captureEvent = normalizeCaptureEvent({
      raw: event.raw,
      rows: event.rows,
      selector: event.selector,
      framePath: event.framePath,
      timestamp: now,
    });
    if (!captureEvent.previewText) {
      setPersistabilityState("idle");
      return;
    }

    const captureCommit = analyzeCaptureCommit(captureEvent);
    updateRowDiagnostics(
      captureEvent.rows,
      event.filteredUnconfirmedCount ?? 0,
    );

    if (captureCommit.shouldCommit) {
      clearFallbackCommitCandidate();
      localPollingUnconfirmedFallbackBlockStreak = 0;
      topFallbackUnconfirmedFallbackBlockStreak = 0;
      const structuredResult = applyStructuredRowsEvent(
        captureCommit.stableRows,
        captureCommit.previewText,
        now,
        event.selector,
        event.framePath,
      );
      const persistabilityState = structuredResult.committed
        ? "persistable"
        : captureCommit.hasUnstableRows && captureCommit.stableRows.length === 0
          ? "unstable_only"
          : structuredResult.sawFiltered
            ? "filtered"
            : structuredResult.sawDuplicate
              ? "duplicate"
              : "preview_only";
      setPersistabilityState(persistabilityState);
      const persistability =
        buildPersistabilityDiagnostics(persistabilityState);
      const noticeChanged = setPanelNotice(
        resolveRuntimeCaptureNotice({
          captureMode: captureEvent.captureMode,
          observerActive: state.observerActive,
          hasStableRows: captureCommit.shouldCommit,
          lastCommittedResetAt: state.lastCommittedResetAt,
          now,
          persistabilityState: persistability.state,
          persistabilityHint: persistability.hint,
        }),
      );
      if (
        !structuredResult.changed &&
        captureEvent.previewText === state.lastObservedRaw &&
        (!state.lastKeepaliveAt ||
          now - state.lastKeepaliveAt >= settings.keepaliveIntervalMs)
      ) {
        state = applyKeepalive(state, now).state;
        scheduleRunningPersist("keepalive", now);
        syncUserInterfaces();
        return;
      }
      if (structuredResult.committed) {
        const segmentationReason = resolveRuntimeSessionSegmentationReason(
          state,
          now,
          resolveRuntimeSessionSegmentationThresholds(settings),
        );
        if (segmentationReason) {
          lastSegmentCapacityWarningReason = null;
          segmentRolloverInFlight = true;
          if (!flushingSegmentRolloverEvents) {
            queuedSegmentRolloverEvents = [];
          }
          const rolloverToken = ++segmentRolloverToken;
          setPanelNotice(
            "현재 세그먼트를 저장하고 다음 구간으로 전환하고 있습니다.",
          );
          syncUserInterfaces();
          void rollOverRunningSessionSegment(
            segmentationReason,
            now,
            rolloverToken,
          );
          return;
        }
        maybeEmitSegmentCapacityWarning(now);
        scheduleRunningPersist("commit", now);
      }
      if (structuredResult.changed || noticeChanged) {
        syncUserInterfaces();
      }
      return;
    }

    const persistabilityState =
      captureCommit.hasUnstableRows && captureCommit.stableRows.length === 0
        ? "unstable_only"
        : resolvePreviewPersistability(captureEvent.previewText, now);
    setPersistabilityState(persistabilityState);
    const persistability = buildPersistabilityDiagnostics(persistabilityState);
    const noticeChanged = setPanelNotice(
      resolveRuntimeCaptureNotice({
        captureMode: captureEvent.captureMode,
        observerActive: state.observerActive,
        hasStableRows: captureCommit.shouldCommit,
        lastCommittedResetAt: state.lastCommittedResetAt,
        now,
        persistabilityState: persistability.state,
        persistabilityHint: persistability.hint,
        unconfirmedFallbackBlockStreak: Math.max(
          localPollingUnconfirmedFallbackBlockStreak,
          topFallbackUnconfirmedFallbackBlockStreak,
        ),
      }),
    );

    const fallbackReconciliation = reconcileLiveCapture(liveCaptureLedger, {
      ...captureEvent,
      rows: [],
      captureMode: "fallback",
    });
    liveCaptureLedger = fallbackReconciliation.ledger;
    const normalized = captureEvent.previewText;
    if (!normalized) {
      return;
    }

    if (
      normalized === state.lastObservedRaw &&
      (!state.lastKeepaliveAt ||
        now - state.lastKeepaliveAt >= settings.keepaliveIntervalMs)
    ) {
      state = applyKeepalive(state, now).state;
      scheduleRunningPersist("keepalive", now);
      syncUserInterfaces();
      return;
    }

    const previewChanged = applyPreviewStateOnly(normalized, now);
    const fallbackCommitted = observeFallbackCommitCandidate(
      normalized,
      now,
      event.selector,
      event.framePath,
    );
    if (fallbackReconciliation.changed || previewChanged || noticeChanged) {
      syncUserInterfaces();
    }
    if (fallbackCommitted) {
      return;
    }
  } catch (error) {
    reportRuntimeError("자막 파이프라인 처리 중 오류가 발생했습니다.", error);
  }
}

function emitLocalProbeEvent(
  kind: "subtitle:update" | "subtitle:reset",
  raw?: string,
  selector?: string,
  rows?: ObservedSubtitleRow[],
  filteredUnconfirmedCount = 0,
): void {
  forwardToTop({
    source: OBSERVER_BRIDGE_SOURCE,
    token: observerBridgeToken,
    kind,
    raw,
    rows,
    selector,
    framePath: localFramePath,
    timestamp: Date.now(),
    sourceUrl: window.location.href,
    observerActive: false,
    filteredUnconfirmedCount,
  });
}

function startLocalPolling(): void {
  if (extensionContextInvalidated || !isCapturePage()) {
    clearLocalPolling();
    return;
  }

  clearLocalPolling();
  localPollingTimer = window.setInterval(() => {
    try {
      const allowUnconfirmedContainerFallback =
        shouldAllowUnconfirmedContainerFallback(
          localPollingUnconfirmedFallbackBlockStreak,
        );
      const probe = estimateRecentRaw(document, state.currentSelector, {
        filterUnconfirmedEnabled: settings.filterUnconfirmedEnabled,
        allowUnconfirmedContainerFallback,
        sourceUrl: window.location.href,
      });
      localPollingUnconfirmedFallbackBlockStreak =
        updateUnconfirmedFallbackBlockStreak(
          localPollingUnconfirmedFallbackBlockStreak,
          probe,
        );
      if (!probe.found || !probe.text) {
        if (probe.blockedByUnconfirmedFilter) {
          updateRowDiagnostics([], probe.filteredUnconfirmedCount ?? 0);
          setPersistabilityState("filtered");
          setPanelNotice(buildPersistabilityDiagnostics("filtered").hint);
          syncUserInterfaces();
        }
        if (localHadProbeText) {
          localHadProbeText = false;
          localLastProbeSignature = "";
          emitLocalProbeEvent(
            "subtitle:reset",
            undefined,
            undefined,
            undefined,
            probe.filteredUnconfirmedCount,
          );
        }
        return;
      }

      const decision = shouldEmitLocalProbeUpdate(
        localLastProbeSignature,
        probe,
      );
      if (!decision.shouldEmit) {
        return;
      }

      localHadProbeText = true;
      localLastProbeSignature = decision.signature;
      emitLocalProbeEvent(
        "subtitle:update",
        probe.text,
        probe.matchedSelector,
        probe.rows,
        probe.filteredUnconfirmedCount,
      );
    } catch (error) {
      reportRuntimeError("로컬 자막 감지 중 오류가 발생했습니다.", error);
    }
  }, settings.pollingFallbackIntervalMs);
}

function scheduleTopFrameFallbackTick(delayMs: number): void {
  if (!isTopFrame || extensionContextInvalidated) {
    return;
  }

  clearTopFallbackTimer();
  topFallbackTimer = window.setTimeout(() => {
    topFallbackTimer = null;
    runTopFrameFallbackTick();
  }, delayMs);
}

function runTopFrameFallbackTick(): void {
  if (!isTopFrame || extensionContextInvalidated) {
    clearTopFallbackTimer();
    return;
  }

  if (state.status !== "running") {
    topFallbackMissStreak = 0;
    scheduleTopFrameFallbackTick(
      resolveTopFallbackDelayMs(
        topFallbackMissStreak,
        settings.pollingFallbackIntervalMs,
      ),
    );
    return;
  }

  const now = Date.now();
  const staleFor = state.lastObserverEventAt
    ? now - state.lastObserverEventAt
    : Number.MAX_SAFE_INTEGER;
  if (staleFor < settings.pollingFallbackIntervalMs * 2) {
    topFallbackMissStreak = 0;
    scheduleTopFrameFallbackTick(
      resolveTopFallbackDelayMs(
        topFallbackMissStreak,
        settings.pollingFallbackIntervalMs,
      ),
    );
    return;
  }

  try {
    const allowUnconfirmedContainerFallback =
      shouldAllowUnconfirmedContainerFallback(
        topFallbackUnconfirmedFallbackBlockStreak,
      );
    const probeOptions = {
      filterUnconfirmedEnabled: settings.filterUnconfirmedEnabled,
      allowUnconfirmedContainerFallback,
      sourceUrl: window.location.href,
    };
    const cachedFramePath = lastSuccessfulFallbackFramePath;
    const cachedProbe =
      cachedFramePath && cachedFramePath.length
        ? probeFramePath(cachedFramePath, state.currentSelector, probeOptions)
        : null;
    const probe =
      cachedProbe && cachedProbe.found && cachedProbe.text
        ? cachedProbe
        : probeBestAccessibleSubtitle(state.currentSelector, probeOptions);
    topFallbackUnconfirmedFallbackBlockStreak =
      updateUnconfirmedFallbackBlockStreak(
        topFallbackUnconfirmedFallbackBlockStreak,
        probe,
      );
    if (!probe.found || !probe.text) {
      if (probe.blockedByUnconfirmedFilter) {
        updateRowDiagnostics([], probe.filteredUnconfirmedCount ?? 0);
        setPersistabilityState("filtered");
        setPanelNotice(buildPersistabilityDiagnostics("filtered").hint);
        syncUserInterfaces();
      }
      topFallbackMissStreak += 1;
      if (now - lastSubtitleActivationAttemptAt >= 2000) {
        requestSubtitleLayerActivation();
      }
      scheduleTopFrameFallbackTick(
        resolveTopFallbackDelayMs(
          topFallbackMissStreak,
          settings.pollingFallbackIntervalMs,
        ),
      );
      return;
    }

    topFallbackMissStreak = 0;
    lastSuccessfulFallbackFramePath = [...probe.framePath];

    handleTopFrameEvent({
      source: OBSERVER_BRIDGE_SOURCE,
      kind: "subtitle:update",
      raw: probe.text,
      rows: probe.rows,
      selector: probe.matchedSelector,
      framePath: probe.framePath,
      timestamp: now,
      sourceUrl: window.location.href,
      observerActive: false,
      filteredUnconfirmedCount: probe.filteredUnconfirmedCount,
    });
  } catch (error) {
    topFallbackMissStreak += 1;
    reportRuntimeError(
      "프레임 자막 fallback 탐색 중 오류가 발생했습니다.",
      error,
    );
  }

  scheduleTopFrameFallbackTick(
    resolveTopFallbackDelayMs(
      topFallbackMissStreak,
      settings.pollingFallbackIntervalMs,
    ),
  );
}

function startTopFrameFallback(): void {
  if (!isTopFrame || extensionContextInvalidated || !isCapturePage()) {
    clearTopFallbackTimer();
    return;
  }

  topFallbackMissStreak = 0;
  scheduleTopFrameFallbackTick(
    resolveTopFallbackDelayMs(
      topFallbackMissStreak,
      settings.pollingFallbackIntervalMs,
    ),
  );
}

function stopCapturePipelineForCurrentPage(): void {
  clearLocalPolling();
  clearTopFallbackTimer();
  clearFallbackCommitCandidate();
  capturePipelineStarted = false;
  try {
    window.dispatchEvent(new CustomEvent(OBSERVER_STOP_EVENT));
  } catch {
    // no-op
  }
}

async function startCapturePipelineForCurrentPage(): Promise<void> {
  if (extensionContextInvalidated || !isCapturePage()) {
    stopCapturePipelineForCurrentPage();
    return;
  }

  if (!capturePipelineStarted) {
    try {
      await injectObserverScript();
    } catch (error) {
      reportRuntimeError(
        "MutationObserver 주입에 실패해 polling fallback으로 계속 진행합니다.",
        error,
      );
    }
    capturePipelineStarted = true;
  } else {
    dispatchObserverConfig();
  }

  if (extensionContextInvalidated) {
    return;
  }

  startLocalPolling();
  startTopFrameFallback();
  syncUserInterfaces();

  if (
    isTopFrame &&
    settings.autoStartEnabled &&
    !hasAutoStartCooldown(isTopFrame) &&
    state.status !== "running"
  ) {
    // reconcile 등 상위 lifecycle lock 안에서도 호출될 수 있다.
    // unlocked 직접 호출은 await 양보 구간에서 stop/clear와 인터리브되므로,
    // 동일 큐에 "start"를 예약만 하고 await 하지 않는다(중첩 deadlock 방지).
    void captureLifecycleLock.run("start", () => startCaptureUnlocked()).catch(
      (error: unknown) => {
        reportRuntimeError(
          "자동 시작 설정에 따라 자막 모으기를 시도했으나 실패했습니다.",
          error,
        );
      },
    );
  }
}

/**
 * URL 전환 reconcile 본체.
 * 성공 시에만 urlReconcileController 가 lastKnownUrl 을 커밋한다.
 * stop/start 는 unlocked 경로를 사용해 lifecycle lock 중첩 deadlock 을 피한다.
 */
async function performUrlReconcile(currentUrl: string): Promise<void> {
  const previousUrl = urlReconcileController.getLastKnownUrl();
  const urlChanged = currentUrl !== previousUrl;
  if (!urlChanged && capturePipelineStarted === isCapturePage()) {
    return;
  }

  if (urlChanged && state.status === "running") {
    try {
      await stopCaptureUnlocked();
    } catch (error) {
      reportRuntimeError(
        "페이지 이동 전 실행 중인 세션 저장에 실패했습니다.",
        error,
      );
      throw error instanceof Error
        ? error
        : new Error("페이지 이동 전 세션 저장에 실패했습니다.");
    }
  }

  if (urlChanged && state.status !== "running") {
    resetRuntimeState();
  }

  setPanelNotice(resolveDefaultPanelNotice());
  if (!isCapturePage()) {
    stopCapturePipelineForCurrentPage();
    syncUserInterfaces();
    logDebug("capture pipeline stopped after URL change", {
      previousUrl,
      currentUrl,
    });
    return;
  }

  await startCapturePipelineForCurrentPage();
}

function resetRuntimeState(): void {
  clearRunningPersistTimer();
  clearStructuredRuntimeState();
  segmentRolloverToken += 1;
  queuedSegmentRolloverEvents = [];
  segmentRolloverInFlight = false;
  setPersistabilityState("idle");
  state = createResetSessionState(
    window.location.href,
    document.title,
    deriveCommitteeName(document.title),
  );
  topFallbackMissStreak = 0;
  localPollingUnconfirmedFallbackBlockStreak = 0;
  topFallbackUnconfirmedFallbackBlockStreak = 0;
  lastSuccessfulFallbackFramePath = null;
  lastSubtitleActivationAttemptAt = 0;
  lastNavigationSnapshotAt = 0;
  setPanelNotice(resolveDefaultPanelNotice());
}

async function ensureFailedStoppedSessionResolved(
  actionLabel: string,
): Promise<boolean> {
  const resolution = await resolveFailedStoppedSessionGuard({
    actionLabel,
    guard: failedStoppedSessionGuard,
    persistRecord: persistSessionRecord,
    confirmDiscard: confirmFailedStoppedSessionDiscard,
  });

  failedStoppedSessionGuard = resolution.guard;

  if (
    resolution.persistedRecord &&
    state.sessionId === resolution.persistedRecord.id
  ) {
    state = applyPersistSuccess(state, resolution.persistedRecord.updatedAt);
  }

  if (resolution.notice) {
    setPanelNotice(resolution.notice);
    syncUserInterfaces();
  }

  return resolution.proceed;
}

async function ensureCurrentRunningSessionPreservedBeforeReset(): Promise<boolean> {
  if (!isTopFrame || state.status !== "running") {
    return true;
  }

  const sessionId = state.sessionId;
  const stoppedRecord = buildPreparedSessionRecord("stopped");
  if (stoppedRecord.entries.length > 0) {
    try {
      const saved = await persistSessionRecord(stoppedRecord);
      state = applyPersistSuccess(state, saved.updatedAt);
      return true;
    } catch (error) {
      failedStoppedSessionGuard = rememberFailedStoppedSession(
        stoppedRecord,
        error,
      );
      reportRuntimeError(
        "세션 초기화 전에 이전 실행 세션 저장에 실패했습니다.",
        error,
      );
      return false;
    }
  }

  try {
    await deletePersistedSession(sessionId);
    return true;
  } catch (error) {
    reportRuntimeError(
      "세션 초기화 전에 이전 실행 세션 정리에 실패했습니다.",
      error,
    );
    return false;
  }
}

async function clearSessionAndResetUnlocked(): Promise<void> {
  if (!(await ensureFailedStoppedSessionResolved("clear session"))) {
    return;
  }
  if (!(await ensureCurrentRunningSessionPreservedBeforeReset())) {
    return;
  }
  resetRuntimeState();
  lastSegmentCapacityWarningReason = null;
  rememberAutoStartCooldown(isTopFrame);
  setPanelNotice("화면을 비우고 새로 시작할 준비를 마쳤습니다.");
  syncUserInterfaces();
}

async function clearSessionAndReset(): Promise<void> {
  return captureLifecycleLock.run("clear", () => clearSessionAndResetUnlocked());
}

async function startCaptureUnlocked(): Promise<void> {
  if (!isCapturePage()) {
    setPanelNotice(
      "국회 의사중계 플레이어 페이지에서만 자막 수집을 시작할 수 있습니다.",
    );
    syncUserInterfaces();
    return;
  }
  if (shouldIgnoreStartCapture(state.status)) {
    setPanelNotice(DUPLICATE_START_CAPTURE_NOTICE);
    syncUserInterfaces();
    return;
  }
  if (!(await ensureFailedStoppedSessionResolved("자막 수집 시작"))) {
    return;
  }
  if (!(await ensureCurrentRunningSessionPreservedBeforeReset())) {
    return;
  }
  resetRuntimeState();
  lastSegmentCapacityWarningReason = null;
  clearAutoStartCooldown(isTopFrame);
  const now = new Date().toISOString();
  panelCollapsed = false;
  state.status = "running";
  state.createdAt = now;
  state.startedAt = now;
  state.updatedAt = now;
  state.title = document.title;
  state.committeeName = deriveCommitteeName(document.title);
  const multiTabCaptureWarning = await claimCaptureOwnershipForStart();
  const startNotice = multiTabCaptureWarning
    ? "자막 모으기를 시작했습니다. 다른 탭에서도 수집 중일 수 있어 기록이 둘로 나뉠 수 있습니다."
    : "자막 모으기를 시작했습니다. 페이지를 이동하거나 닫으려고 하면 수집을 중단하고, 종료 직전에 자동 저장을 시도합니다.";
  setPanelNotice(startNotice);
  dispatchObserverConfig();
  syncUserInterfaces();

  const subtitleLayerReady = await ensureSubtitleLayerActive().catch(
    (error: unknown) => {
      reportRuntimeError("AI 자막 레이어를 자동으로 열지 못했습니다.", error);
      return false;
    },
  );
  if (!subtitleLayerReady) {
    setPanelNotice(
      multiTabCaptureWarning
        ? "자막 모으기를 시작했습니다. 다른 탭 수집 가능 — 페이지에서 'AI 자막보기'를 한 번 눌러주세요."
        : "자막 모으기를 시작했습니다. 페이지에서 'AI 자막보기'를 한 번 눌러주세요.",
    );
  }

  syncUserInterfaces();
}

async function startCapture(): Promise<void> {
  return captureLifecycleLock.run("start", () => startCaptureUnlocked());
}

async function stopCaptureUnlocked(): Promise<void> {
  segmentRolloverToken += 1;
  segmentRolloverInFlight = false;
  queuedSegmentRolloverEvents = [];
  clearRunningPersistTimer();
  clearPendingReset();
  lastSegmentCapacityWarningReason = null;
  const now = Date.now();
  const stoppedRecord = buildPreparedSessionRecord("stopped", now);
  state = finalizeSession(state, now, settings).state;
  setPanelNotice("자막 모으기를 멈췄습니다.");
  rememberAutoStartCooldown(isTopFrame);
  await releaseCaptureOwnershipForStop();
  await persistStoppedSession(stoppedRecord);
  syncUserInterfaces();
}

async function stopCapture(): Promise<void> {
  return captureLifecycleLock.run("stop", () => stopCaptureUnlocked());
}

async function rollOverRunningSessionSegment(
  reason: RuntimeSessionSegmentationReason,
  now = Date.now(),
  token = segmentRolloverToken,
): Promise<void> {
  if (!isTopFrame || state.status !== "running" || !state.entries.length) {
    if (token === segmentRolloverToken) {
      segmentRolloverInFlight = false;
      flushQueuedSegmentRolloverEvent();
    }
    return;
  }

  const savedRecord = buildPreparedSessionRecord("saved", now);
  if (!savedRecord.entries.length) {
    if (token === segmentRolloverToken) {
      segmentRolloverInFlight = false;
      flushQueuedSegmentRolloverEvent();
    }
    return;
  }

  clearRunningPersistTimer();
  const nowIso = new Date(now).toISOString();

  try {
    await persistSessionRecord(savedRecord);
    if (token !== segmentRolloverToken || state.status !== "running") {
      return;
    }
    liveCaptureLedger = resetLiveCaptureLedgerForNewSegment(
      liveCaptureLedger,
      state.confirmedCompact,
    );
    state = buildRolledOverRunningSessionState(state, {
      sourceUrl: window.location.href,
      title: document.title,
      committeeName: deriveCommitteeName(document.title),
      nowIso,
    });
    setPersistabilityState(
      getLivePreviewText().trim() ? "preview_only" : "idle",
    );
    setPanelNotice(buildSegmentRolloverNotice(state.segmentNumber, reason));
    syncUserInterfaces();
  } catch (error) {
    if (token === segmentRolloverToken) {
      scheduleRunningPersist("commit", now);
      reportRuntimeError("세션 자동 분할 저장에 실패했습니다.", error);
    }
  } finally {
    if (token === segmentRolloverToken) {
      segmentRolloverInFlight = false;
      flushQueuedSegmentRolloverEvent();
    }
  }
}

async function exportCurrentSession(format: ExportFormat): Promise<void> {
  return captureLifecycleLock.run("export", () => exportCurrentSessionUnlocked(format));
}

async function exportCurrentSessionUnlocked(format: ExportFormat): Promise<void> {
  const record = buildVisibleSessionRecord(
    state.status === "running" ? "running" : "stopped",
  );
  if (!record.entries.length) {
    setPanelNotice("먼저 자막을 모은 뒤 파일로 저장하세요.");
    syncUserInterfaces();
    return;
  }

  const saved = await persistSessionRecord(record);
  state = applyPersistSuccess(state, saved.updatedAt);
  const response = await sendRuntimeMessage({
    type: "DOWNLOAD_SESSION_EXPORT",
    sessionId: record.id,
    format,
    filenamePattern: settings.filenamePattern,
    txtExportTimestampsEnabled: settings.txtExportTimestampsEnabled,
    txtExportSpeakerEnabled: settings.txtExportSpeakerEnabled,
    txtExportEntryNotesEnabled: settings.txtExportEntryNotesEnabled,
  });
  if (!response.ok) {
    throw new Error(
      mapDownloadErrorMessage(response.error, "single-session") ||
        "파일 저장을 시작하지 못했습니다.",
    );
  }
  setPanelNotice(`${format.toUpperCase()} 파일 저장 창을 열었습니다.`);
  syncUserInterfaces();
}

async function copyRecentSessionLines(): Promise<void> {
  const prepared = buildPreparedSessionState();
  // 실시간 세션에는 speakerLabels 맵이 없으므로 entry channel/label 만 사용
  const copyOptions = {
    limit: settings.recentCopyLineCount,
    includeSpeaker: settings.txtExportSpeakerEnabled,
  };
  const copiedEntries = selectCopyEntries(prepared.entries, copyOptions);
  const copyText = buildCopyText(prepared.entries, copyOptions);

  if (!copyText) {
    setPanelNotice("복사할 자막이 아직 없습니다.");
    syncUserInterfaces();
    return;
  }

  await copyTextToClipboard(copyText);
  setPanelNotice(`최근 ${copiedEntries.length}줄을 복사했습니다.`);
  syncUserInterfaces();
}

async function openHistoryPage(): Promise<void> {
  const response = await sendRuntimeMessage({ type: "OPEN_HISTORY_PAGE" });
  if (!response.ok) {
    throw new Error(response.error);
  }
  setPanelNotice("저장된 기록 화면을 열었습니다.");
  syncUserInterfaces();
}

async function openOptionsPage(): Promise<void> {
  const response = await sendRuntimeMessage({ type: "OPEN_OPTIONS_PAGE" });
  if (!response.ok) {
    throw new Error(response.error);
  }
  setPanelNotice("환경 설정 화면을 열었습니다.");
  syncUserInterfaces();
}

async function openDiagnosticsPage(): Promise<void> {
  const response = await sendRuntimeMessage({ type: "OPEN_DIAGNOSTICS_PAGE" });
  if (!response.ok) {
    throw new Error(response.error);
  }
  setPanelNotice("상태 확인 화면을 열었습니다.");
  syncUserInterfaces();
}

function openInPagePanel(): {
  command: "OPEN_INPAGE_PANEL";
  message: string;
  panelOpened: boolean;
} {
  const panelOpened = panelCollapsed;
  panelCollapsed = false;
  const message = panelOpened
    ? "페이지 오른쪽 패널을 열었습니다."
    : "페이지 오른쪽 패널이 이미 열려 있습니다.";
  setPanelNotice(message);
  syncUserInterfaces();
  return {
    command: "OPEN_INPAGE_PANEL",
    message,
    panelOpened,
  };
}

function collapseInPagePanel(): void {
  panelCollapsed = true;
  setPanelNotice("오른쪽 가장자리의 '자막 보기' 버튼으로 다시 열 수 있습니다.");
  syncUserInterfaces();
}

function mountInPagePanel(): void {
  if (!isTopFrame || inPagePanel) {
    return;
  }

  inPagePanel = createInPagePanel({
    onStartCapture: () => {
      void startCapture().catch((error: unknown) => {
        reportRuntimeError(
          error instanceof Error
            ? error.message
            : "자막 모으기를 시작하지 못했습니다.",
          error,
        );
      });
    },
    onStopCapture: () => {
      void stopCapture().catch((error: unknown) => {
        reportRuntimeError(
          error instanceof Error
            ? error.message
            : "자막 모으기를 멈추지 못했습니다.",
          error,
        );
      });
    },
    onClearSession: () => {
      if (!confirmSessionClear()) {
        setPanelNotice("세션 비우기를 취소했습니다.");
        syncUserInterfaces();
        return;
      }
      void clearSessionAndReset().catch((error: unknown) => {
        reportRuntimeError(
          error instanceof Error
            ? error.message
            : "세션 비우기를 완료하지 못했습니다.",
          error,
        );
      });
    },
    onSaveSession: () => {
      void saveCurrentSessionSnapshot()
        .then(() => syncUserInterfaces())
        .catch((error: unknown) => {
          reportRuntimeError(
            error instanceof Error
              ? error.message
              : "지금 저장을 완료하지 못했습니다.",
            error,
          );
        });
    },
    onSaveAndStartNewSession: () => {
      void saveAndStartNewSession().catch((error: unknown) => {
        reportRuntimeError(
          error instanceof Error
            ? error.message
            : "중간 저장 후 새 세션을 시작하지 못했습니다.",
          error,
        );
      });
    },
    onHighlightLatestEntry: () => {
      void highlightLatestCommittedEntry().catch((error: unknown) => {
        reportRuntimeError(
          error instanceof Error
            ? error.message
            : "최신 자막 중요 표시를 저장하지 못했습니다.",
          error,
        );
      });
    },
    onExport: (format) => {
      void exportCurrentSession(format).catch((error: unknown) => {
        reportRuntimeError(
          error instanceof Error
            ? error.message
            : "파일 저장을 시작하지 못했습니다.",
          error,
        );
      });
    },
    onCopyRecent: () => {
      void copyRecentSessionLines().catch((error: unknown) => {
        reportRuntimeError(
          error instanceof Error
            ? error.message
            : "최근 자막 복사에 실패했습니다.",
          error,
        );
      });
    },
    onSetSpeakerHighlight: (enabled) => {
      void saveSettings({ panelSpeakerHighlightEnabled: enabled })
        .then((next) => {
          settings = next;
          setPanelNotice(
            enabled
              ? "패널에 발언자 색 표시를 켰습니다."
              : "패널 발언자 색 표시를 껐습니다.",
          );
          syncUserInterfaces();
        })
        .catch((error: unknown) => {
          reportRuntimeError(
            error instanceof Error
              ? error.message
              : "발언자 보기 설정을 저장하지 못했습니다.",
            error,
          );
        });
    },
    onSetExportSpeaker: (enabled) => {
      void saveSettings({ txtExportSpeakerEnabled: enabled })
        .then((next) => {
          settings = next;
          setPanelNotice(
            enabled
              ? "내보내기·복사에 발언자를 포함합니다."
              : "내보내기·복사에서 발언자를 빼 둡니다.",
          );
          syncUserInterfaces();
        })
        .catch((error: unknown) => {
          reportRuntimeError(
            error instanceof Error
              ? error.message
              : "발언자 내보내기 설정을 저장하지 못했습니다.",
            error,
          );
        });
    },
    onOpenHistory: () => {
      void openHistoryPage().catch((error: unknown) => {
        reportRuntimeError(
          error instanceof Error
            ? error.message
            : "저장된 기록 화면을 열지 못했습니다.",
          error,
        );
      });
    },
    onOpenOptions: () => {
      void openOptionsPage().catch((error: unknown) => {
        reportRuntimeError(
          error instanceof Error
            ? error.message
            : "환경 설정 화면을 열지 못했습니다.",
          error,
        );
      });
    },
    onOpenDiagnostics: () => {
      void openDiagnosticsPage().catch((error: unknown) => {
        reportRuntimeError(
          error instanceof Error
            ? error.message
            : "상태 확인 화면을 열지 못했습니다.",
          error,
        );
      });
    },
    onExpand: openInPagePanel,
    onCollapse: collapseInPagePanel,
    onTogglePreviewCollapsed: () => {
      previewCollapsed = !previewCollapsed;
      syncUserInterfaces();
    },
  });

  updateInPagePanel();
}

async function handleCommand(
  port: chrome.runtime.Port,
  message: PopupToContentMessage,
): Promise<void> {
  switch (message.type) {
    case "PING":
      syncPortState(port);
      return;
    case "GET_STATUS":
      diagnosticsPorts.delete(port);
      syncPortState(port);
      return;
    case "GET_DIAGNOSTICS_STATUS":
      diagnosticsPorts.add(port);
      syncPortState(port, false, true);
      return;
    case "OPEN_INPAGE_PANEL": {
      const feedback = openInPagePanel();
      postToPopupPort(port, createPopupFeedbackMessage(feedback));
      syncPortState(port);
      return;
    }
    case "START_CAPTURE":
      await startCapture();
      syncPortState(port);
      return;
    case "STOP_CAPTURE":
      await stopCapture();
      syncPortState(port);
      return;
    case "CLEAR_SESSION":
      if (!confirmSessionClear()) {
        setPanelNotice("세션 비우기를 취소했습니다.");
        syncUserInterfaces();
        syncPortState(port);
        return;
      }
      await clearSessionAndReset();
      syncPortState(port);
      return;
    case "SAVE_SESSION":
      {
        const result = await saveCurrentSessionSnapshot();
        if (result.message && !result.saved) {
          postToPopupPort(
            port,
            createPopupFeedbackMessage({
              command: "SAVE_SESSION",
              message: result.message,
            }),
          );
        }
      }
      syncUserInterfaces();
      syncPortState(port);
      return;
    case "EXPORT_REQUEST":
      await exportCurrentSession(message.format);
      syncPortState(port);
      return;
  }
}

function bindPopupPort(): void {
  if (!isTopFrame) {
    return;
  }

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== POPUP_PORT_NAME) {
      return;
    }

    popupPorts.add(port);
    syncPortState(port);

    port.onMessage.addListener((message: PopupToContentMessage) => {
      void handleCommand(port, message).catch((error: unknown) => {
        postToPopupPort(port, {
          type: "ERROR",
          message:
            error instanceof Error
              ? error.message
              : "알 수 없는 오류가 발생했습니다.",
        });
      });
    });

    port.onDisconnect.addListener(() => {
      popupPorts.delete(port);
      diagnosticsPorts.delete(port);
    });
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const typedMessage = message as PopupToContentMessage;
    if (typedMessage.type === "PING") {
      sendResponse({ ok: true });
      return true;
    }
    if (typedMessage.type === "GET_STATUS") {
      sendResponse(buildStatusSnapshot(false));
      return true;
    }
    if (typedMessage.type === "GET_DIAGNOSTICS_STATUS") {
      sendResponse(buildStatusSnapshot(false, true));
      return true;
    }
    return undefined;
  });
}

function bindSettingsChanges(): void {
  if (typeof chrome === "undefined" || !chrome.storage?.onChanged) {
    return;
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[EXTENSION_STORAGE_KEY]) {
      return;
    }
    if (extensionContextInvalidated) {
      return;
    }

    const previousSettings = settings;
    settings = sanitizeSettings(
      (changes[EXTENSION_STORAGE_KEY].newValue as
        | Partial<ExtensionSettings>
        | undefined) ?? {},
    );

    // Reset heuristic streaks tied to options that just changed so the new
    // policy takes effect immediately rather than after another N samples.
    if (
      previousSettings.filterUnconfirmedEnabled !==
      settings.filterUnconfirmedEnabled
    ) {
      localPollingUnconfirmedFallbackBlockStreak = 0;
      topFallbackUnconfirmedFallbackBlockStreak = 0;
    }
    if (
      previousSettings.pollingFallbackIntervalMs !==
      settings.pollingFallbackIntervalMs
    ) {
      topFallbackMissStreak = 0;
    }

    dispatchObserverConfig();
    startLocalPolling();
    startTopFrameFallback();

    if (!settings.runningAutoSaveEnabled) {
      clearRunningPersistTimer();
    }

    syncUserInterfaces();
  });
}

function resyncOnReturnToForeground(): void {
  if (!isTopFrame || extensionContextInvalidated) {
    return;
  }

  requestFrameForwardNonceResync(true);
  dispatchObserverConfig();
  triggerImmediateTopFallbackProbe();
  syncUserInterfaces();
}

function bindNavigationGuards(): void {
  if (!isTopFrame) {
    return;
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      persistRunningSnapshotForVisibilityChange();
      return;
    }
    if (document.visibilityState === "visible") {
      resyncOnReturnToForeground();
    }
  });

  window.addEventListener("pagehide", (event) => {
    const pageTransitionEvent = event as PageTransitionEvent;
    if (pageTransitionEvent.persisted) {
      // BFCache snapshot - keep autosave gating because the page may resume.
      persistRunningSnapshotForVisibilityChange();
      return;
    }
    // Genuine page exit - bypass autosave gating to preserve user work.
    persistStoppedSnapshotForPageExit();
  });

  window.addEventListener("pageshow", (event) => {
    const pageTransitionEvent = event as PageTransitionEvent;
    if (pageTransitionEvent.persisted) {
      resyncOnReturnToForeground();
    }
  });

  window.addEventListener("beforeunload", (event) => {
    if (!shouldWarnBeforeUnload(isTopFrame, state)) {
      return;
    }

    // Keep the unconditional snapshot here: the user is about to leave the
    // page, so autosave gating should not block the safety net.
    persistRunningSnapshotForVisibilityChange(Date.now(), {
      respectAutoSaveSetting: false,
    });
    event.preventDefault();
    event.returnValue = "";
  });
}

function bindUrlChangeDetection(): void {
  if (!isTopFrame) {
    return;
  }

  const scheduleReconcile = (): void => {
    urlReconcileController.schedule(
      () => window.location.href,
      async (url) => {
        try {
          await captureLifecycleLock.run("reconcile", () =>
            performUrlReconcile(url),
          );
        } catch (error) {
          reportRuntimeError(
            "페이지 주소 변경 후 캡처 상태를 갱신하지 못했습니다.",
            error,
          );
          throw error;
        }
      },
    );
  };

  const originalPushState = window.history.pushState.bind(window.history);
  const originalReplaceState = window.history.replaceState.bind(window.history);

  window.history.pushState = ((...args: Parameters<History["pushState"]>) => {
    const result = originalPushState(...args);
    scheduleReconcile();
    return result;
  }) as History["pushState"];

  window.history.replaceState = ((
    ...args: Parameters<History["replaceState"]>
  ) => {
    const result = originalReplaceState(...args);
    scheduleReconcile();
    return result;
  }) as History["replaceState"];

  window.addEventListener("popstate", scheduleReconcile);
  window.addEventListener("hashchange", scheduleReconcile);

  clearUrlChangePolling();
  urlChangePollingTimer = window.setInterval(() => {
    if (window.location.href !== urlReconcileController.getLastKnownUrl()) {
      scheduleReconcile();
    }
  }, 500);
}

function bindBridgeMessages(): void {
  window.addEventListener("message", (event) => {
    const data = event.data as
      | Partial<ObserverBridgeEvent>
      | Partial<FrameForwardMessage>
      | undefined;
    if (!data || typeof data !== "object") {
      return;
    }

    if (event.source === window && isObserverBridgeEventMessage(data)) {
      if (!observerBridgeToken || data.token !== observerBridgeToken) {
        return;
      }

      const eventPayload: ObserverBridgeEvent = {
        ...data,
        framePath: data.framePath ?? localFramePath,
      };
      forwardToTop(eventPayload);
      return;
    }

    if (
      isTopFrame &&
      event.source !== window &&
      isForwardedFrameMessage(data)
    ) {
      if (
        resolveForwardedFrameNonceAction(frameForwardNonce, data.nonce) ===
        "accept"
      ) {
        handleTopFrameEvent(data.event);
        return;
      }

      requestFrameForwardNonceResync(true);
      triggerImmediateTopFallbackProbe();
    }
  });
}

async function ensureFrameForwardNonce(): Promise<void> {
  await refreshFrameForwardNonce();
}

async function bootstrap(): Promise<void> {
  if (extensionContextInvalidated) {
    return;
  }

  state.title = document.title;
  state.committeeName = deriveCommitteeName(document.title);
  bindPopupPort();

  try {
    settings = await getSettings();
  } catch (error) {
    reportRuntimeError(
      "확장 설정을 불러오지 못해 기본값으로 계속 진행합니다.",
      error,
    );
  }
  if (extensionContextInvalidated) {
    return;
  }

  try {
    await ensureFrameForwardNonce();
  } catch (error) {
    reportRuntimeError("프레임 전달 보안 토큰 준비에 실패했습니다.", error);
  }
  if (extensionContextInvalidated) {
    return;
  }

  state.title = document.title;
  state.committeeName = deriveCommitteeName(document.title);
  setPanelNotice(resolveDefaultPanelNotice());
  bindBridgeMessages();
  bindSettingsChanges();
  bindNavigationGuards();
  bindUrlChangeDetection();
  mountInPagePanel();
  updateInPagePanel();
  startFrameForwardNonceRefresh();

  if (!isCapturePage()) {
    syncUserInterfaces();
    logDebug("content script bootstrapped without capture pipeline", {
      isTopFrame,
      localFramePath,
      url: window.location.href,
    });
    return;
  }

  await startCapturePipelineForCurrentPage();
  syncUserInterfaces();
  logDebug("content script bootstrapped", {
    isTopFrame,
    localFramePath,
    nonceSource: FRAME_FORWARD_NONCE_SOURCE,
  });
}
function handleBootstrapError(error: unknown): void {
  reportRuntimeError("content script 초기화 중 오류가 발생했습니다.", error);
  if (extensionContextInvalidated) {
    return;
  }
  mountInPagePanel();
  updateInPagePanel();
  if (isCapturePage()) {
    startLocalPolling();
    startTopFrameFallback();
  }
}

function createContentRuntimeServices(): ContentRuntimeServices {
  return {
    ui: {
      updateInPagePanel,
      syncUserInterfaces,
    },
    persistence: {
      clearRunningPersistTimer,
    },
    capturePipeline: {
      startCapturePipelineForCurrentPage,
      stopCapturePipelineForCurrentPage,
    },
    sessionActions: {
      startCapture,
      stopCapture,
    },
    bindings: {
      bindPopupPort,
      bindSettingsChanges,
      bindNavigationGuards,
      bindUrlChangeDetection,
      bindBridgeMessages,
    },
  };
}

export function createContentRuntime(): ContentRuntime {
  return {
    bootstrap,
    handleBootstrapError,
    services: createContentRuntimeServices(),
  };
}

