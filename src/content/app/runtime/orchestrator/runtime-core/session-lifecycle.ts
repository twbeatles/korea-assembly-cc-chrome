
import { finalizeSession } from "../../../../../core/subtitle-pipeline";
import { resetLiveCaptureLedgerForNewSegment } from "../../../../../core/live-capture";

import { OBSERVER_STOP_EVENT } from "../../../../../shared/constants";

import { applyPersistSuccess } from "../../../../autosave";
import { confirmDestructiveAction } from "../../../../../shared/accessible-confirm";

import { DUPLICATE_START_CAPTURE_NOTICE, shouldIgnoreStartCapture, shouldRunDeferredCaptureStart } from "../../../../runtime/capture-start";

import { clearAutoStartCooldown, hasAutoStartCooldown, rememberAutoStartCooldown } from "../../../../runtime/autostart-cooldown";

import { rememberFailedStoppedSession, resolveFailedStoppedSessionGuard } from "../../../../failed-stopped-session";

import { createResetSessionState } from "../../../../session-lifecycle";

import { buildRolledOverRunningSessionState, buildSegmentRolloverNotice } from "../../../../runtime/segment-rollover";

import { type RuntimeSessionSegmentationReason } from "../../../../runtime/segmentation-policy";

import { isTopFrame } from "../../constants";

import { isCapturePage, resolveDefaultPanelNotice, deriveCommitteeName } from "../helpers";
import type { RuntimeCoreContext } from "./context";
import { clearLocalPolling, clearPendingReset, clearRunningPersistTimer, clearTopFallbackTimer } from "./timers";
import { logDebug, reportRuntimeError, setPanelNotice } from "./notices";
import { getLivePreviewText, setPersistabilityState, syncUserInterfaces } from "./panel-status";
import { buildPreparedSessionRecord } from "./snapshots";
import { claimCaptureOwnershipForStart, releaseCaptureOwnershipForStop } from "./ownership";
import { deletePersistedSession, persistSessionRecord, persistStoppedSession, scheduleRunningPersist } from "./persistence";
import { clearFallbackCommitCandidate } from "./fallback-commit";
import { clearStructuredRuntimeState, flushQueuedSegmentRolloverEvent, handleTopFrameEvent } from "./capture-events";
import { dispatchObserverConfig, ensureSubtitleLayerActive, injectObserverScript } from "./observer-bridge";
import { startLocalPolling, startTopFrameFallback } from "./polling";

/** 수집 시작·중지·리셋·세그먼트 전환과 URL 재조정 (단일 책임: 세션 수명주기). */
export async function confirmSessionClear(): Promise<boolean> {
  return confirmDestructiveAction("현재 세션 기록을 비우고 다시 시작할까요?", {
    title: "화면 비우기",
    confirmLabel: "비우기",
    cancelLabel: "취소",
  });
}

export async function confirmFailedStoppedSessionDiscard(ctx: RuntimeCoreContext, message: string): Promise<boolean> {
  return confirmDestructiveAction(message, {
    title: "저장 실패 세션",
    confirmLabel: "버리고 계속",
    cancelLabel: "유지",
  });
}

export async function ensureFailedStoppedSessionResolved(ctx: RuntimeCoreContext, 
  actionLabel: string,
): Promise<boolean> {
  const resolution = await resolveFailedStoppedSessionGuard({
    actionLabel,
    guard: ctx.failedStoppedSessionGuard,
    persistRecord: (record) => persistSessionRecord(ctx, record),
    confirmDiscard: (message) => confirmFailedStoppedSessionDiscard(ctx, message),
  });

  ctx.failedStoppedSessionGuard = resolution.guard;

  if (
    resolution.persistedRecord &&
    ctx.state.sessionId === resolution.persistedRecord.id
  ) {
    ctx.state = applyPersistSuccess(ctx.state, resolution.persistedRecord.updatedAt);
  }

  if (resolution.notice) {
    setPanelNotice(ctx, resolution.notice);
    syncUserInterfaces(ctx);
  }

  return resolution.proceed;
}

