

import { clearScheduledRunningPersist } from "../../../../autosave";

import type { RuntimeCoreContext } from "./context";

/** 타이머 정리 (단일 책임: 실행 중인 타이머 해제). */
export function clearLocalPolling(ctx: RuntimeCoreContext): void {
  if (ctx.localPollingTimer) {
    window.clearInterval(ctx.localPollingTimer);
    ctx.localPollingTimer = null;
  }
}

export function clearTopFallbackTimer(ctx: RuntimeCoreContext): void {
  if (ctx.topFallbackTimer) {
    window.clearTimeout(ctx.topFallbackTimer);
    ctx.topFallbackTimer = null;
  }
}

export function clearFallbackCommitTimer(ctx: RuntimeCoreContext): void {
  if (ctx.fallbackCommitTimer) {
    window.clearTimeout(ctx.fallbackCommitTimer);
    ctx.fallbackCommitTimer = null;
  }
}

export function clearFrameForwardNonceRefresh(ctx: RuntimeCoreContext): void {
  if (ctx.frameForwardNonceRefreshTimer) {
    window.clearInterval(ctx.frameForwardNonceRefreshTimer);
    ctx.frameForwardNonceRefreshTimer = null;
  }
}

export function clearUrlChangePolling(ctx: RuntimeCoreContext): void {
  if (ctx.urlChangePollingTimer) {
    window.clearInterval(ctx.urlChangePollingTimer);
    ctx.urlChangePollingTimer = null;
  }
}

export function clearPendingReset(ctx: RuntimeCoreContext): void {
  if (ctx.pendingResetTimer) {
    window.clearTimeout(ctx.pendingResetTimer);
    ctx.pendingResetTimer = null;
  }
}

export function clearRunningPersistTimer(ctx: RuntimeCoreContext): void {
  ctx.persistTimer = clearScheduledRunningPersist(ctx.persistTimer, (timerId) =>
    window.clearTimeout(timerId),
  );
  ctx.pendingRunningPersistSince = null;
  ctx.pendingRunningPersistTrigger = null;
}

export function clearCaptureOwnershipHeartbeat(ctx: RuntimeCoreContext): void {
  if (ctx.captureOwnershipHeartbeatTimer !== null) {
    window.clearInterval(ctx.captureOwnershipHeartbeatTimer);
    ctx.captureOwnershipHeartbeatTimer = null;
  }
}
