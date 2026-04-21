import {
  applyKeepalive,
  applyPreview,
  applyReset,
  commitLiveRow,
  finalizeSession,
} from "../core/subtitle-pipeline";
import {
  clearLiveCaptureLedger,
  createEmptyLiveCaptureLedger,
  getLiveRow,
  listLivePanelRows,
  markLiveRowCommitted,
  normalizeCaptureEvent,
  reconcileLiveCapture,
  setLiveRowBaseline,
  type CaptureMode,
  type LivePanelRow,
} from "../core/live-capture";
import {
  cloneEntry,
  cloneState,
  cloneSessionRecord,
  createEmptySessionState,
  getSessionCharCount,
  toSessionRecord,
  type SessionRecord,
  type SessionState,
  type SubtitleEntry,
} from "../core/subtitle-models";
import {
  EXTENSION_STORAGE_KEY,
  FRAME_FORWARD_NONCE_SOURCE,
  OBSERVER_BRIDGE_SOURCE,
  OBSERVER_ACTIVATE_EVENT,
  OBSERVER_CONFIG_EVENT,
  OBSERVER_STOP_EVENT,
  PIPELINE_DEFAULTS,
  POPUP_PORT_NAME,
  SUBTITLE_SELECTOR_CANDIDATES,
  isSupportedAssemblyUrl,
} from "../shared/constants";
import { mapDownloadErrorMessage } from "../shared/download-errors";
import { normalizeSubtitleText } from "../core/text-normalizer";
import {
  applyPersistSuccess,
  clearScheduledRunningPersist,
  hasPersistableRunningContent,
  resolveRunningPersistDebounceMs,
  scheduleRunningPersistTimer,
  shouldPersistFinalSession,
  shouldScheduleRunningPersist,
  shouldWarnBeforeUnload,
} from "./autosave";
import { sendRuntimeMessage } from "../shared/chrome-api";
import { buildCaptureDiagnostics } from "../shared/capture-diagnostics";
import {
  buildCopyText,
  copyTextToClipboard,
  selectCopyEntries,
} from "../shared/copy-utils";
import {
  invalidateExtensionContext,
  isExtensionContextInvalidatedError,
  markExtensionContextInvalidated,
} from "../shared/extension-context";
import type {
  BackgroundCommandResponse,
  FrameForwardMessage,
  ObservedSubtitleRow,
  ObserverBridgeEvent,
  PersistabilityState,
  PopupToContentMessage,
  StatusSnapshot,
} from "../shared/message-types";
import {
  computeCurrentFramePath,
  probeBestAccessibleSubtitle,
  probeFramePath,
} from "./frame-probe";
import {
  buildInPagePanelState,
  createInPagePanel,
  type InPagePanelController,
} from "./inpage-panel";
import {
  resolvePanelLiveRows,
} from "./panel-live-rows";
import {
  clearFailedStoppedSessionGuard,
  createEmptyFailedStoppedSessionGuard,
  rememberFailedStoppedSession,
  resolveFailedStoppedSessionGuard,
} from "./failed-stopped-session";
import { RESET_CAPTURE_NOTICE } from "./capture-notice";
import { shouldEmitLocalProbeUpdate } from "./local-polling";
import { estimateRecentRaw } from "./dom-probe";
import { formatFallbackPreviewText } from "./fallback-preview";
import {
  shouldAllowUnconfirmedContainerFallback,
  updateUnconfirmedFallbackBlockStreak,
} from "./unconfirmed-fallback";
import { exportSessionData } from "../storage/session-store";
import { queueExitPersistRecord } from "../storage/persist-recovery";
import { getSettings, sanitizeSettings } from "../storage/settings-store";
import type { ExtensionSettings } from "../storage/types";
import { tryDomSubtitleActivation, waitForSubtitleLayer } from "./subtitle-layer";
import {
  createPopupFeedbackMessage,
  createPopupMessages,
  postToPopupPort,
} from "./popup-bridge";
import {
  forwardFrameEvent,
  isForwardedFrameMessage,
  isObserverBridgeEventMessage,
  resolveForwardedFrameNonceAction,
  resolveTopFallbackDelayMs,
} from "./frame-coordinator";
import { persistQueuedPageExitRecord } from "./page-exit-persist";
import {
  buildPreparedSessionRecord as prepareSessionRecord,
  buildPreparedSessionState as prepareSessionState,
  createResetSessionState,
} from "./session-lifecycle";
import { analyzeCaptureCommit, resolveRuntimeCaptureNotice } from "./subtitle-event-handler";
import {
  buildPersistabilityDiagnostics,
  resolvePreviewPersistabilityState,
} from "./persistability";

