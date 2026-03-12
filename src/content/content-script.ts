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
  createEmptySessionState,
  getSessionCharCount,
  toSessionRecord,
  type SessionRecord,
  type SessionState,
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
import { buildCopyText, copyTextToClipboard } from "../shared/copy-utils";
import type {
  BackgroundCommandResponse,
  FrameForwardMessage,
  ObservedSubtitleRow,
  ObserverBridgeEvent,
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
  clearFailedStoppedSessionGuard,
  createEmptyFailedStoppedSessionGuard,
  rememberFailedStoppedSession,
  resolveFailedStoppedSessionGuard,
} from "./failed-stopped-session";
import { RESET_CAPTURE_NOTICE } from "./capture-notice";
import { shouldEmitLocalProbeUpdate } from "./local-polling";
import { estimateRecentRaw } from "./dom-probe";
import {
  deleteSession,
  exportSessionData,
  saveSession,
  updateRunningSession,
} from "../storage/session-store";
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
  resolveTopFallbackDelayMs,
} from "./frame-coordinator";
import {
  buildPreparedSessionRecord as prepareSessionRecord,
  buildPreparedSessionState as prepareSessionState,
  createResetSessionState,
} from "./session-lifecycle";
import { hasOnlyStableRows, resolveRuntimeCaptureNotice } from "./subtitle-event-handler";

const isTopFrame = window.top === window;
const localFramePath = computeCurrentFramePath();
const injectedScriptId = "assembly-subtitle-observer-script";
const DEFAULT_IN_PAGE_NOTICE = "페이지 오른쪽에서 수집된 자막을 바로 보고 있습니다.";
const CONTENT_SCRIPT_BOOTSTRAP_ATTRIBUTE = "data-assembly-subtitle-content-script";
const SUBTITLE_RESET_GRACE_MS = 1000;
const INVALIDATED_CONTEXT_NOTICE = "Extension was updated. Please refresh the page (F5).";

