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
  markLiveRowCommitted,
  normalizeCaptureEvent,
  reconcileLiveCapture,
  setLiveRowBaseline,
  syncLiveRowOutputEntry,
  type LiveCaptureRow,
} from "../../core/live-capture";
import {
  cloneEntry,
  cloneSessionRecord,
  createEmptySessionState,
  type SessionRecord,
  type SessionState,
} from "../../core/subtitle-models";
import {
  EXTENSION_STORAGE_KEY,
  OBSERVER_ACTIVATE_EVENT,
  isAssemblyPlenaryUrl,
  PIPELINE_DEFAULTS,
} from "../../shared/constants";
import {
  applyPersistSuccess,
  clearScheduledRunningPersist,
  hasPersistableRunningContent,
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
  ObservedSubtitleRow,
  PopupToContentMessage,
  TabCommandResponse,
} from "../../shared/message-types";
import type { CaptureCoordinator } from "../capture-coordinator";
import { createCaptureCoordinator } from "../capture-coordinator";
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
import {
  deleteSession,
  exportSessionData,
  saveSession,
  updateRunningSession,
} from "../../storage/session-store";
import {
  queueExitPersistRecord,
  recordStopPersistSuccess,
} from "../../storage/persist-recovery";
import { getSettings, sanitizeSettings } from "../../storage/settings-store";
import type { ExtensionSettings } from "../../storage/types";
import { tryDomSubtitleActivation, waitForSubtitleLayer } from "../subtitle-layer";
import { deriveCommitteeNameFromTitle } from "../committee-name";
import { persistQueuedPageExitRecord } from "../page-exit-persist";
import { createResetSessionState } from "../session-lifecycle";
import { hasOnlyStableRows, resolveRuntimeCaptureNotice } from "../subtitle-event-handler";
import { commitStructuredLiveRow } from "./structured-row-commit";
import {
  collapseInPagePanelController,
  mountInPagePanelController,
  openInPagePanelController,
} from "./panel-controller";
import {
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
  isExtensionContextInvalidatedError,
} from "./runtime-helpers";

const isTopFrame = window.top === window;
const injectedActivationScriptId = "assembly-subtitle-activation-script";
let settings: ExtensionSettings = createDefaultSettings();
let state: SessionState = createEmptySessionState(window.location.href, document.title);
let persistTimer: number | null = null;
let pendingResetTimer: number | null = null;
let panelCollapsed = false;
let previewCollapsed = true;
let panelNotice = DEFAULT_IN_PAGE_NOTICE;
let inPagePanel: InPagePanelController | null = null;
let captureCoordinator: CaptureCoordinator | null = null;
let lastSubtitleActivationAttemptAt = 0;
let lastNavigationSnapshotAt = 0;
let liveCaptureLedger = createEmptyLiveCaptureLedger();
let extensionContextInvalidated = false;
let failedStoppedSessionGuard = createEmptyFailedStoppedSessionGuard();
let lastInternalCacheCompactAt = 0;
let persistContextOverride: "idle" | "running_autosave" | "stopped_final_save" | "page_exit_checkpoint" | null =
  null;
let stopPersistInFlight = false;
let pendingStopPersistRecord: SessionRecord | null = null;

function setPanelNotice(message: string): boolean {
  if (panelNotice === message) {
    return false;
  }
  panelNotice = message;
  return true;
}

function shutdownForInvalidatedContext(): void {
  if (extensionContextInvalidated) {
    return;
  }

  extensionContextInvalidated = true;
  captureCoordinator?.stop();
  clearRunningPersistTimer();
  clearPendingReset();
  state.observerActive = false;
}

