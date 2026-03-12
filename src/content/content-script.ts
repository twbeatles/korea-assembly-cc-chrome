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
const DEFAULT_IN_PAGE_NOTICE = "???섏씠吏 ?ㅻⅨ履쎌뿉???먮쭑??諛붾줈 蹂????덉뒿?덈떎.";
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

  return window.confirm("?꾩옱 ?몄뀡 湲곕줉??鍮꾩슦怨??ㅼ떆 ?쒖옉?좉퉴??");
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
      reportRuntimeError("?ㅽ뻾 以??몄뀡 ??μ뿉 ?ㅽ뙣?덉뒿?덈떎.", error);
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
    setPanelNotice("紐⑥? ?먮쭑????ν뻽?듬땲??");
  } catch (error) {
    failedStoppedSessionGuard = rememberFailedStoppedSession(record, error);
    reportRuntimeError("以묒????몄뀡 ??μ뿉 ?ㅽ뙣?덉뒿?덈떎.", error);
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
          handlePersistFailure("諛깃렇?쇱슫???몄뀡 ????붿껌???ㅽ뙣?덉뒿?덈떎.", lastError.message);
          return;
        }

        if (!response?.ok) {
          handlePersistFailure(
            response?.error || "諛깃렇?쇱슫???몄뀡 ??μ뿉 ?ㅽ뙣?덉뒿?덈떎.",
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
    handlePersistFailure("諛깃렇?쇱슫???몄뀡 ????꾩넚???ㅽ뙣?덉뒿?덈떎.", error);
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
    setPanelNotice("?꾩옱源뚯? 紐⑥? ?댁슜????ν뻽?듬땲??");
  } catch (error) {
    if (state.status !== "running") {
      failedStoppedSessionGuard = rememberFailedStoppedSession(record, error);
    }
    reportRuntimeError("?몄뀡 ?ㅻ깄????μ뿉 ?ㅽ뙣?덉뒿?덈떎.", error);
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
    reportRuntimeError("?먮쭑 ?뚯씠?꾨씪??泥섎━ 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.", error);
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
      reportRuntimeError("濡쒖뺄 ?먮쭑 ?대쭅 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.", error);
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
    reportRuntimeError("?꾨젅???먮쭑 fallback ?먯깋 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.", error);
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
      reportRuntimeError("?몄뀡 珥덇린???꾩뿉 ?댁쟾 ?ㅽ뻾 ?몄뀡 ??μ뿉 ?ㅽ뙣?덉뒿?덈떎.", error);
      return false;
    }
  }

  try {
    await deleteSession(sessionId);
    return true;
  } catch (error) {
    reportRuntimeError("?몄뀡 珥덇린???꾩뿉 ?댁쟾 ?ㅽ뻾 ?몄뀡 ?뺣━???ㅽ뙣?덉뒿?덈떎.", error);
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
  setPanelNotice("?붾㈃??鍮꾩슦怨??덈줈 ?쒖옉??以鍮꾨? 留덉낀?듬땲??");
  syncUserInterfaces();
}