let settings: ExtensionSettings = {
  autoScroll: true,
  keepaliveIntervalMs: PIPELINE_DEFAULTS.keepaliveIntervalMs,
  pollingFallbackIntervalMs: 200,
  maxBufferLength: PIPELINE_DEFAULTS.confirmedCompactMaxLength,
  noiseFilterEnabled: true,
  recentDuplicateMinLength: PIPELINE_DEFAULTS.recentDuplicateMinLength,
  filenamePattern: "{date}_{committee}_{time}",
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
let panelCollapsed = false;
let previewCollapsed = true;
let panelNotice = DEFAULT_IN_PAGE_NOTICE;
let inPagePanel: InPagePanelController | null = null;
let frameForwardNonce = "";
let observerBridgeToken = createObserverBridgeToken();
let lastSubtitleActivationAttemptAt = 0;
let lastNavigationSnapshotAt = 0;
let liveCaptureLedger = createEmptyLiveCaptureLedger();
let extensionContextInvalidated = false;
let failedStoppedSessionGuard = createEmptyFailedStoppedSessionGuard();

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

function isExtensionContextInvalidatedError(error: unknown): boolean {
  if (typeof error === "string") {
    return error.includes("Extension context invalidated");
  }
  if (error instanceof Error) {
    return error.message.includes("Extension context invalidated");
  }
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" && message.includes("Extension context invalidated");
  }
  return false;
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

function shutdownForInvalidatedContext(): void {
  if (extensionContextInvalidated) {
    return;
  }

  extensionContextInvalidated = true;
  clearLocalPolling();
  clearTopFallbackTimer();
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
  if (isExtensionContextInvalidatedError(error)) {
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
  return title.replace(/\s*[-|].*$/, "").trim();
}

function logDebug(message: string, payload?: unknown): void {
  if (!settings.debugLogging) {
    return;
  }
  console.debug("[assembly-subtitle]", message, payload);
}

function getPanelLiveRows(): LivePanelRow[] {
  return listLivePanelRows(liveCaptureLedger);
}

function getLivePreviewText(): string {
  return liveCaptureLedger.previewText || state.previewText;
}

function getCaptureMode(): CaptureMode {
  return liveCaptureLedger.captureMode;
}

function buildStatusSnapshot(requiresReload = false): StatusSnapshot {
  const captureMode = getCaptureMode();
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
    previewText: getLivePreviewText(),
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
    }),
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

function canPersistCurrentRunningState(): boolean {
  return hasPersistableRunningContent(state);
}

function buildPreparedSessionState(now = Date.now()): SessionState {
  return prepareSessionState(state, settings, now);
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

  inPagePanel.update(
    buildInPagePanelState(buildStatusSnapshot(false), {
      collapsed: panelCollapsed,
      previewCollapsed,
      notice: panelNotice,
      autoScroll: settings.autoScroll,
      recentCopyLineCount: settings.recentCopyLineCount,
      livePreviewText: getLivePreviewText(),
      liveRows: getPanelLiveRows(),
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

function applyStructuredRowsEvent(
  rows: ObservedSubtitleRow[],
  previewText: string,
  now: number,
  selector?: string,
  framePath?: number[],
): boolean {
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

  return changed;
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
    persistRecord: updateRunningSession,
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
    return;
  }

  try {
    const saved = await saveSession(record);
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

  persistSessionRecordInBackground(record);
}

async function saveCurrentSessionSnapshot(): Promise<void> {
  const record = buildPreparedSessionRecord("saved");
  if (!shouldPersistFinalSession(isTopFrame, record.entries.length)) {
    return;
  }

  try {
    const saved = await saveSession(record);
    if (failedStoppedSessionGuard.record?.id === saved.id) {
      failedStoppedSessionGuard = clearFailedStoppedSessionGuard();
    }
    state = applyPersistSuccess(state, saved.updatedAt);
    setPanelNotice("현재까지 모든 내용을 저장했습니다.");
  } catch (error) {
    if (state.status !== "running") {
      failedStoppedSessionGuard = rememberFailedStoppedSession(record, error);
    }
    reportRuntimeError("세션 저장에 실패했습니다.", error);
  }
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
  return layer.visible;
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
      return;
    }

    const hasStableStructuredRows =
      captureEvent.captureMode === "structured" && hasOnlyStableRows(captureEvent.rows);
    const noticeChanged = setPanelNotice(
      resolveRuntimeCaptureNotice({
        captureMode: captureEvent.captureMode,
        observerActive: state.observerActive,
        hasStableRows: hasStableStructuredRows,
        lastCommittedResetAt: state.lastCommittedResetAt,
        now,
      }),
    );

    if (hasStableStructuredRows) {
      const changed = applyStructuredRowsEvent(
        captureEvent.rows,
        captureEvent.previewText,
        now,
        event.selector,
        event.framePath,
      );
      if (
        !changed &&
        captureEvent.previewText === state.lastObservedRaw &&
        (!state.lastKeepaliveAt || now - state.lastKeepaliveAt >= settings.keepaliveIntervalMs)
      ) {
        state = applyKeepalive(state, now).state;
        scheduleRunningPersist();
        syncUserInterfaces();
        return;
      }
      if (changed) {
        scheduleRunningPersist();
      }
      if (changed || noticeChanged) {
        syncUserInterfaces();
      }
      return;
    }

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

    const result = applyPreview(state, normalized, now, settings, {
      selector: event.selector,
      framePath: event.framePath,
    });
    state = result.state;
    if (result.changed) {
      scheduleRunningPersist();
    }
    if (fallbackReconciliation.changed || result.changed || noticeChanged) {
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
      const probe = estimateRecentRaw(document, state.currentSelector, {
        filterUnconfirmedEnabled: settings.filterUnconfirmedEnabled,
      });
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
    const probeOptions = {
      filterUnconfirmedEnabled: settings.filterUnconfirmedEnabled,
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
  state = createResetSessionState(window.location.href, document.title, deriveCommitteeName(document.title));
  topFallbackMissStreak = 0;
  lastSuccessfulFallbackFramePath = null;
  lastSubtitleActivationAttemptAt = 0;
  lastNavigationSnapshotAt = 0;
  setPanelNotice(DEFAULT_IN_PAGE_NOTICE);
}

async function ensureFailedStoppedSessionResolved(actionLabel: string): Promise<boolean> {
  const resolution = await resolveFailedStoppedSessionGuard({
    actionLabel,
    guard: failedStoppedSessionGuard,
    persistRecord: saveSession,
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
      const saved = await saveSession(stoppedRecord);
      state = applyPersistSuccess(state, saved.updatedAt);
      return true;
    } catch (error) {
      failedStoppedSessionGuard = rememberFailedStoppedSession(stoppedRecord, error);
      reportRuntimeError("세션 초기화 전에 이전 실행 세션 저장에 실패했습니다.", error);
      return false;
    }
  }

  try {
    await deleteSession(sessionId);
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

  if (settings.runningAutoSaveEnabled) {
    try {
      const saved = await updateRunningSession(toSessionRecord(state, "running"));
      state = applyPersistSuccess(state, saved.updatedAt);
    } catch (error) {
      reportRuntimeError("수집 중 세션 초기 저장에 실패했습니다.", error);
    }
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
  const record = buildPreparedSessionRecord(state.status === "running" ? "running" : "stopped");
  if (!record.entries.length) {
    setPanelNotice("먼저 자막을 모은 뒤 파일로 저장하세요.");
    syncUserInterfaces();
    return;
  }

  const payload = await exportSessionData(record, format, settings.filenamePattern);
  const response = await sendRuntimeMessage({
    type: "DOWNLOAD_REQUEST",
    filename: payload.filename,
    content: payload.content,
    mimeType: payload.mimeType,
  });
  if (!response.ok) {
    throw new Error(response.error);
  }
  setPanelNotice(`${payload.filename} 파일 저장 창을 열었습니다.`);
  syncUserInterfaces();
}

async function copyRecentSessionLines(): Promise<void> {
  const liveRows = getPanelLiveRows();
  const visibleEntries = liveRows.map((row) => {
    const timestamp = new Date(row.updatedAt).toISOString();
    return {
      id: row.key,
      text: row.text,
      timestamp,
      startTime: timestamp,
      endTime: timestamp,
    };
  });
  const prepared = buildPreparedSessionState();
  const sourceEntries = visibleEntries.length ? visibleEntries : prepared.entries;
  const copyText = buildCopyText(sourceEntries, {
    limit: settings.recentCopyLineCount,
  });

  if (!copyText) {
    setPanelNotice("복사할 자막이 아직 없습니다.");
    syncUserInterfaces();
    return;
  }

  await copyTextToClipboard(copyText);
  setPanelNotice(
    visibleEntries.length
      ? `수집된 자막 ${Math.min(visibleEntries.length, settings.recentCopyLineCount)}줄을 복사했습니다.`
      : `최근 ${settings.recentCopyLineCount}줄을 복사했습니다.`,
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
      await saveCurrentSessionSnapshot();
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

    if (
      isTopFrame &&
      event.source !== window &&
      frameForwardNonce &&
      isForwardedFrameMessage(data) &&
      data.nonce === frameForwardNonce
    ) {
      handleTopFrameEvent(data.event);
    }
  });
}

async function ensureFrameForwardNonce(): Promise<void> {
  const response = await sendRuntimeMessage({ type: "GET_FRAME_FORWARD_NONCE" });
  if (!response.ok || !response.nonce) {
    throw new Error(response.ok ? "프레임 전달 토큰을 받지 못했습니다." : response.error);
  }
  frameForwardNonce = response.nonce;
}

async function bootstrap(): Promise<void> {
  if (extensionContextInvalidated) {
    return;
  }

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
  bindPopupPort();
  bindSettingsChanges();
  bindNavigationGuards();
  mountInPagePanel();
  updateInPagePanel();

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