const isTopFrame = window.top === window;
const localFramePath = computeCurrentFramePath();
const injectedScriptId = "assembly-subtitle-observer-script";
const DEFAULT_IN_PAGE_NOTICE = "페이지 오른쪽에서 수집된 자막을 바로 보고 있습니다.";
const CONTENT_SCRIPT_BOOTSTRAP_ATTRIBUTE = "data-assembly-subtitle-content-script";
const SUBTITLE_RESET_GRACE_MS = 1000;
const INVALIDATED_CONTEXT_NOTICE = "Extension was updated. Please refresh the page (F5).";
const FRAME_FORWARD_NONCE_RESYNC_INTERVAL_MS = 15_000;

let settings: ExtensionSettings = {
  autoScroll: true,
  keepaliveIntervalMs: PIPELINE_DEFAULTS.keepaliveIntervalMs,
  pollingFallbackIntervalMs: 200,
  maxBufferLength: PIPELINE_DEFAULTS.confirmedCompactMaxLength,
  noiseFilterEnabled: true,
  recentDuplicateMinLength: PIPELINE_DEFAULTS.recentDuplicateMinLength,
  filenamePattern: "{date}_{committee}_{time}",
  txtExportTimestampsEnabled: false,
  runningAutoSaveEnabled: true,
  runningAutoSaveDebounceMs: 800,
  recentCopyLineCount: 5,
  debugLogging: false,
  autoStartEnabled: true,
  filterUnconfirmedEnabled: true,
};
let state: SessionState = createEmptySessionState(window.location.href, document.title);
const popupPorts = new Set<chrome.runtime.Port>();
let localPollingTimer: number | null = null;
let topFallbackTimer: number | null = null;
let persistTimer: number | null = null;
let pendingResetTimer: number | null = null;
let localLastProbeSignature = "";
let localHadProbeText = false;
let topFallbackMissStreak = 0;
let lastSuccessfulFallbackFramePath: number[] | null = null;
let unconfirmedFallbackBlockStreak = 0;
let panelCollapsed = false;
let previewCollapsed = true;
let panelNotice = DEFAULT_IN_PAGE_NOTICE;
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