export async function ensureCurrentRunningSessionPreservedBeforeReset(ctx: RuntimeCoreContext): Promise<boolean> {
  if (!isTopFrame || ctx.state.status !== "running") {
    return true;
  }

  const sessionId = ctx.state.sessionId;
  const stoppedRecord = buildPreparedSessionRecord(ctx, "stopped");
  if (stoppedRecord.entries.length > 0) {
    try {
      const saved = await persistSessionRecord(ctx, stoppedRecord);
      ctx.state = applyPersistSuccess(ctx.state, saved.updatedAt);
      return true;
    } catch (error) {
      ctx.failedStoppedSessionGuard = rememberFailedStoppedSession(
        stoppedRecord,
        error,
      );
      reportRuntimeError(ctx, 
        "세션 초기화 전에 이전 실행 세션 저장에 실패했습니다.",
        error,
      );
      return false;
    }
  }

  try {
    await deletePersistedSession(ctx, sessionId);
    return true;
  } catch (error) {
    reportRuntimeError(ctx, 
      "세션 초기화 전에 이전 실행 세션 정리에 실패했습니다.",
      error,
    );
    return false;
  }
}

export function resetRuntimeState(ctx: RuntimeCoreContext): void {
  clearRunningPersistTimer(ctx);
  clearStructuredRuntimeState(ctx);
  ctx.segmentRolloverToken += 1;
  ctx.queuedSegmentRolloverEvents = [];
  ctx.segmentRolloverInFlight = false;
  setPersistabilityState(ctx, "idle");
  ctx.state = createResetSessionState(
    window.location.href,
    document.title,
    deriveCommitteeName(document.title),
  );
  ctx.topFallbackMissStreak = 0;
  ctx.localPollingUnconfirmedFallbackBlockStreak = 0;
  ctx.topFallbackUnconfirmedFallbackBlockStreak = 0;
  ctx.lastSuccessfulFallbackFramePath = null;
  ctx.lastSubtitleActivationAttemptAt = 0;
  ctx.lastNavigationSnapshotAt = 0;
  setPanelNotice(ctx, resolveDefaultPanelNotice());
}

export function stopCapturePipelineForCurrentPage(ctx: RuntimeCoreContext): void {
  clearLocalPolling(ctx);
  clearTopFallbackTimer(ctx);
  clearFallbackCommitCandidate(ctx);
  ctx.capturePipelineStarted = false;
  try {
    window.dispatchEvent(new CustomEvent(OBSERVER_STOP_EVENT));
  } catch {
    // no-op
  }
}

export async function startCapturePipelineForCurrentPage(ctx: RuntimeCoreContext): Promise<void> {
  if (ctx.extensionContextInvalidated || !isCapturePage()) {
    stopCapturePipelineForCurrentPage(ctx);
    return;
  }

  if (!ctx.capturePipelineStarted) {
    try {
      await injectObserverScript(ctx);
    } catch (error) {
      reportRuntimeError(ctx, 
        "MutationObserver 주입에 실패해 polling fallback으로 계속 진행합니다.",
        error,
      );
    }
    ctx.capturePipelineStarted = true;
  } else {
    dispatchObserverConfig(ctx);
  }

  if (ctx.extensionContextInvalidated) {
    return;
  }

  startLocalPolling(ctx);
  startTopFrameFallback(ctx);
  syncUserInterfaces(ctx);

  if (
    isTopFrame &&
    ctx.settings.autoStartEnabled &&
    !hasAutoStartCooldown(isTopFrame) &&
    ctx.state.status !== "running"
  ) {
    // reconcile 등 상위 lifecycle lock 안에서도 호출될 수 있다.
    // unlocked 직접 호출은 await 양보 구간에서 stop/clear와 인터리브되므로,
    // 동일 큐에 "start"를 예약만 하고 await 하지 않는다(중첩 deadlock 방지).
    const startUrl = window.location.href;
    void ctx.captureLifecycleLock
      .run("start", () => {
        if (
          !shouldRunDeferredCaptureStart({
            requestedUrl: startUrl,
            currentUrl: window.location.href,
            isCapturePage: isCapturePage(),
          })
        ) {
          return Promise.resolve();
        }
        return startCaptureUnlocked(ctx);
      })
      .catch(
      (error: unknown) => {
        reportRuntimeError(ctx, 
          "자동 시작 설정에 따라 자막 모으기를 시도했으나 실패했습니다.",
          error,
        );
      },
    );
  }
}

