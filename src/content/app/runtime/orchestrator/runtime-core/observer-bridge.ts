

import { OBSERVER_ACTIVATE_EVENT, OBSERVER_CONFIG_EVENT, SUBTITLE_SELECTOR_CANDIDATES } from "../../../../../shared/constants";

import { sendRuntimeMessage } from "../../../../../shared/chrome-api";

import { isExtensionContextInvalidatedError } from "../../../../../shared/extension-context";

import { tryDomSubtitleActivation, waitForSubtitleLayer } from "../../../../subtitle-layer";

import { FRAME_FORWARD_NONCE_RESYNC_INTERVAL_MS, INVALIDATED_CONTEXT_NOTICE, injectedScriptId, isTopFrame } from "../../constants";

import { isCapturePage, createObserverBridgeToken } from "../helpers";
import type { RuntimeCoreContext } from "./context";
import { clearFrameForwardNonceRefresh } from "./timers";
import { logDebug, reportRuntimeError } from "./notices";
import { getEffectivePollingIntervalMs, scheduleTopFrameFallbackTick } from "./polling";

/** observer 주입·자막 레이어 활성화·프레임 nonce (단일 책임: page world 연결). */
export async function refreshFrameForwardNonce(ctx: RuntimeCoreContext): Promise<void> {
  const response = await sendRuntimeMessage({
    type: "GET_FRAME_FORWARD_NONCE",
  });
  if (!response.ok || !response.nonce) {
    throw new Error(
      response.ok ? "프레임 전달 토큰을 받지 못했습니다." : response.error,
    );
  }
  ctx.frameForwardNonce = response.nonce;
}

export function requestFrameForwardNonceResync(ctx: RuntimeCoreContext, quiet = true): void {
  if (ctx.extensionContextInvalidated || ctx.frameForwardNonceRefreshInFlight) {
    return;
  }

  ctx.frameForwardNonceRefreshInFlight = true;
  void refreshFrameForwardNonce(ctx)
    .catch((error: unknown) => {
      if (isExtensionContextInvalidatedError(error)) {
        reportRuntimeError(ctx, INVALIDATED_CONTEXT_NOTICE, error);
        return;
      }

      if (!quiet) {
        reportRuntimeError(ctx, 
          "프레임 전달 보안 토큰을 다시 확인하지 못했습니다.",
          error,
        );
      } else {
        logDebug(ctx, "frame forward nonce resync failed", error);
      }
    })
    .finally(() => {
      ctx.frameForwardNonceRefreshInFlight = false;
    });
}

export function startFrameForwardNonceRefresh(ctx: RuntimeCoreContext): void {
  clearFrameForwardNonceRefresh(ctx);
  if (ctx.extensionContextInvalidated) {
    return;
  }

  ctx.frameForwardNonceRefreshTimer = window.setInterval(() => {
    requestFrameForwardNonceResync(ctx, true);
  }, FRAME_FORWARD_NONCE_RESYNC_INTERVAL_MS);
}

export async function ensureFrameForwardNonce(ctx: RuntimeCoreContext): Promise<void> {
  await refreshFrameForwardNonce(ctx);
}

export function triggerImmediateTopFallbackProbe(ctx: RuntimeCoreContext): void {
  if (!isTopFrame || ctx.extensionContextInvalidated) {
    return;
  }

  ctx.topFallbackMissStreak = Math.max(ctx.topFallbackMissStreak, 1);
  scheduleTopFrameFallbackTick(ctx, 0);
}

export function dispatchObserverConfig(ctx: RuntimeCoreContext): void {
  if (ctx.extensionContextInvalidated || !isCapturePage()) {
    return;
  }

  if (!ctx.observerBridgeToken) {
    ctx.observerBridgeToken = createObserverBridgeToken();
  }

  window.dispatchEvent(
    new CustomEvent(OBSERVER_CONFIG_EVENT, {
      detail: {
        selectors: SUBTITLE_SELECTOR_CANDIDATES,
        pollingIntervalMs: getEffectivePollingIntervalMs(ctx),
        filterUnconfirmedEnabled: ctx.settings.filterUnconfirmedEnabled,
        token: ctx.observerBridgeToken,
      },
    }),
  );
}

export function requestSubtitleLayerActivation(ctx: RuntimeCoreContext): void {
  ctx.lastSubtitleActivationAttemptAt = Date.now();
  tryDomSubtitleActivation();
  window.dispatchEvent(new CustomEvent(OBSERVER_ACTIVATE_EVENT));
}

export async function ensureSubtitleLayerActive(ctx: RuntimeCoreContext): Promise<boolean> {
  requestSubtitleLayerActivation(ctx);
  const layer = await waitForSubtitleLayer({
    timeoutMs: Math.max(1200, getEffectivePollingIntervalMs(ctx) * 10),
    intervalMs: Math.max(80, getEffectivePollingIntervalMs(ctx)),
  });
  return layer.visible && (layer.hasText || layer.controlActive);
}

export async function injectObserverScript(ctx: RuntimeCoreContext): Promise<void> {
  if (document.getElementById(injectedScriptId)) {
    dispatchObserverConfig(ctx);
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.id = injectedScriptId;
    script.src = chrome.runtime.getURL("injected-observer.js");
    script.async = false;
    script.onload = () => {
      dispatchObserverConfig(ctx);
      resolve();
    };
    script.onerror = () =>
      reject(new Error("Failed to inject observer bridge"));
    (document.head || document.documentElement).appendChild(script);
  });
}