function createObserverBridgeToken(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
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

function clearFrameForwardNonceRefresh(): void {
  if (frameForwardNonceRefreshTimer) {
    window.clearInterval(frameForwardNonceRefreshTimer);
    frameForwardNonceRefreshTimer = null;
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
  clearFrameForwardNonceRefresh();
  clearRunningPersistTimer();
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

function deriveCommitteeName(title: string): string {
  return title.replace(/\s+\|\s+[^|]+$/, "").trim();
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
  return liveCaptureLedger.previewText || state.previewText;
}

function formatPreviewForDisplay(
  previewText: string,
  captureMode: CaptureMode,
  sourceUrl?: string,
): string {
  const normalized = normalizeSubtitleText(previewText);
  if (!normalized) {
    return "";
  }

  if (captureMode !== "fallback") {
    return normalized;
  }

  return formatFallbackPreviewText(previewText, sourceUrl);
}

function getLivePreviewTextForDisplay(): string {
  return formatPreviewForDisplay(
    getLivePreviewText(),
    getCaptureMode(),
    state.sourceUrl || window.location.href,
  );
}

function getCaptureMode(): CaptureMode {
  return liveCaptureLedger.captureMode;
}

function setPersistabilityState(stateValue: PersistabilityState): void {
  latestPersistabilityState = stateValue;
}

function getPersistabilityDiagnostics() {
  if (state.status !== "running") {
    return buildPersistabilityDiagnostics(state.entries.length > 0 ? "persistable" : "idle");
  }

  if (latestPersistabilityState !== "idle") {
    return buildPersistabilityDiagnostics(latestPersistabilityState);
  }

  if (state.entries.length > 0) {
    return buildPersistabilityDiagnostics("persistable");
  }

  if (getLivePreviewText().trim()) {
    return buildPersistabilityDiagnostics("preview_only");
  }

  return buildPersistabilityDiagnostics("idle");
}

function resolvePreviewPersistability(previewText: string, now: number): PersistabilityState {
  if (!previewText.trim()) {
    return "idle";
  }

  const previewResult = applyPreview(cloneState(state), previewText, now, settings, {
    selector: state.currentSelector || undefined,
    framePath: state.currentFramePath.length ? state.currentFramePath : undefined,
  });

  return resolvePreviewPersistabilityState(previewResult.reason);
}

function shouldShowPanelNotice(message: string): boolean {
  return Boolean(message.trim()) && message !== DEFAULT_IN_PAGE_NOTICE;
}

function canClearCurrentSession(showNotice = shouldShowPanelNotice(panelNotice)): boolean {
  return (
    state.status === "running" ||
    state.entries.length > 0 ||
    Boolean(getLivePreviewText().trim()) ||
    showNotice
  );
}

function buildStatusSnapshot(requiresReload = false): StatusSnapshot {
  const captureMode = getCaptureMode();
  const hasPersistableContent = state.entries.length > 0;
  const persistability = getPersistabilityDiagnostics();
  const previewText = getLivePreviewTextForDisplay();
  return {
    connected: isSupportedAssemblyUrl(window.location.href),
    requiresReload,
    status: state.status,
    sessionId: state.sessionId,
    title: state.title,
    committeeName: state.committeeName,
    sourceUrl: state.sourceUrl,
    subtitleCount: state.entries.length,
    charCount: getSessionCharCount(state.entries),
    previewText,
    recentEntries: state.entries.slice(-20),
    startedAt: state.startedAt,
    endedAt: state.endedAt,
    updatedAt: state.updatedAt,
    lastPersistedAt: state.lastPersistedAt,
    observerActive: state.observerActive,
    currentSelector: state.currentSelector,
    currentFramePath: [...state.currentFramePath],
    diagnostics: buildCaptureDiagnostics({
      captureMode,
      observerActive: state.observerActive,
      currentSelector: state.currentSelector,
      currentFramePath: state.currentFramePath,
      persistabilityState: persistability.state,
      persistabilityHint: persistability.hint,
    }),
    hasPersistableContent,
  };
}

function broadcastPopupState(requiresReload = false): void {
  if (!isTopFrame) {
    return;
  }

  const messages = createPopupMessages(buildStatusSnapshot(requiresReload));
  popupPorts.forEach((port) => {
    try {
      messages.forEach((message) => postToPopupPort(port, message));
    } catch {
      // Ignore Invalidated context errors on ports
    }
  });
}

function syncPortState(port: chrome.runtime.Port, requiresReload = false): void {
  createPopupMessages(buildStatusSnapshot(requiresReload)).forEach((message) =>
    postToPopupPort(port, message),
  );
}

function clearRunningPersistTimer(): void {
  persistTimer = clearScheduledRunningPersist(persistTimer, (timerId) => window.clearTimeout(timerId));
}

async function persistSessionRecord(record: SessionRecord): Promise<SessionRecord> {
  const response = await sendRuntimeMessage({
    type: "PERSIST_SESSION_RECORD",
    record,
  });
  if (!response.ok) {
    throw new Error(response.error);
  }

  return {
    ...cloneSessionRecord(record),
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
  return prepareSessionState(state, settings, now);
}

function buildVisibleOutputEntries(now = Date.now()): SubtitleEntry[] {
  void now;
  return state.entries.map((entry) => cloneEntry(entry));
}

function buildVisibleSessionState(now = Date.now()): SessionState {
  const nextState = cloneState(state);
  nextState.entries = buildVisibleOutputEntries(now);
  nextState.previewText = getLivePreviewText();
  nextState.lastObservedRaw = nextState.previewText;
  return nextState;
}

function buildVisibleSessionRecord(
  persistedStatus: "running" | "saved" | "stopped",
  now = Date.now(),
): SessionRecord {
  if (persistedStatus !== "stopped") {
    return toSessionRecord(buildVisibleSessionState(now), persistedStatus);
  }

  return toSessionRecord(finalizeSession(buildVisibleSessionState(now), now, settings).state, persistedStatus);
}

function buildPreparedSessionRecord(
  persistedStatus: "running" | "saved" | "stopped",
  now = Date.now(),
): SessionRecord {
  if (persistedStatus !== "stopped") {
    return prepareSessionRecord(state, settings, persistedStatus, now);
  }

  return toSessionRecord(finalizeSession(buildPreparedSessionState(now), now, settings).state, persistedStatus);
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
  liveCaptureLedger = clearLiveCaptureLedger();
  localLastProbeSignature = "";
  localHadProbeText = false;
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
    scheduleRunningPersist();
    syncUserInterfaces();
  }, SUBTITLE_RESET_GRACE_MS);
}

function applyPreviewStateOnly(previewText: string, now: number): boolean {
  if (previewText === state.previewText) {
    return false;
  }

  state.previewText = previewText;
  state.lastObservedRaw = previewText;
  state.updatedAt = new Date(now).toISOString();
  state.lastObserverEventAt = now;
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

  let changed = reconciliation.changed || applyPreviewStateOnly(captureEvent.previewText, now);
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

    const result = commitLiveRow(state, liveRow.text, captureEvent.previewText, now, settings, {
      selector,
      framePath,
      sourceNodeKey: liveRow.key,
      entryId: liveRow.committedEntryId ?? undefined,
      baselineCompact: liveRow.baselineCompact ?? state.confirmedCompact,
    });
    committed =
      committed ||
      Boolean(result.appendedEntry) ||
      result.reason === "row_append" ||
      result.reason === "row_update";
    sawDuplicate = sawDuplicate || Boolean(result.reason?.includes("duplicate"));
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

function scheduleRunningPersist(): void {
  if (extensionContextInvalidated) {
    clearRunningPersistTimer();
    return;
  }

  persistTimer = scheduleRunningPersistTimer({
    currentTimer: persistTimer,
    delayMs: resolveRunningPersistDebounceMs(settings),
    shouldSchedule: shouldScheduleRunningPersist(isTopFrame, state, settings),
    clearTimer: (timerId) => window.clearTimeout(timerId),
    setTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
    getSnapshot: () => ({
      status: state.status,
      record: buildPreparedSessionRecord("running"),
    }),
    persistRecord: persistSessionRecord,
    onPersisted: (saved) => {
      state = applyPersistSuccess(state, saved.updatedAt);
      syncUserInterfaces();
    },
    onError: (error) => {
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

function persistSessionRecordInBackground(record: SessionRecord, retryAttempt = 0): void {
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
      persistSessionRecordInBackground(record, retryAttempt + 1);
      return;
    }

    if (document.visibilityState === "visible") {
      reportRuntimeError(message, detail);
      return;
    }

    console.warn("[assembly-subtitle] Background session persist failed", message, detail);
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
          handlePersistFailure("백그라운드 세션 저장 요청이 실패했습니다.", lastError.message);
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
          state = applyPersistSuccess(state, record.updatedAt);
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
    console.warn("[assembly-subtitle] Failed to queue exit persist record in background", error);
  }
}

function persistRunningSnapshotForVisibilityChange(now = Date.now()): void {
  if (extensionContextInvalidated || !isTopFrame || !canPersistCurrentRunningState()) {
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
  if (extensionContextInvalidated || !isTopFrame || !canPersistCurrentRunningState()) {
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
      persistSessionRecordInBackground(queuedRecord);
    },
    onQueueError: (error) => {
      console.warn("[assembly-subtitle] Failed to queue exit persist record", error);
    },
  });
}

async function saveCurrentSessionSnapshot(): Promise<{
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

async function refreshFrameForwardNonce(): Promise<void> {
  const response = await sendRuntimeMessage({ type: "GET_FRAME_FORWARD_NONCE" });
  if (!response.ok || !response.nonce) {
    throw new Error(response.ok ? "프레임 전달 토큰을 받지 못했습니다." : response.error);
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
        reportRuntimeError("프레임 전달 보안 토큰을 다시 확인하지 못했습니다.", error);
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
  if (extensionContextInvalidated) {
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
    script.onerror = () => reject(new Error("Failed to inject observer bridge"));
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
      return;
    }

    if (state.status !== "running") {
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

    if (captureCommit.shouldCommit) {
      unconfirmedFallbackBlockStreak = 0;
      const structuredResult = applyStructuredRowsEvent(
        captureCommit.stableRows,
        captureCommit.previewText,
        now,
        event.selector,
        event.framePath,
      );
      const persistabilityState =
        structuredResult.committed
          ? "persistable"
          : captureCommit.hasUnstableRows && captureCommit.stableRows.length === 0
            ? "unstable_only"
            : structuredResult.sawFiltered
              ? "filtered"
              : structuredResult.sawDuplicate
                ? "duplicate"
                : "preview_only";
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
        }),
      );
      if (
        !structuredResult.changed &&
        captureEvent.previewText === state.lastObservedRaw &&
        (!state.lastKeepaliveAt || now - state.lastKeepaliveAt >= settings.keepaliveIntervalMs)
      ) {
        state = applyKeepalive(state, now).state;
        scheduleRunningPersist();
        syncUserInterfaces();
        return;
      }
      if (structuredResult.changed) {
        scheduleRunningPersist();
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
      (!state.lastKeepaliveAt || now - state.lastKeepaliveAt >= settings.keepaliveIntervalMs)
    ) {
      state = applyKeepalive(state, now).state;
      scheduleRunningPersist();
      syncUserInterfaces();
      return;
    }

    const previewChanged = applyPreviewStateOnly(normalized, now);
    if (fallbackReconciliation.changed || previewChanged || noticeChanged) {
      syncUserInterfaces();
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
  });
}

function startLocalPolling(): void {
  if (extensionContextInvalidated) {
    clearLocalPolling();
    return;
  }

  clearLocalPolling();
  localPollingTimer = window.setInterval(() => {
    try {
      const allowUnconfirmedContainerFallback = shouldAllowUnconfirmedContainerFallback(
        unconfirmedFallbackBlockStreak,
      );
      const probe = estimateRecentRaw(document, state.currentSelector, {
        filterUnconfirmedEnabled: settings.filterUnconfirmedEnabled,
        allowUnconfirmedContainerFallback,
      });
      unconfirmedFallbackBlockStreak = updateUnconfirmedFallbackBlockStreak(
        unconfirmedFallbackBlockStreak,
        probe,
      );
      if (!probe.found || !probe.text) {
        if (localHadProbeText) {
          localHadProbeText = false;
          localLastProbeSignature = "";
          emitLocalProbeEvent("subtitle:reset");
        }
        return;
      }

      const decision = shouldEmitLocalProbeUpdate(localLastProbeSignature, probe);
      if (!decision.shouldEmit) {
        return;
      }

      localHadProbeText = true;
      localLastProbeSignature = decision.signature;
      emitLocalProbeEvent("subtitle:update", probe.text, probe.matchedSelector, probe.rows);
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
      resolveTopFallbackDelayMs(topFallbackMissStreak, settings.pollingFallbackIntervalMs),
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
      resolveTopFallbackDelayMs(topFallbackMissStreak, settings.pollingFallbackIntervalMs),
    );
    return;
  }

  try {
    const allowUnconfirmedContainerFallback = shouldAllowUnconfirmedContainerFallback(
      unconfirmedFallbackBlockStreak,
    );
    const probeOptions = {
      filterUnconfirmedEnabled: settings.filterUnconfirmedEnabled,
      allowUnconfirmedContainerFallback,
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
    unconfirmedFallbackBlockStreak = updateUnconfirmedFallbackBlockStreak(
      unconfirmedFallbackBlockStreak,
      probe,
    );
    if (!probe.found || !probe.text) {
      topFallbackMissStreak += 1;
      if (now - lastSubtitleActivationAttemptAt >= 2000) {
        requestSubtitleLayerActivation();
      }
      scheduleTopFrameFallbackTick(
        resolveTopFallbackDelayMs(topFallbackMissStreak, settings.pollingFallbackIntervalMs),
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
    });
  } catch (error) {
    topFallbackMissStreak += 1;
    reportRuntimeError("프레임 자막 fallback 탐색 중 오류가 발생했습니다.", error);
  }

  scheduleTopFrameFallbackTick(
    resolveTopFallbackDelayMs(topFallbackMissStreak, settings.pollingFallbackIntervalMs),
  );
}

function startTopFrameFallback(): void {
  if (!isTopFrame || extensionContextInvalidated) {
    clearTopFallbackTimer();
    return;
  }

  topFallbackMissStreak = 0;
  scheduleTopFrameFallbackTick(
    resolveTopFallbackDelayMs(topFallbackMissStreak, settings.pollingFallbackIntervalMs),
  );
}

function resetRuntimeState(): void {
  clearRunningPersistTimer();
  clearStructuredRuntimeState();
  setPersistabilityState("idle");
  state = createResetSessionState(window.location.href, document.title, deriveCommitteeName(document.title));
  topFallbackMissStreak = 0;
  unconfirmedFallbackBlockStreak = 0;
  lastSuccessfulFallbackFramePath = null;
  lastSubtitleActivationAttemptAt = 0;
  lastNavigationSnapshotAt = 0;
  setPanelNotice(DEFAULT_IN_PAGE_NOTICE);
}

async function ensureFailedStoppedSessionResolved(actionLabel: string): Promise<boolean> {
  const resolution = await resolveFailedStoppedSessionGuard({
    actionLabel,
    guard: failedStoppedSessionGuard,
    persistRecord: persistSessionRecord,
    confirmDiscard: confirmFailedStoppedSessionDiscard,
  });

  failedStoppedSessionGuard = resolution.guard;

  if (resolution.persistedRecord && state.sessionId === resolution.persistedRecord.id) {
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
      failedStoppedSessionGuard = rememberFailedStoppedSession(stoppedRecord, error);
      reportRuntimeError("세션 초기화 전에 이전 실행 세션 저장에 실패했습니다.", error);
      return false;
    }
  }

  try {
    await deletePersistedSession(sessionId);
    return true;
  } catch (error) {
    reportRuntimeError("세션 초기화 전에 이전 실행 세션 정리에 실패했습니다.", error);
    return false;
  }
}

async function clearSessionAndReset(): Promise<void> {
  if (!(await ensureFailedStoppedSessionResolved("clear session"))) {
    return;
  }
  if (!(await ensureCurrentRunningSessionPreservedBeforeReset())) {
    return;
  }
  resetRuntimeState();
  setPanelNotice("화면을 비우고 새로 시작할 준비를 마쳤습니다.");
  syncUserInterfaces();
}

async function startCapture(): Promise<void> {
  if (!(await ensureFailedStoppedSessionResolved("자막 수집 시작"))) {
    return;
  }
  if (!(await ensureCurrentRunningSessionPreservedBeforeReset())) {
    return;
  }
  resetRuntimeState();
  const now = new Date().toISOString();
  panelCollapsed = false;
  state.status = "running";
  state.createdAt = now;
  state.startedAt = now;
  state.updatedAt = now;
  state.title = document.title;
  state.committeeName = deriveCommitteeName(document.title);
  setPanelNotice(
    "자막 모으기를 시작했습니다. 페이지를 이동하거나 닫으려고 하면 수집을 중단하고, 종료 직전에 자동 저장을 시도합니다.",
  );
  dispatchObserverConfig();
  syncUserInterfaces();

  const subtitleLayerReady = await ensureSubtitleLayerActive().catch((error: unknown) => {
    reportRuntimeError("AI 자막 레이어를 자동으로 열지 못했습니다.", error);
    return false;
  });
  if (!subtitleLayerReady) {
    setPanelNotice("자막 모으기를 시작했습니다. 페이지에서 'AI 자막보기'를 한 번 눌러주세요.");
  }

  syncUserInterfaces();
}

async function stopCapture(): Promise<void> {
  clearRunningPersistTimer();
  clearPendingReset();
  const now = Date.now();
  const stoppedRecord = buildPreparedSessionRecord("stopped", now);
  state = finalizeSession(state, now, settings).state;
  setPanelNotice("자막 모으기를 멈췄습니다.");
  await persistStoppedSession(stoppedRecord);
  syncUserInterfaces();
}

async function exportCurrentSession(format: "txt" | "srt" | "vtt" | "json"): Promise<void> {
  const record = buildVisibleSessionRecord(state.status === "running" ? "running" : "stopped");
  if (!record.entries.length) {
    setPanelNotice("먼저 자막을 모은 뒤 파일로 저장하세요.");
    syncUserInterfaces();
    return;
  }

  const payload = await exportSessionData(record, format, {
    filenamePattern: settings.filenamePattern,
    txtExportTimestampsEnabled: settings.txtExportTimestampsEnabled,
  });
  const response = await sendRuntimeMessage({
    type: "DOWNLOAD_REQUEST",
    filename: payload.filename,
    content: payload.content,
    mimeType: payload.mimeType,
  });
  if (!response.ok) {
    throw new Error(
      mapDownloadErrorMessage(response.error) || "파일 저장을 시작하지 못했습니다.",
    );
  }
  setPanelNotice(`${payload.filename} 파일 저장 창을 열었습니다.`);
  syncUserInterfaces();
}

async function copyRecentSessionLines(): Promise<void> {
  const prepared = buildPreparedSessionState();
  const copiedEntries = selectCopyEntries(prepared.entries, {
    limit: settings.recentCopyLineCount,
  });
  const copyText = buildCopyText(prepared.entries, {
    limit: settings.recentCopyLineCount,
  });

  if (!copyText) {
    setPanelNotice("복사할 자막이 아직 없습니다.");
    syncUserInterfaces();
    return;
  }

  await copyTextToClipboard(copyText);
  setPanelNotice(
    `최근 ${copiedEntries.length}줄을 복사했습니다.`,
  );
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
  setPanelNotice("수집 진단 화면을 열었습니다.");
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
          error instanceof Error ? error.message : "자막 모으기를 시작하지 못했습니다.",
          error,
        );
      });
    },
    onStopCapture: () => {
      void stopCapture().catch((error: unknown) => {
        reportRuntimeError(
          error instanceof Error ? error.message : "자막 모으기를 멈추지 못했습니다.",
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
          error instanceof Error ? error.message : "세션 비우기를 완료하지 못했습니다.",
          error,
        );
      });
    },
    onSaveSession: () => {
      void saveCurrentSessionSnapshot()
        .then(() => syncUserInterfaces())
        .catch((error: unknown) => {
          reportRuntimeError(
            error instanceof Error ? error.message : "지금 저장을 완료하지 못했습니다.",
            error,
          );
        });
    },
    onExport: (format) => {
      void exportCurrentSession(format).catch((error: unknown) => {
        reportRuntimeError(
          error instanceof Error ? error.message : "파일 저장을 시작하지 못했습니다.",
          error,
        );
      });
    },
    onCopyRecent: () => {
      void copyRecentSessionLines().catch((error: unknown) => {
        reportRuntimeError(
          error instanceof Error ? error.message : "최근 자막 복사에 실패했습니다.",
          error,
        );
      });
    },
    onOpenHistory: () => {
      void openHistoryPage().catch((error: unknown) => {
        reportRuntimeError(
          error instanceof Error ? error.message : "저장된 기록 화면을 열지 못했습니다.",
          error,
        );
      });
    },
    onOpenOptions: () => {
      void openOptionsPage().catch((error: unknown) => {
        reportRuntimeError(
          error instanceof Error ? error.message : "환경 설정 화면을 열지 못했습니다.",
          error,
        );
      });
    },
    onOpenDiagnostics: () => {
      void openDiagnosticsPage().catch((error: unknown) => {
        reportRuntimeError(
          error instanceof Error ? error.message : "수집 진단 화면을 열지 못했습니다.",
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
      syncPortState(port);
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
          message: error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.",
        });
      });
    });

    port.onDisconnect.addListener(() => {
      popupPorts.delete(port);
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

    settings = sanitizeSettings(
      (changes[EXTENSION_STORAGE_KEY].newValue as Partial<ExtensionSettings> | undefined) ?? {},
    );

    dispatchObserverConfig();
    startLocalPolling();
    startTopFrameFallback();

    if (!settings.runningAutoSaveEnabled) {
      clearRunningPersistTimer();
    }

    syncUserInterfaces();
  });
}