/**
 * URL 전환 reconcile 본체.
 * 성공 시에만 ctx.urlReconcileController 가 lastKnownUrl 을 커밋한다.
 * stop/start 는 unlocked 경로를 사용해 lifecycle lock 중첩 deadlock 을 피한다.
 */
export async function performUrlReconcile(ctx: RuntimeCoreContext, currentUrl: string): Promise<void> {
  const previousUrl = ctx.urlReconcileController.getLastKnownUrl();
  const urlChanged = currentUrl !== previousUrl;
  if (!urlChanged && ctx.capturePipelineStarted === isCapturePage()) {
    return;
  }

  if (urlChanged && ctx.state.status === "running") {
    try {
      await stopCaptureUnlocked(ctx);
    } catch (error) {
      reportRuntimeError(ctx, 
        "페이지 이동 전 실행 중인 세션 저장에 실패했습니다.",
        error,
      );
      throw error instanceof Error
        ? error
        : new Error("페이지 이동 전 세션 저장에 실패했습니다.");
    }
  }

  if (urlChanged && ctx.state.status !== "running") {
    resetRuntimeState(ctx);
  }

  setPanelNotice(ctx, resolveDefaultPanelNotice());
  if (!isCapturePage()) {
    stopCapturePipelineForCurrentPage(ctx);
    syncUserInterfaces(ctx);
    logDebug(ctx, "capture pipeline stopped after URL change", {
      previousUrl,
      currentUrl,
    });
    return;
  }

  await startCapturePipelineForCurrentPage(ctx);
}

export async function clearSessionAndResetUnlocked(ctx: RuntimeCoreContext): Promise<void> {
  if (!(await ensureFailedStoppedSessionResolved(ctx, "clear session"))) {
    return;
  }
  if (!(await ensureCurrentRunningSessionPreservedBeforeReset(ctx))) {
    return;
  }
  resetRuntimeState(ctx);
  ctx.lastSegmentCapacityWarningReason = null;
  rememberAutoStartCooldown(isTopFrame);
  setPanelNotice(ctx, "화면을 비우고 새로 시작할 준비를 마쳤습니다.");
  syncUserInterfaces(ctx);
}

export async function clearSessionAndReset(ctx: RuntimeCoreContext): Promise<void> {
  return ctx.captureLifecycleLock.run("clear", () => clearSessionAndResetUnlocked(ctx));
}

export async function startCaptureUnlocked(ctx: RuntimeCoreContext): Promise<void> {
  if (!isCapturePage()) {
    setPanelNotice(ctx, 
      "국회 의사중계 플레이어 페이지에서만 자막 수집을 시작할 수 있습니다.",
    );
    syncUserInterfaces(ctx);
    return;
  }
  if (shouldIgnoreStartCapture(ctx.state.status)) {
    setPanelNotice(ctx, DUPLICATE_START_CAPTURE_NOTICE);
    syncUserInterfaces(ctx);
    return;
  }
  if (!(await ensureFailedStoppedSessionResolved(ctx, "자막 수집 시작"))) {
    return;
  }
  if (!(await ensureCurrentRunningSessionPreservedBeforeReset(ctx))) {
    return;
  }
  resetRuntimeState(ctx);
  ctx.lastSegmentCapacityWarningReason = null;
  clearAutoStartCooldown(isTopFrame);
  const now = new Date().toISOString();
  ctx.panelCollapsed = false;
  ctx.state.status = "running";
  ctx.state.createdAt = now;
  ctx.state.startedAt = now;
  ctx.state.updatedAt = now;
  ctx.state.title = document.title;
  ctx.state.committeeName = deriveCommitteeName(document.title);
  const multiTabCaptureWarning = await claimCaptureOwnershipForStart(ctx);
  const startNotice = multiTabCaptureWarning
    ? "자막 모으기를 시작했습니다. 다른 탭에서도 수집 중일 수 있어 기록이 둘로 나뉠 수 있습니다."
    : "자막 모으기를 시작했습니다. 페이지를 이동하거나 닫으려고 하면 수집을 중단하고, 종료 직전에 자동 저장을 시도합니다.";
  setPanelNotice(ctx, startNotice);
  dispatchObserverConfig(ctx);
  syncUserInterfaces(ctx);

  const subtitleLayerReady = await ensureSubtitleLayerActive(ctx).catch(
    (error: unknown) => {
      reportRuntimeError(ctx, "AI 자막 레이어를 자동으로 열지 못했습니다.", error);
      return false;
    },
  );
  if (!subtitleLayerReady) {
    setPanelNotice(ctx, 
      multiTabCaptureWarning
        ? "자막 모으기를 시작했습니다. 다른 탭 수집 가능 — 페이지에서 'AI 자막보기'를 한 번 눌러주세요."
        : "자막 모으기를 시작했습니다. 페이지에서 'AI 자막보기'를 한 번 눌러주세요.",
    );
  }

  syncUserInterfaces(ctx);
}

