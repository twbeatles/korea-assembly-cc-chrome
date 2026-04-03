import {
  applyKeepalive,
  applyPreview,
  applyReset,
  buildConfirmedCompactHistory,
  finalizeSession,
} from "../../core/subtitle-pipeline";
import {
  clearLiveCaptureLedger,
  createEmptyLiveCaptureLedger,
  getLiveRow,
  normalizeCaptureEvent,
  reconcileLiveCapture,
  syncLiveRowOutputEntry,
  type LiveCaptureRow,
} from "../../core/live-capture";
import {
  cloneEntry,
  createId,
  createEmptySessionState,
  type SessionRecord,
  type SessionState,
  type SubtitleEntry,
} from "../../core/subtitle-models";
import { compactSubtitleText, normalizeSubtitleText } from "../../core/text-normalizer";
import {
  EXTENSION_STORAGE_KEY,
  FRAME_FORWARD_NONCE_SOURCE,
  OBSERVER_BRIDGE_SOURCE,
  OBSERVER_ACTIVATE_EVENT,
  OBSERVER_CONFIG_EVENT,
  OBSERVER_STOP_EVENT,
  PIPELINE_DEFAULTS,
  POPUP_PORT_NAME,
} from "../../shared/constants";
import {
  applyPersistSuccess,
  clearScheduledRunningPersist,
  resolveRunningPersistDebounceMs,
  scheduleRunningPersistTimer,
  shouldPersistFinalSession,
  shouldScheduleRunningPersist,
  shouldWarnBeforeUnload,
} from "../autosave";
import { sendRuntimeMessage } from "../../shared/chrome-api";
import {
  buildCopyText,
  copyTextToClipboard,
  selectCopyEntries,
} from "../../shared/copy-utils";
import type {
  BackgroundCommandResponse,
  FrameForwardMessage,
  ObservedSubtitleRow,
  ObserverBridgeEvent,
  PopupToContentMessage,
} from "../../shared/message-types";
import {
  computeCurrentFramePath,
  probeBestAccessibleSubtitle,
  probeFramePath,
} from "../frame-probe";
import {
  type InPagePanelController,
} from "../inpage-panel";
import {
  clearFailedStoppedSessionGuard,
  createEmptyFailedStoppedSessionGuard,
  rememberFailedStoppedSession,
  resolveFailedStoppedSessionGuard,
} from "../failed-stopped-session";
import { RESET_CAPTURE_NOTICE } from "../capture-notice";
import { shouldEmitLocalProbeUpdate } from "../local-polling";
import { estimateRecentRaw } from "../dom-probe";
import {
  deleteSession,
  exportSessionData,
  saveSession,
  updateRunningSession,
} from "../../storage/session-store";
import { queueExitPersistRecord } from "../../storage/persist-recovery";
import { getSettings, sanitizeSettings } from "../../storage/settings-store";
import type { ExtensionSettings } from "../../storage/types";
import { tryDomSubtitleActivation, waitForSubtitleLayer } from "../subtitle-layer";
import { deriveCommitteeNameFromTitle } from "../committee-name";
import { getSubtitleSelectorCandidates } from "../subtitle-dom";
import {
  createPopupFeedbackMessage,
  postToPopupPort,
} from "../popup-bridge";
import {
  forwardFrameEvent,
  isForwardedFrameMessage,
  isObserverBridgeEventMessage,
  resolveForwardedFrameNonceAction,
  resolveTopFallbackDelayMs,
} from "../frame-coordinator";
import { persistQueuedPageExitRecord } from "../page-exit-persist";
import { createResetSessionState } from "../session-lifecycle";
import { hasOnlyStableRows, resolveRuntimeCaptureNotice } from "../subtitle-event-handler";
import {
  collapseInPagePanelController,
  mountInPagePanelController,
  openInPagePanelController,
} from "./panel-controller";
import {
  syncPortState as syncPortStateView,
  syncUserInterfaces as syncUserInterfacesView,
  updateInPagePanel as updateInPagePanelView,
} from "./panel-ui";
import {
  buildPreparedSessionRecord as buildPreparedSessionRecordView,
  buildPreparedSessionState as buildPreparedSessionStateView,
  buildPreparedOutputSnapshot as buildPreparedOutputSnapshotView,
  buildStatusSnapshot as buildStatusSnapshotView,
} from "./runtime-view";
import {
  FRAME_FORWARD_NONCE_RESYNC_INTERVAL_MS,
  INTERNAL_CACHE_COMPACT_INTERVAL_MS,
  INTERNAL_CACHE_MAX_PENDING_PREVIEWS,
  INTERNAL_CACHE_MAX_STATE_ENTRIES,
  INTERNAL_CACHE_TARGET_STATE_ENTRIES,
  INTERNAL_LEDGER_METADATA_STALE_MS,
  INVALIDATED_CONTEXT_NOTICE,
  DEFAULT_IN_PAGE_NOTICE,
  SUBTITLE_RESET_GRACE_MS,
  createDefaultSettings,
} from "./runtime-config";
import {
  confirmFailedStoppedSessionDiscard,
  confirmSessionClear,
  createObserverBridgeToken,
  isExtensionContextInvalidatedError,
} from "./runtime-helpers";

