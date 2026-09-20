

import { OBSERVER_STOP_EVENT } from "../../../../../shared/constants";

import { runInvalidationTimerCleanup } from "../../../../runtime/invalidation-shutdown";

import { invalidateExtensionContext, markExtensionContextInvalidated } from "../../../../../shared/extension-context";

import { postToPopupPort } from "../../../../popup-bridge";

import { INVALIDATED_CONTEXT_NOTICE, isTopFrame } from "../../constants";

import { resolveDefaultPanelNotice } from "../helpers";
import type { RuntimeCoreContext } from "./context";
import { clearCaptureOwnershipHeartbeat, clearFallbackCommitTimer, clearFrameForwardNonceRefresh, clearLocalPolling, clearPendingReset, clearRunningPersistTimer, clearTopFallbackTimer, clearUrlChangePolling } from "./timers";
import { updateInPagePanel } from "./panel-status";
import { releaseCaptureOwnershipForStop } from "./ownership";

/** 패널 알림·디버그·런타임 오류와 무효 컨텍스트 종료 (단일 책임: 사용자 통지). */
export function setPanelNotice(ctx: RuntimeCoreContext, message: string): boolean {
  if (ctx.panelNotice === message) {
    return false;
  }
  ctx.panelNotice = message;
  return true;
}

export function shouldShowPanelNotice(ctx: RuntimeCoreContext, message: string): boolean {
  return Boolean(message.trim()) && message !== resolveDefaultPanelNotice();
}

export function logDebug(ctx: RuntimeCoreContext, message: string, payload?: unknown): void {
  if (!ctx.settings.debugLogging) {
    return;
  }
  console.debug("[assembly-subtitle]", message, payload);
}

export function reportRuntimeError(ctx: RuntimeCoreContext, message: string, error?: unknown): void {
  if (markExtensionContextInvalidated(error)) {
    shutdownForInvalidatedContext(ctx);
    message = INVALIDATED_CONTEXT_NOTICE;
  }

  console.warn(`[assembly-subtitle] ${message}`, error);
  setPanelNotice(ctx, message);
  updateInPagePanel(ctx);
  if (!isTopFrame) {
    return;
  }

  ctx.popupPorts.forEach((port) => {
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

export function shutdownForInvalidatedContext(ctx: RuntimeCoreContext): void {
  if (ctx.extensionContextInvalidated) {
    return;
  }

  ctx.extensionContextInvalidated = true;
  invalidateExtensionContext();
  runInvalidationTimerCleanup({
    localPolling: () => clearLocalPolling(ctx),
    topFallback: () => clearTopFallbackTimer(ctx),
    fallbackCommit: () => clearFallbackCommitTimer(ctx),
    nonceRefresh: () => clearFrameForwardNonceRefresh(ctx),
    urlPolling: () => clearUrlChangePolling(ctx),
    runningPersist: () => clearRunningPersistTimer(ctx),
    ownershipHeartbeat: () => clearCaptureOwnershipHeartbeat(ctx),
    pendingReset: () => clearPendingReset(ctx),
  });
  void releaseCaptureOwnershipForStop(ctx);
  ctx.state.observerActive = false;

  try {
    window.dispatchEvent(new CustomEvent(OBSERVER_STOP_EVENT));
  } catch {
    // no-op
  }
}