export async function startCapture(ctx: RuntimeCoreContext): Promise<void> {
  return ctx.captureLifecycleLock.run("start", () => startCaptureUnlocked(ctx));
}

export async function stopCaptureUnlocked(ctx: RuntimeCoreContext): Promise<void> {
  ctx.segmentRolloverToken += 1;
  ctx.segmentRolloverInFlight = false;
  if (ctx.queuedSegmentRolloverEvents.length > 0) {
    const pending = ctx.queuedSegmentRolloverEvents;
    ctx.queuedSegmentRolloverEvents = [];
    for (const event of pending) {
      handleTopFrameEvent(ctx, event);
    }
  }
  clearRunningPersistTimer(ctx);
  clearPendingReset(ctx);
  ctx.lastSegmentCapacityWarningReason = null;
  const now = Date.now();
  const stoppedRecord = buildPreparedSessionRecord(ctx, "stopped", now);
  ctx.state = finalizeSession(ctx.state, now, ctx.settings).state;
  setPanelNotice(ctx, "자막 모으기를 멈췄습니다.");
  rememberAutoStartCooldown(isTopFrame);
  await releaseCaptureOwnershipForStop(ctx);
  await persistStoppedSession(ctx, stoppedRecord);
  syncUserInterfaces(ctx);
}

export async function stopCapture(ctx: RuntimeCoreContext): Promise<void> {
  return ctx.captureLifecycleLock.run("stop", () => stopCaptureUnlocked(ctx));
}

export async function rollOverRunningSessionSegment(ctx: RuntimeCoreContext, 
  reason: RuntimeSessionSegmentationReason,
  now = Date.now(),
  token = ctx.segmentRolloverToken,
): Promise<void> {
  if (!isTopFrame || ctx.state.status !== "running" || !ctx.state.entries.length) {
    if (token === ctx.segmentRolloverToken) {
      ctx.segmentRolloverInFlight = false;
      flushQueuedSegmentRolloverEvent(ctx);
    }
    return;
  }

  const savedRecord = buildPreparedSessionRecord(ctx, "saved", now);
  if (!savedRecord.entries.length) {
    if (token === ctx.segmentRolloverToken) {
      ctx.segmentRolloverInFlight = false;
      flushQueuedSegmentRolloverEvent(ctx);
    }
    return;
  }

  clearRunningPersistTimer(ctx);
  const nowIso = new Date(now).toISOString();

  try {
    await persistSessionRecord(ctx, savedRecord);
    if (token !== ctx.segmentRolloverToken || ctx.state.status !== "running") {
      return;
    }
    ctx.liveCaptureLedger = resetLiveCaptureLedgerForNewSegment(
      ctx.liveCaptureLedger,
      ctx.state.confirmedCompact,
    );
    ctx.state = buildRolledOverRunningSessionState(ctx.state, {
      sourceUrl: window.location.href,
      title: document.title,
      committeeName: deriveCommitteeName(document.title),
      nowIso,
    });
    setPersistabilityState(ctx, 
      getLivePreviewText(ctx).trim() ? "preview_only" : "idle",
    );
    setPanelNotice(ctx, buildSegmentRolloverNotice(ctx.state.segmentNumber, reason));
    syncUserInterfaces(ctx);
  } catch (error) {
    if (token === ctx.segmentRolloverToken) {
      scheduleRunningPersist(ctx, "commit", now);
      reportRuntimeError(ctx, "세션 자동 분할 저장에 실패했습니다.", error);
    }
  } finally {
    if (token === ctx.segmentRolloverToken) {
      ctx.segmentRolloverInFlight = false;
      flushQueuedSegmentRolloverEvent(ctx);
    }
  }
}