const isTopFrame = window.top === window;
const localFramePath = computeCurrentFramePath();
const injectedScriptId = "assembly-subtitle-observer-script";
let settings: ExtensionSettings = createDefaultSettings();
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
let frameForwardNonceRefreshTimer: number | null = null;
let frameForwardNonceRefreshInFlight = false;
let observerBridgeToken = createObserverBridgeToken();
let lastSubtitleActivationAttemptAt = 0;
let lastNavigationSnapshotAt = 0;
let liveCaptureLedger = createEmptyLiveCaptureLedger();
let extensionContextInvalidated = false;
let failedStoppedSessionGuard = createEmptyFailedStoppedSessionGuard();
let lastInternalCacheCompactAt = 0;

function setPanelNotice(message: string): boolean {
  if (panelNotice === message) {
    return false;
  }
  panelNotice = message;
  return true;
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

function logDebug(message: string, payload?: unknown): void {
  if (!settings.debugLogging) {
    return;
  }
  console.debug("[assembly-subtitle]", message, payload);
}

function clearRunningPersistTimer(): void {
  persistTimer = clearScheduledRunningPersist(persistTimer, (timerId) => window.clearTimeout(timerId));
}

function canPersistCurrentRunningState(): boolean {
  if (state.status !== "running") {
    return false;
  }
  return buildPreparedOutputSnapshot().eligibility.canPersistPreparedContent;
}

function buildPreparedOutputSnapshot(now = Date.now()) {
  return buildPreparedOutputSnapshotView(
    liveCaptureLedger,
    state,
    state.sourceUrl || window.location.href,
    now,
  );
}

function buildStatusSnapshot(requiresReload = false) {
  return buildStatusSnapshotView(window.location.href, liveCaptureLedger, state, requiresReload);
}

function syncPortState(port: chrome.runtime.Port, requiresReload = false): void {
  syncPortStateView(port, buildStatusSnapshot, requiresReload);
}

function buildPreparedSessionState(now = Date.now()) {
  return buildPreparedSessionStateView(
    liveCaptureLedger,
    state,
    state.sourceUrl || window.location.href,
    now,
  );
}

function buildPreparedSessionRecord(
  persistedStatus: "running" | "saved" | "stopped",
  now = Date.now(),
) {
  return buildPreparedSessionRecordView(
    liveCaptureLedger,
    state,
    settings,
    state.sourceUrl || window.location.href,
    persistedStatus,
    now,
  );
}

function updateInPagePanel(): void {
  updateInPagePanelView(
    {
      isTopFrame,
      inPagePanel,
      popupPorts,
      panelCollapsed,
      previewCollapsed,
      panelNotice,
      settings,
    },
    buildPreparedOutputSnapshot(),
    buildStatusSnapshot(false),
  );
}

function syncUserInterfaces(requiresReload = false): void {
  syncUserInterfacesView(
    {
      isTopFrame,
      inPagePanel,
      popupPorts,
      panelCollapsed,
      previewCollapsed,
      panelNotice,
      settings,
    },
    () => buildPreparedOutputSnapshot(),
    buildStatusSnapshot,
    requiresReload,
  );
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

function refreshStructuredHistoryState(): void {
  const configuredMax = Number(settings.maxBufferLength);
  const maxLength =
    Number.isFinite(configuredMax) && configuredMax >= 1000
      ? Math.floor(configuredMax)
      : PIPELINE_DEFAULTS.confirmedCompactMaxLength;
  state.confirmedCompact = buildConfirmedCompactHistory(state.entries, maxLength);
  state.trailingSuffix = state.confirmedCompact.slice(-PIPELINE_DEFAULTS.suffixLength);
  state.previewDesyncCount = 0;
  state.previewAmbiguousSkipCount = 0;
  state.lastCommittedResetAt = null;
  state.lastProcessedRaw = state.previewText;
}

function compactLiveLedgerMetadata(now: number): boolean {
  if (liveCaptureLedger.order.length === 0) {
    return false;
  }

  const activeRowKeys = new Set(liveCaptureLedger.activeRowKeys);
  let compactedRows: Record<string, LiveCaptureRow> | null = null;

  for (const key of liveCaptureLedger.order) {
    const row = liveCaptureLedger.rows[key];
    if (!row || activeRowKeys.has(key)) {
      continue;
    }
    if (now - row.updatedAt < INTERNAL_LEDGER_METADATA_STALE_MS) {
      continue;
    }

    const shouldCompact =
      row.framePath.length > 0 ||
      Boolean(row.selector) ||
      row.unstableKey ||
      row.baselineCompact !== null;
    if (!shouldCompact) {
      continue;
    }

    if (!compactedRows) {
      compactedRows = { ...liveCaptureLedger.rows };
    }

    compactedRows[key] = {
      ...row,
      framePath: [],
      selector: undefined,
      unstableKey: false,
      baselineCompact: null,
    };
  }

  if (!compactedRows) {
    return false;
  }

  liveCaptureLedger = {
    ...liveCaptureLedger,
    rows: compactedRows,
  };
  return true;
}

function compactInternalCaches(now: number): boolean {
  if (state.status !== "running") {
    return false;
  }
  if (now - lastInternalCacheCompactAt < INTERNAL_CACHE_COMPACT_INTERVAL_MS) {
    return false;
  }
  lastInternalCacheCompactAt = now;

  let changed = false;

  if (state.pendingPreviews.length > INTERNAL_CACHE_MAX_PENDING_PREVIEWS) {
    state.pendingPreviews = state.pendingPreviews.slice(-INTERNAL_CACHE_MAX_PENDING_PREVIEWS);
    changed = true;
  }

  if (
    liveCaptureLedger.order.length > 0 &&
    state.entries.length > INTERNAL_CACHE_MAX_STATE_ENTRIES
  ) {
    state.entries = state.entries
      .slice(-INTERNAL_CACHE_TARGET_STATE_ENTRIES)
      .map((entry) => cloneEntry(entry));
    refreshStructuredHistoryState();
    changed = true;
  }

  if (compactLiveLedgerMetadata(now)) {
    changed = true;
  }

  return changed;
}

function applyStructuredEntryMeta(
  entry: SubtitleEntry,
  row: LiveCaptureRow,
  nowIso: string,
  selector?: string,
  framePath?: number[],
): boolean {
  let changed = false;
  if (entry.endTime !== nowIso) {
    entry.endTime = nowIso;
    changed = true;
  }
  if (entry.sourceSelector !== selector) {
    entry.sourceSelector = selector;
    changed = true;
  }

  const nextFramePath =
    Array.isArray(framePath) && framePath.length > 0 ? [...framePath] : undefined;
  const prevFramePath = JSON.stringify(entry.sourceFramePath ?? []);
  const nextFramePathSignature = JSON.stringify(nextFramePath ?? []);
  if (prevFramePath !== nextFramePathSignature) {
    entry.sourceFramePath = nextFramePath;
    changed = true;
  }

  if (entry.sourceNodeKey !== row.key) {
    entry.sourceNodeKey = row.key;
    changed = true;
  }
  if (entry.speakerColor !== row.speakerColor) {
    entry.speakerColor = row.speakerColor;
    changed = true;
  }
  if (entry.speakerChannel !== row.speakerChannel) {
    entry.speakerChannel = row.speakerChannel;
    changed = true;
  }
  return changed;
}

function isLikelySameStructuredUtterance(previousText: string, nextText: string): boolean {
  const previousCompact = compactSubtitleText(previousText);
  const nextCompact = compactSubtitleText(nextText);
  if (!previousCompact || !nextCompact) {
    return false;
  }
  if (previousCompact === nextCompact) {
    return true;
  }

  const minSharedLength = Math.min(previousCompact.length, nextCompact.length);
  if (minSharedLength < 8) {
    return false;
  }

  return (
    previousCompact.startsWith(nextCompact) ||
    nextCompact.startsWith(previousCompact)
  );
}

function appendStructuredEntry(
  text: string,
  row: LiveCaptureRow,
  nowIso: string,
  selector?: string,
  framePath?: number[],
): { entry: SubtitleEntry; changed: boolean } {
  const compact = compactSubtitleText(text);
  const lastEntry = state.entries.at(-1);
  if (lastEntry && compactSubtitleText(lastEntry.text) === compact) {
    const textChanged = lastEntry.text !== text;
    if (textChanged) {
      lastEntry.text = text;
    }
    const metaChanged = applyStructuredEntryMeta(lastEntry, row, nowIso, selector, framePath);
    return { entry: lastEntry, changed: textChanged || metaChanged };
  }

  const entry: SubtitleEntry = {
    id: createId("subtitle"),
    text,
    timestamp: nowIso,
    startTime: nowIso,
    endTime: nowIso,
    sourceSelector: selector,
    sourceFramePath: Array.isArray(framePath) && framePath.length > 0 ? [...framePath] : undefined,
    sourceNodeKey: row.key,
    speakerColor: row.speakerColor,
    speakerChannel: row.speakerChannel,
  };
  state.entries.push(entry);
  return { entry, changed: true };
}

function upsertStructuredRowEntry(
  row: LiveCaptureRow,
  now: number,
  selector?: string,
  framePath?: number[],
): { changed: boolean; entry: SubtitleEntry | null } {
  const nextText = normalizeSubtitleText(row.text);
  if (!nextText) {
    return {
      changed: false,
      entry: null,
    };
  }

  const nowIso = new Date(now).toISOString();
  const committedEntryId = row.committedEntryId;
  if (committedEntryId) {
    const existing = state.entries.find((entry) => entry.id === committedEntryId);
    if (existing && isLikelySameStructuredUtterance(existing.text, nextText)) {
      const textChanged = existing.text !== nextText;
      if (textChanged) {
        existing.text = nextText;
      }
      const metaChanged = applyStructuredEntryMeta(existing, row, nowIso, selector, framePath);
      return {
        changed: textChanged || metaChanged,
        entry: existing,
      };
    }
  }

  const appended = appendStructuredEntry(nextText, row, nowIso, selector, framePath);
  return {
    changed: appended.changed,
    entry: appended.entry,
  };
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
  let entryChanged = false;

  reconciliation.rowChanges.forEach((rowChange) => {
    const liveRow = getLiveRow(liveCaptureLedger, rowChange.key);
    if (!liveRow) {
      return;
    }

    const result = upsertStructuredRowEntry(liveRow, now, selector, framePath);
    if (result.changed) {
      entryChanged = true;
    }
    if (result.entry) {
      liveCaptureLedger = syncLiveRowOutputEntry(
        liveCaptureLedger,
        rowChange.key,
        result.entry,
      );
    }
  });

  if (entryChanged) {
    state.updatedAt = new Date(now).toISOString();
    state.lastObserverEventAt = now;
    refreshStructuredHistoryState();
    changed = true;
  }

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
    try {
      await deleteSession(record.id);
      failedStoppedSessionGuard = clearFailedStoppedSessionGuard();
      state.lastPersistedAt = null;
    } catch (error) {
      reportRuntimeError("빈 종료 세션 정리에 실패했습니다.", error);
    }
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

  void persistQueuedPageExitRecord(record, {
    queueRecord: queueExitPersistRecord,
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
  const eligibility = buildPreparedOutputSnapshot().eligibility;
  if (!isTopFrame || !eligibility.canPersistPreparedContent) {
    const message = "저장할 자막이 아직 없습니다.";
    setPanelNotice(message);
    return {
      saved: false,
      message,
    };
  }

  const record = buildPreparedSessionRecord("saved");
  if (!record.entries.length) {
    const message = "저장할 자막이 아직 없습니다.";
    setPanelNotice(message);
    return {
      saved: false,
      message,
    };
  }

  try {
    const saved = await saveSession(record);
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
        selectors: getSubtitleSelectorCandidates("", [], state.sourceUrl || window.location.href),
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
      return;
    }

    const hasStructuredRows =
      captureEvent.captureMode === "structured" && captureEvent.rows.length > 0;
    const hasStableStructuredRows = hasStructuredRows && hasOnlyStableRows(captureEvent.rows);
    const noticeChanged = setPanelNotice(
      resolveRuntimeCaptureNotice({
        captureMode: captureEvent.captureMode,
        observerActive: state.observerActive,
        hasStableRows: hasStableStructuredRows,
        lastCommittedResetAt: state.lastCommittedResetAt,
        now,
      }),
    );

    if (hasStructuredRows) {
      let changed = applyStructuredRowsEvent(
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
        compactInternalCaches(now);
        scheduleRunningPersist();
        syncUserInterfaces();
        return;
      }

      const compacted = compactInternalCaches(now);
      if (compacted) {
        changed = true;
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
      compactInternalCaches(now);
      scheduleRunningPersist();
      syncUserInterfaces();
      return;
    }

    const result = applyPreview(state, normalized, now, settings, {
      selector: event.selector,
      framePath: event.framePath,
    });
    state = result.state;
    const compacted = compactInternalCaches(now);
    if (result.changed) {
      scheduleRunningPersist();
    }
    if (fallbackReconciliation.changed || result.changed || noticeChanged || compacted) {
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
        sourceUrl: state.sourceUrl || window.location.href,
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
      sourceUrl: state.sourceUrl || window.location.href,
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
  state = createResetSessionState(
    window.location.href,
    document.title,
    deriveCommitteeNameFromTitle(document.title),
  );
  lastInternalCacheCompactAt = 0;
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
  state.committeeName = deriveCommitteeNameFromTitle(document.title);
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
  const record = buildPreparedSessionRecord(state.status === "running" ? "running" : "stopped");
  if (!record.entries.length) {
    setPanelNotice("먼저 자막을 모은 뒤 파일로 저장하세요.");
    syncUserInterfaces();
    return;
  }

  const payload = await exportSessionData(
    record,
    format,
    settings.filenamePattern,
    undefined,
    settings.exportTxtWithoutTimestamps,
  );
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
  return openInPagePanelController({
    panelCollapsed,
    setPanelCollapsed: (collapsed) => {
      panelCollapsed = collapsed;
    },
    setPanelNotice: (message) => {
      setPanelNotice(message);
    },
    syncUserInterfaces: () => {
      syncUserInterfaces();
    },
  });
}

function collapseInPagePanel(): void {
  collapseInPagePanelController({
    panelCollapsed,
    setPanelCollapsed: (collapsed) => {
      panelCollapsed = collapsed;
    },
    setPanelNotice: (message) => {
      setPanelNotice(message);
    },
    syncUserInterfaces: () => {
      syncUserInterfaces();
    },
  });
}

function mountInPagePanel(): void {
  inPagePanel = mountInPagePanelController({
    isTopFrame,
    inPagePanel,
    setInPagePanel: (panel) => {
      inPagePanel = panel;
    },
    confirmSessionClear,
    setPanelNotice: (message) => {
      setPanelNotice(message);
    },
    syncUserInterfaces: () => {
      syncUserInterfaces();
    },
    updateInPagePanel: () => {
      updateInPagePanel();
    },
    reportRuntimeError,
    startCapture,
    stopCapture,
    clearSessionAndReset,
    saveCurrentSessionSnapshot: async () => {
      await saveCurrentSessionSnapshot();
    },
    exportCurrentSession,
    copyRecentSessionLines,
    openHistoryPage,
    openOptionsPage,
    openDiagnosticsPage,
    openInPagePanel,
    collapseInPagePanel,
    previewCollapsed,
    setPreviewCollapsed: (collapsed) => {
      previewCollapsed = collapsed;
    },
  });
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
    if (!shouldWarnBeforeUnload(isTopFrame, buildPreparedOutputSnapshot().eligibility)) {
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
  state.committeeName = deriveCommitteeNameFromTitle(document.title);
  bindBridgeMessages();
  bindPopupPort();
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

export async function bootstrapContentScript(): Promise<void> {
  await bootstrap().catch((error: unknown) => {
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