async function startCapture(): Promise<void> {
  if (!(await ensureFailedStoppedSessionResolved("???섏쭛 ?쒖옉"))) {
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
    "?먮쭑 紐⑥쑝湲곕? ?쒖옉?덉뒿?덈떎. ?섏씠吏瑜??대룞?섍굅???덈줈怨좎묠?섎㈃ ?섏쭛??以묐떒?섍퀬, ?좊굹湲?吏곸쟾???먮룞 ??μ쓣 ?쒕룄?⑸땲??",
  );
  dispatchObserverConfig();
  syncUserInterfaces();

  const subtitleLayerReady = await ensureSubtitleLayerActive().catch((error: unknown) => {
    reportRuntimeError("AI ?먮쭑 ?덉씠?대? ?먮룞?쇰줈 ?댁? 紐삵뻽?듬땲??", error);
    return false;
  });
  if (!subtitleLayerReady) {
    setPanelNotice("?먮쭑 紐⑥쑝湲곕? ?쒖옉?덉뒿?덈떎. ?섏씠吏??'AI ?먮쭑蹂닿린'瑜???踰??뚮윭二쇱꽭??");
  }

  if (settings.runningAutoSaveEnabled) {
    try {
      const saved = await updateRunningSession(toSessionRecord(state, "running"));
      state = applyPersistSuccess(state, saved.updatedAt);
    } catch (error) {
      reportRuntimeError("?ㅽ뻾 以??몄뀡 珥덇린 ??μ뿉 ?ㅽ뙣?덉뒿?덈떎.", error);
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
  setPanelNotice("?먮쭑 紐⑥쑝湲곕? 硫덉톬?듬땲??");
  await persistStoppedSession(stoppedRecord);
  syncUserInterfaces();
}

async function exportCurrentSession(format: "txt" | "srt" | "vtt" | "json"): Promise<void> {
  const record = buildPreparedSessionRecord(state.status === "running" ? "running" : "stopped");
  if (!record.entries.length) {
    setPanelNotice("癒쇱? ?먮쭑??紐⑥? ???뚯씪濡???ν븯?몄슂.");
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
  setPanelNotice(`${payload.filename} ?뚯씪 ???李쎌쓣 ?댁뿀?듬땲??`);
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
    setPanelNotice("蹂듭궗???먮쭑???꾩쭅 ?놁뒿?덈떎.");
    syncUserInterfaces();
    return;
  }

  await copyTextToClipboard(copyText);
  setPanelNotice(
    visibleEntries.length
      ? `?붾㈃ ?먮쭑 ${Math.min(visibleEntries.length, settings.recentCopyLineCount)}以꾩쓣 蹂듭궗?덉뒿?덈떎.`
      : `理쒓렐 ${settings.recentCopyLineCount}以꾩쓣 蹂듭궗?덉뒿?덈떎.`,
  );
  syncUserInterfaces();
}

async function openHistoryPage(): Promise<void> {
  const response = await sendRuntimeMessage({ type: "OPEN_HISTORY_PAGE" });
  if (!response.ok) {
    throw new Error(response.error);
  }
  setPanelNotice("??λ맂 湲곕줉 ?붾㈃???댁뿀?듬땲??");
  syncUserInterfaces();
}

async function openOptionsPage(): Promise<void> {
  const response = await sendRuntimeMessage({ type: "OPEN_OPTIONS_PAGE" });
  if (!response.ok) {
    throw new Error(response.error);
  }
  setPanelNotice("?섍꼍 ?ㅼ젙 ?붾㈃???댁뿀?듬땲??");
  syncUserInterfaces();
}

async function openDiagnosticsPage(): Promise<void> {
  const response = await sendRuntimeMessage({ type: "OPEN_DIAGNOSTICS_PAGE" });
  if (!response.ok) {
    throw new Error(response.error);
  }
  setPanelNotice("?섏쭛 吏꾨떒 ?붾㈃???댁뿀?듬땲??");
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
    ? "?섏씠吏 ?ㅻⅨ履??⑤꼸???댁뿀?듬땲??"
    : "?섏씠吏 ?ㅻⅨ履??⑤꼸???대? ?대젮 ?덉뒿?덈떎.";
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
  setPanelNotice("?ㅻⅨ履?媛?μ옄由ъ쓽 '?먮쭑 蹂닿린' 踰꾪듉?쇰줈 ?ㅼ떆 ?????덉뒿?덈떎.");
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
          error instanceof Error ? error.message : "?먮쭑 紐⑥쑝湲곕? ?쒖옉?섏? 紐삵뻽?듬땲??",
          error,
        );
      });
    },
    onStopCapture: () => {
      void stopCapture().catch((error: unknown) => {
        reportRuntimeError(
          error instanceof Error ? error.message : "?먮쭑 紐⑥쑝湲곕? 硫덉텛吏 紐삵뻽?듬땲??",
          error,
        );
      });
    },
    onClearSession: () => {
      if (!confirmSessionClear()) {
        setPanelNotice("?몄뀡 鍮꾩슦湲곕? 痍⑥냼?덉뒿?덈떎.");
        syncUserInterfaces();
        return;
      }
      void clearSessionAndReset().catch((error: unknown) => {
        reportRuntimeError(
          error instanceof Error ? error.message : "?몄뀡 鍮꾩슦湲곕? ?꾨즺?섏? 紐삵뻽?듬땲??",
          error,
        );
      });
    },
    onSaveSession: () => {
      void saveCurrentSessionSnapshot()
        .then(() => syncUserInterfaces())
        .catch((error: unknown) => {
          reportRuntimeError(
            error instanceof Error ? error.message : "吏湲???μ쓣 ?꾨즺?섏? 紐삵뻽?듬땲??",
            error,
          );
        });
    },
    onExport: (format) => {
      void exportCurrentSession(format).catch((error: unknown) => {
        reportRuntimeError(
          error instanceof Error ? error.message : "?뚯씪 ??μ쓣 ?쒖옉?섏? 紐삵뻽?듬땲??",
          error,
        );
      });
    },
    onCopyRecent: () => {
      void copyRecentSessionLines().catch((error: unknown) => {
        reportRuntimeError(
          error instanceof Error ? error.message : "理쒓렐 ?먮쭑 蹂듭궗???ㅽ뙣?덉뒿?덈떎.",
          error,
        );
      });
    },
    onOpenHistory: () => {
      void openHistoryPage().catch((error: unknown) => {
        reportRuntimeError(
          error instanceof Error ? error.message : "??λ맂 湲곕줉 ?붾㈃???댁? 紐삵뻽?듬땲??",
          error,
        );
      });
    },
    onOpenOptions: () => {
      void openOptionsPage().catch((error: unknown) => {
        reportRuntimeError(
          error instanceof Error ? error.message : "?섍꼍 ?ㅼ젙 ?붾㈃???댁? 紐삵뻽?듬땲??",
          error,
        );
      });
    },
    onOpenDiagnostics: () => {
      void openDiagnosticsPage().catch((error: unknown) => {
        reportRuntimeError(
          error instanceof Error ? error.message : "?섏쭛 吏꾨떒 ?붾㈃???댁? 紐삵뻽?듬땲??",
          error,
        );
      });
    },
    onExpand: openInPagePanel,
    onCollapse: collapseInPagePanel,
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
        setPanelNotice("?몄뀡 鍮꾩슦湲곕? 痍⑥냼?덉뒿?덈떎.");
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
          message: error instanceof Error ? error.message : "?????녿뒗 ?ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.",
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
    throw new Error(response.ok ? "?꾨젅???꾨떖 ?좏겙??諛쏆? 紐삵뻽?듬땲??" : response.error);
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
    reportRuntimeError("?뺤옣 ?ㅼ젙??遺덈윭?ㅼ? 紐삵빐 湲곕낯媛믪쑝濡?怨꾩냽 吏꾪뻾?⑸땲??", error);
  }
  if (extensionContextInvalidated) {
    return;
  }

  try {
    await ensureFrameForwardNonce();
  } catch (error) {
    reportRuntimeError("?꾨젅???꾨떖 蹂댁븞 ?좏겙 以鍮꾩뿉 ?ㅽ뙣?덉뒿?덈떎.", error);
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
    reportRuntimeError("MutationObserver 二쇱엯???ㅽ뙣??polling fallback?쇰줈 怨꾩냽 吏꾪뻾?⑸땲??", error);
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
      reportRuntimeError("?먮룞 ?쒖옉 ?ㅼ젙???섑빐 ?먮쭑 紐⑥쑝湲곕? ?쒕룄?덉쑝???ㅽ뙣?덉뒿?덈떎.", error);
    });
  }
}

const bootstrapRoot = document.documentElement;

if (!bootstrapRoot?.hasAttribute(CONTENT_SCRIPT_BOOTSTRAP_ATTRIBUTE)) {
  bootstrapRoot?.setAttribute(CONTENT_SCRIPT_BOOTSTRAP_ATTRIBUTE, "true");
  void bootstrap().catch((error: unknown) => {
    reportRuntimeError("content script 珥덇린??以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.", error);
    if (extensionContextInvalidated) {
      return;
    }
    mountInPagePanel();
    updateInPagePanel();
    startLocalPolling();
    startTopFrameFallback();
  });
}