function bindNavigationGuards(): void {
  if (!isTopFrame) {
    return;
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      persistRunningSnapshotForVisibilityChange();
    }
  });

  window.addEventListener("pagehide", (event) => {
    const pageTransitionEvent = event as PageTransitionEvent;
    if (pageTransitionEvent.persisted) {
      persistRunningSnapshotForVisibilityChange();
      return;
    }
    persistStoppedSnapshotForPageExit();
  });

  window.addEventListener("beforeunload", (event) => {
    if (!shouldWarnBeforeUnload(isTopFrame, state)) {
      return;
    }

    persistRunningSnapshotForVisibilityChange();
    event.preventDefault();
    event.returnValue = "";
  });
}

function bindBridgeMessages(): void {
  window.addEventListener("message", (event) => {
    const data = event.data as Partial<ObserverBridgeEvent> | Partial<FrameForwardMessage> | undefined;
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

    if (isTopFrame && event.source !== window && isForwardedFrameMessage(data)) {
      if (resolveForwardedFrameNonceAction(frameForwardNonce, data.nonce) === "accept") {
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
    reportRuntimeError("확장 설정을 불러오지 못해 기본값으로 계속 진행합니다.", error);
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
  bindBridgeMessages();
  bindSettingsChanges();
  bindNavigationGuards();
  mountInPagePanel();
  updateInPagePanel();
  startFrameForwardNonceRefresh();

  try {
    await injectObserverScript();
  } catch (error) {
    reportRuntimeError("MutationObserver 주입에 실패해 polling fallback으로 계속 진행합니다.", error);
  }
  if (extensionContextInvalidated) {
    return;
  }

  startLocalPolling();
  startTopFrameFallback();
  syncUserInterfaces();
  logDebug("content script bootstrapped", {
    isTopFrame,
    localFramePath,
    nonceSource: FRAME_FORWARD_NONCE_SOURCE,
  });

  if (isTopFrame && settings.autoStartEnabled && state.status !== "running") {
    void startCapture().catch((error: unknown) => {
      reportRuntimeError("자동 시작 설정에 따라 자막 모으기를 시도했으나 실패했습니다.", error);
    });
  }
}

const bootstrapRoot = document.documentElement;

if (!bootstrapRoot?.hasAttribute(CONTENT_SCRIPT_BOOTSTRAP_ATTRIBUTE)) {
  bootstrapRoot?.setAttribute(CONTENT_SCRIPT_BOOTSTRAP_ATTRIBUTE, "true");
  void bootstrap().catch((error: unknown) => {
    reportRuntimeError("content script 초기화 중 오류가 발생했습니다.", error);
    if (extensionContextInvalidated) {
      return;
    }
    mountInPagePanel();
    updateInPagePanel();
    startLocalPolling();
    startTopFrameFallback();
  });
}