function reportRuntimeError(message: string, error?: unknown): void {
  if (isExtensionContextInvalidatedError(error)) {
    shutdownForInvalidatedContext();
    message = INVALIDATED_CONTEXT_NOTICE;
  }

  console.warn(`[assembly-subtitle] ${message}`, error);
  setPanelNotice(message);
  updateInPagePanel();
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

function shouldForceNewFallbackEntry(): boolean {
  return isAssemblyPlenaryUrl(state.sourceUrl || window.location.href);
}

function buildPreparedOutputSnapshot(now = Date.now()) {
  return buildPreparedOutputSnapshotView(
    liveCaptureLedger,
    state,
    state.sourceUrl || window.location.href,
    settings,
    now,
  );
}

function resolvePersistContext():
  | "idle"
  | "running_autosave"
  | "stopped_final_save"
  | "page_exit_checkpoint" {
  if (stopPersistInFlight) {
    return "stopped_final_save";
  }
  if (persistContextOverride) {
    return persistContextOverride;
  }
  if (
    state.status === "running" &&
    settings.runningAutoSaveEnabled &&
    hasPersistableRunningContent(state)
  ) {
    return "running_autosave";
  }
  if (pendingStopPersistRecord?.entries.length) {
    return "page_exit_checkpoint";
  }
  return "idle";
}

function buildStatusSnapshot(requiresReload = false) {
  return buildStatusSnapshotView(
    window.location.href,
    liveCaptureLedger,
    state,
    settings,
    resolvePersistContext(),
    stopPersistInFlight,
    requiresReload,
  );
}

function buildPreparedSessionState(now = Date.now()) {
  return buildPreparedSessionStateView(
    liveCaptureLedger,
    state,
    state.sourceUrl || window.location.href,
    settings,
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
      panelCollapsed,
      previewCollapsed,
      panelNotice,
      settings,
    },
    () => buildPreparedOutputSnapshot(),
    buildStatusSnapshot,
  );
  void requiresReload;
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
  state.observerActive = false;
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

    const result = commitStructuredLiveRow({
      state,
      row: liveRow,
      previewText: captureEvent.previewText,
      now,
      settings,
      selector,
      framePath,
    });
    state = result.state;
    if (result.changed) {
      entryChanged = true;
    }
    if (result.entry) {
      if (result.baselineCompact !== null) {
        liveCaptureLedger = setLiveRowBaseline(
          liveCaptureLedger,
          rowChange.key,
          result.baselineCompact,
        );
      }
      liveCaptureLedger = markLiveRowCommitted(
        liveCaptureLedger,
        rowChange.key,
        result.entry.id,
      );
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
      pendingStopPersistRecord = null;
      stopPersistInFlight = false;
      persistContextOverride = null;
    } catch (error) {
      reportRuntimeError("빈 종료 세션 정리에 실패했습니다.", error);
    }
    return;
  }

  try {
    const saved = await saveSession(record);
    failedStoppedSessionGuard = clearFailedStoppedSessionGuard();
    state = applyPersistSuccess(state, saved.updatedAt);
    pendingStopPersistRecord = null;
    stopPersistInFlight = false;
    persistContextOverride = null;
    await recordStopPersistSuccess("direct", saved.updatedAt);
    setPanelNotice("모든 자막을 저장했습니다.");
  } catch (error) {
    failedStoppedSessionGuard = rememberFailedStoppedSession(record, error);
    pendingStopPersistRecord = cloneSessionRecord(record);
    stopPersistInFlight = false;
    persistContextOverride = pendingStopPersistRecord.entries.length ? "page_exit_checkpoint" : null;
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
          return;
        }

        if (record.status === "stopped" && state.sessionId === record.id) {
          state = applyPersistSuccess(state, record.updatedAt);
          pendingStopPersistRecord = null;
          persistContextOverride = null;
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

function resolveStoppedExitPersistRecord(now = Date.now()): SessionRecord | null {
  if (pendingStopPersistRecord?.entries.length) {
    return cloneSessionRecord(pendingStopPersistRecord);
  }

  if (!canPersistCurrentRunningState()) {
    return null;
  }

  const record = buildPreparedSessionRecord("stopped", now);
  return record.entries.length > 0 ? record : null;
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
  if (extensionContextInvalidated || !isTopFrame) {
    return;
  }

  clearRunningPersistTimer();
  const record = resolveStoppedExitPersistRecord(now);
  if (!record?.entries.length) {
    return;
  }

  persistContextOverride = "page_exit_checkpoint";
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
    if (state.status !== "running" && pendingStopPersistRecord?.id === saved.id) {
      pendingStopPersistRecord = null;
      persistContextOverride = null;
      stopPersistInFlight = false;
      await recordStopPersistSuccess("direct", saved.updatedAt);
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

async function ensureActivationHelperInjected(): Promise<void> {
  if (document.getElementById(injectedActivationScriptId)) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.id = injectedActivationScriptId;
    script.src = chrome.runtime.getURL("injected-observer.js");
    script.async = false;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to inject activation helper"));
    (document.head || document.documentElement).appendChild(script);
  });
}

function requestSubtitleLayerActivation(): void {
  lastSubtitleActivationAttemptAt = Date.now();
  tryDomSubtitleActivation();
  void ensureActivationHelperInjected()
    .then(() => {
      window.dispatchEvent(new CustomEvent(OBSERVER_ACTIVATE_EVENT));
    })
    .catch((error: unknown) => {
      logDebug("activation helper inject failed", error);
    });
}

async function ensureSubtitleLayerActive(): Promise<boolean> {
  requestSubtitleLayerActivation();
  const layer = await waitForSubtitleLayer({
    timeoutMs: Math.max(1200, settings.pollingFallbackIntervalMs * 10),
    intervalMs: Math.max(80, settings.pollingFallbackIntervalMs),
  });
  return layer.visible && (layer.hasText || layer.controlActive);
}

function handleCaptureObservation(input: {
  raw?: string;
  rows?: ObservedSubtitleRow[];
  selector?: string;
  framePath?: number[];
  now: number;
  observerActive: boolean;
}): void {
  if (!isTopFrame) {
    return;
  }

  try {
    state.observerActive = input.observerActive;
    if (input.selector) {
      state.currentSelector = input.selector;
    }
    if (input.framePath) {
      state.currentFramePath = [...input.framePath];
    }

    const now = input.now || Date.now();
    state.lastObserverEventAt = now;
    if (state.status !== "running") {
      return;
    }

    clearPendingReset();
    const captureEvent = normalizeCaptureEvent({
      raw: input.raw,
      rows: input.rows,
      selector: input.selector,
      framePath: input.framePath,
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
        input.selector,
        input.framePath,
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
      selector: input.selector,
      framePath: input.framePath,
      forceNewEntry: shouldForceNewFallbackEntry(),
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

function handleCaptureReset(now = Date.now(), observerActive = false): void {
  if (!isTopFrame) {
    return;
  }

  state.observerActive = observerActive;
  state.lastObserverEventAt = now;
  if (state.status !== "running") {
    return;
  }

  scheduleDeferredSubtitleReset();
}

function createOrGetCaptureCoordinator(): CaptureCoordinator {
  if (captureCoordinator) {
    return captureCoordinator;
  }

  captureCoordinator = createCaptureCoordinator({
    getPrimarySelector: () => state.currentSelector,
    getPollingIntervalMs: () => settings.pollingFallbackIntervalMs,
    getProbeOptions: () => ({
      filterUnconfirmedEnabled: settings.filterUnconfirmedEnabled,
      sourceUrl: state.sourceUrl || window.location.href,
    }),
    onUpdate: ({ probe, now, observerActive }) => {
      handleCaptureObservation({
        raw: probe.text,
        rows: probe.rows,
        selector: probe.matchedSelector,
        framePath: probe.framePath,
        now,
        observerActive,
      });
    },
    onReset: ({ now, observerActive }) => {
      handleCaptureReset(now, observerActive);
    },
    onMiss: () => {
      if (
        state.status === "running" &&
        Date.now() - lastSubtitleActivationAttemptAt >= 2000
      ) {
        requestSubtitleLayerActivation();
      }
    },
    onError: (error) => {
      reportRuntimeError("자막 DOM coordinator 처리 중 오류가 발생했습니다.", error);
    },
  });

  return captureCoordinator;
}

function startCaptureCoordinator(): void {
  if (!isTopFrame || extensionContextInvalidated) {
    return;
  }

  createOrGetCaptureCoordinator().start();
}

function refreshCaptureCoordinator(): void {
  if (!isTopFrame || extensionContextInvalidated || !captureCoordinator) {
    return;
  }

  if (state.status !== "running") {
    captureCoordinator.stop();
    state.observerActive = false;
    return;
  }

  captureCoordinator.refresh();
  captureCoordinator.scheduleTick(0);
}

function resetRuntimeState(): void {
  captureCoordinator?.stop();
  clearRunningPersistTimer();
  clearStructuredRuntimeState();
  state = createResetSessionState(
    window.location.href,
    document.title,
    deriveCommitteeNameFromTitle(document.title),
  );
  lastInternalCacheCompactAt = 0;
  lastSubtitleActivationAttemptAt = 0;
  lastNavigationSnapshotAt = 0;
  persistContextOverride = null;
  stopPersistInFlight = false;
  pendingStopPersistRecord = null;
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
  pendingStopPersistRecord = resolution.guard.record ? cloneSessionRecord(resolution.guard.record) : null;
  stopPersistInFlight = false;
  if (!pendingStopPersistRecord) {
    persistContextOverride = null;
  }

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
      pendingStopPersistRecord = null;
      persistContextOverride = null;
      stopPersistInFlight = false;
      await recordStopPersistSuccess("direct", saved.updatedAt);
      return true;
    } catch (error) {
      failedStoppedSessionGuard = rememberFailedStoppedSession(stoppedRecord, error);
      pendingStopPersistRecord = cloneSessionRecord(stoppedRecord);
      persistContextOverride = "page_exit_checkpoint";
      stopPersistInFlight = false;
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
  startCaptureCoordinator();
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
  captureCoordinator?.stop();
  clearRunningPersistTimer();
  clearPendingReset();
  const now = Date.now();
  const stoppedRecord = buildPreparedSessionRecord("stopped", now);
  pendingStopPersistRecord = cloneSessionRecord(stoppedRecord);
  stopPersistInFlight = stoppedRecord.entries.length > 0;
  persistContextOverride = stopPersistInFlight ? "stopped_final_save" : null;

  if (stopPersistInFlight) {
    try {
      await queueExitPersistRecord(stoppedRecord);
    } catch (error) {
      console.warn("[assembly-subtitle] Failed to queue stop checkpoint before final save", error);
    }
  }

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

async function handleTabCommand(
  message: PopupToContentMessage,
): Promise<TabCommandResponse> {
  switch (message.type) {
    case "GET_STATUS":
      return {
        ok: true,
        snapshot: buildStatusSnapshot(false),
      };
    case "OPEN_INPAGE_PANEL": {
      const feedback = openInPagePanel();
      return {
        ok: true,
        feedback,
        snapshot: buildStatusSnapshot(false),
      };
    }
    case "START_CAPTURE":
      await startCapture();
      return {
        ok: true,
        snapshot: buildStatusSnapshot(false),
      };
    case "STOP_CAPTURE":
      await stopCapture();
      return {
        ok: true,
        snapshot: buildStatusSnapshot(false),
      };
    case "CLEAR_SESSION":
      if (!confirmSessionClear()) {
        setPanelNotice("세션 비우기를 취소했습니다.");
        syncUserInterfaces();
        return {
          ok: true,
          snapshot: buildStatusSnapshot(false),
        };
      }
      await clearSessionAndReset();
      return {
        ok: true,
        snapshot: buildStatusSnapshot(false),
      };
    case "SAVE_SESSION":
      {
        const result = await saveCurrentSessionSnapshot();
        syncUserInterfaces();
        return {
          ok: true,
          snapshot: buildStatusSnapshot(false),
          feedback: result.message
            ? {
                command: "SAVE_SESSION",
                message: result.message,
              }
            : undefined,
        };
      }
    case "EXPORT_REQUEST":
      await exportCurrentSession(message.format);
      return {
        ok: true,
        snapshot: buildStatusSnapshot(false),
      };
  }
}

function bindTabMessages(): void {
  if (!isTopFrame) {
    return;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const typedMessage = message as PopupToContentMessage;
    if (
      typedMessage.type === "GET_STATUS" ||
      typedMessage.type === "OPEN_INPAGE_PANEL" ||
      typedMessage.type === "START_CAPTURE" ||
      typedMessage.type === "STOP_CAPTURE" ||
      typedMessage.type === "CLEAR_SESSION" ||
      typedMessage.type === "SAVE_SESSION" ||
      typedMessage.type === "EXPORT_REQUEST"
    ) {
      void handleTabCommand(typedMessage)
        .then(sendResponse)
        .catch((error: unknown) => {
          sendResponse({
            ok: false,
            error:
              error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.",
            snapshot: buildStatusSnapshot(false),
          } satisfies TabCommandResponse);
        });
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

    refreshCaptureCoordinator();

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
      if (stopPersistInFlight || pendingStopPersistRecord?.entries.length) {
        persistStoppedSnapshotForPageExit();
      } else {
        persistRunningSnapshotForVisibilityChange();
      }
    }
  });

  window.addEventListener("pagehide", (event) => {
    const pageTransitionEvent = event as PageTransitionEvent;
    if (pageTransitionEvent.persisted) {
      if (stopPersistInFlight || pendingStopPersistRecord?.entries.length) {
        persistStoppedSnapshotForPageExit();
      } else {
        persistRunningSnapshotForVisibilityChange();
      }
      return;
    }
    persistStoppedSnapshotForPageExit();
  });

  window.addEventListener("beforeunload", (event) => {
    const shouldWarn =
      stopPersistInFlight || shouldWarnBeforeUnload(isTopFrame, buildPreparedOutputSnapshot().eligibility);
    if (!shouldWarn) {
      return;
    }

    if (stopPersistInFlight || pendingStopPersistRecord?.entries.length) {
      persistStoppedSnapshotForPageExit();
    } else {
      persistRunningSnapshotForVisibilityChange();
    }
    event.preventDefault();
    event.returnValue = "";
  });
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

  state.title = document.title;
  state.committeeName = deriveCommitteeNameFromTitle(document.title);
  bindTabMessages();
  bindSettingsChanges();
  bindNavigationGuards();
  mountInPagePanel();
  updateInPagePanel();
  if (extensionContextInvalidated) {
    return;
  }

  syncUserInterfaces();
  logDebug("content script bootstrapped", {
    isTopFrame,
    captureRuntime: "top-frame-dom-coordinator",
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
  });
}

