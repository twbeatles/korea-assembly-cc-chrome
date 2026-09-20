

import { EXTENSION_STORAGE_KEY } from "../../../../../shared/constants";

import { shouldWarnBeforeUnload } from "../../../../autosave";

import type { FrameForwardMessage, ObserverBridgeEvent } from "../../../../../shared/message-types";

import { sanitizeSettings } from "../../../../../storage/settings-store";
import type { ExtensionSettings } from "../../../../../storage/types";

import { isForwardedFrameMessage, isObserverBridgeEventMessage, resolveForwardedFrameNonceAction } from "../../../../frame-coordinator";

import { isTopFrame, localFramePath } from "../../constants";

import type { RuntimeCoreContext } from "./context";
import { clearRunningPersistTimer, clearUrlChangePolling } from "./timers";
import { reportRuntimeError } from "./notices";
import { syncUserInterfaces } from "./panel-status";
import { persistRunningSnapshotForVisibilityChange, persistStoppedSnapshotForPageExit } from "./persistence";
import { forwardToTop, handleTopFrameEvent } from "./capture-events";
import { dispatchObserverConfig, requestFrameForwardNonceResync, triggerImmediateTopFallbackProbe } from "./observer-bridge";
import { startLocalPolling, startTopFrameFallback } from "./polling";
import { performUrlReconcile } from "./session-lifecycle";

/** 설정·탐색·브리지 메시지 바인딩 (단일 책임: 외부 신호 구독). */
export function bindSettingsChanges(ctx: RuntimeCoreContext): void {
  if (typeof chrome === "undefined" || !chrome.storage?.onChanged) {
    return;
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[EXTENSION_STORAGE_KEY]) {
      return;
    }
    if (ctx.extensionContextInvalidated) {
      return;
    }

    const previousSettings = ctx.settings;
    ctx.settings = sanitizeSettings(
      (changes[EXTENSION_STORAGE_KEY].newValue as
        | Partial<ExtensionSettings>
        | undefined) ?? {},
    );

    // Reset heuristic streaks tied to options that just changed so the new
    // policy takes effect immediately rather than after another N samples.
    if (
      previousSettings.filterUnconfirmedEnabled !==
      ctx.settings.filterUnconfirmedEnabled
    ) {
      ctx.localPollingUnconfirmedFallbackBlockStreak = 0;
      ctx.topFallbackUnconfirmedFallbackBlockStreak = 0;
    }
    if (
      previousSettings.pollingFallbackIntervalMs !==
      ctx.settings.pollingFallbackIntervalMs
    ) {
      ctx.topFallbackMissStreak = 0;
    }

    dispatchObserverConfig(ctx);
    startLocalPolling(ctx);
    startTopFrameFallback(ctx);

    if (!ctx.settings.runningAutoSaveEnabled) {
      clearRunningPersistTimer(ctx);
    }

    syncUserInterfaces(ctx);
  });
}

export function resyncOnReturnToForeground(ctx: RuntimeCoreContext): void {
  if (!isTopFrame || ctx.extensionContextInvalidated) {
    return;
  }

  requestFrameForwardNonceResync(ctx, true);
  dispatchObserverConfig(ctx);
  triggerImmediateTopFallbackProbe(ctx);
  syncUserInterfaces(ctx);
}

export function bindNavigationGuards(ctx: RuntimeCoreContext): void {
  if (!isTopFrame) {
    return;
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      persistRunningSnapshotForVisibilityChange(ctx);
      return;
    }
    if (document.visibilityState === "visible") {
      resyncOnReturnToForeground(ctx);
    }
  });

  window.addEventListener("pagehide", (event) => {
    const pageTransitionEvent = event as PageTransitionEvent;
    if (pageTransitionEvent.persisted) {
      // BFCache snapshot - keep autosave gating because the page may resume.
      persistRunningSnapshotForVisibilityChange(ctx);
      return;
    }
    // Genuine page exit - bypass autosave gating to preserve user work.
    persistStoppedSnapshotForPageExit(ctx);
  });

  window.addEventListener("pageshow", (event) => {
    const pageTransitionEvent = event as PageTransitionEvent;
    if (pageTransitionEvent.persisted) {
      resyncOnReturnToForeground(ctx);
    }
  });

  window.addEventListener("beforeunload", (event) => {
    if (!shouldWarnBeforeUnload(isTopFrame, ctx.state)) {
      return;
    }

    // Keep the unconditional snapshot here: the user is about to leave the
    // page, so autosave gating should not block the safety net.
    persistRunningSnapshotForVisibilityChange(ctx, Date.now(), {
      respectAutoSaveSetting: false,
    });
    event.preventDefault();
    event.returnValue = "";
  });
}

export function bindUrlChangeDetection(ctx: RuntimeCoreContext): void {
  if (!isTopFrame) {
    return;
  }

  const scheduleReconcile = (): void => {
    ctx.urlReconcileController.schedule(
      () => window.location.href,
      async (url) => {
        try {
          await ctx.captureLifecycleLock.run("reconcile", () =>
            performUrlReconcile(ctx, url),
          );
        } catch (error) {
          reportRuntimeError(ctx, 
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

  clearUrlChangePolling(ctx);
  ctx.urlChangePollingTimer = window.setInterval(() => {
    if (window.location.href !== ctx.urlReconcileController.getLastKnownUrl()) {
      scheduleReconcile();
    }
  }, 500);
}

export function bindBridgeMessages(ctx: RuntimeCoreContext): void {
  window.addEventListener("message", (event) => {
    const data = event.data as
      | Partial<ObserverBridgeEvent>
      | Partial<FrameForwardMessage>
      | undefined;
    if (!data || typeof data !== "object") {
      return;
    }

    if (event.source === window && isObserverBridgeEventMessage(data)) {
      if (!ctx.observerBridgeToken || data.token !== ctx.observerBridgeToken) {
        return;
      }

      const eventPayload: ObserverBridgeEvent = {
        ...data,
        framePath: data.framePath ?? localFramePath,
      };
      forwardToTop(ctx, eventPayload);
      return;
    }

    if (
      isTopFrame &&
      event.source !== window &&
      isForwardedFrameMessage(data)
    ) {
      if (
        resolveForwardedFrameNonceAction(ctx.frameForwardNonce, data.nonce) ===
        "accept"
      ) {
        handleTopFrameEvent(ctx, data.event);
        return;
      }

      requestFrameForwardNonceResync(ctx, true);
      triggerImmediateTopFallbackProbe(ctx);
    }
  });
}
