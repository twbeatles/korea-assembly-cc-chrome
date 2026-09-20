

import { OBSERVER_BRIDGE_SOURCE } from "../../../../../shared/constants";

import { probeBestAccessibleSubtitle, probeFramePath } from "../../../../frame-probe";

import { shouldEmitLocalProbeUpdate } from "../../../../local-polling";
import { estimateRecentRaw } from "../../../../dom-probe";
import { shouldAllowUnconfirmedContainerFallback, updateUnconfirmedFallbackBlockStreak } from "../../../../unconfirmed-fallback";

import { resolveTopFallbackDelayMs } from "../../../../frame-coordinator";

import { readDocumentVisibilityState, resolvePollingIntervalMs } from "../../../../runtime/visibility-polling";

import { buildPersistabilityDiagnostics } from "../../../../persistability";
import { isTopFrame } from "../../constants";

import { isCapturePage } from "../helpers";
import type { RuntimeCoreContext } from "./context";
import { clearLocalPolling, clearTopFallbackTimer } from "./timers";
import { reportRuntimeError, setPanelNotice } from "./notices";
import { setPersistabilityState, syncUserInterfaces, updateRowDiagnostics } from "./panel-status";
import { emitLocalProbeEvent, handleTopFrameEvent } from "./capture-events";
import { dispatchObserverConfig, requestSubtitleLayerActivation } from "./observer-bridge";

/** 로컬 폴링과 top 프레임 fallback 틱 (단일 책임: 폴링 루프). */
export function getEffectivePollingIntervalMs(ctx: RuntimeCoreContext): number {
  return resolvePollingIntervalMs(
    ctx.settings.pollingFallbackIntervalMs,
    readDocumentVisibilityState(),
  );
}

export function refreshPollingAfterVisibilityChange(ctx: RuntimeCoreContext): void {
  if (ctx.extensionContextInvalidated) {
    return;
  }
  if (ctx.state.status === "running" && isCapturePage()) {
    startLocalPolling(ctx);
    dispatchObserverConfig(ctx);
    if (isTopFrame) {
      scheduleTopFrameFallbackTick(ctx, getEffectivePollingIntervalMs(ctx));
    }
  }
}

export function bindVisibilityPollingAdjust(ctx: RuntimeCoreContext): void {
  document.addEventListener("visibilitychange", () => {
    refreshPollingAfterVisibilityChange(ctx);
  });
}

export function startLocalPolling(ctx: RuntimeCoreContext): void {
  if (ctx.extensionContextInvalidated || !isCapturePage()) {
    clearLocalPolling(ctx);
    return;
  }

  clearLocalPolling(ctx);
  const pollingIntervalMs = getEffectivePollingIntervalMs(ctx);
  ctx.localPollingTimer = window.setInterval(() => {
    try {
      const allowUnconfirmedContainerFallback =
        shouldAllowUnconfirmedContainerFallback(
          ctx.localPollingUnconfirmedFallbackBlockStreak,
        );
      const probe = estimateRecentRaw(document, ctx.state.currentSelector, {
        filterUnconfirmedEnabled: ctx.settings.filterUnconfirmedEnabled,
        allowUnconfirmedContainerFallback,
        sourceUrl: window.location.href,
      });
      ctx.localPollingUnconfirmedFallbackBlockStreak =
        updateUnconfirmedFallbackBlockStreak(
          ctx.localPollingUnconfirmedFallbackBlockStreak,
          probe,
        );
      if (!probe.found || !probe.text) {
        if (probe.blockedByUnconfirmedFilter) {
          updateRowDiagnostics(ctx, [], probe.filteredUnconfirmedCount ?? 0);
          setPersistabilityState(ctx, "filtered");
          setPanelNotice(ctx, buildPersistabilityDiagnostics("filtered").hint);
          syncUserInterfaces(ctx);
        }
        if (ctx.localHadProbeText) {
          ctx.localHadProbeText = false;
          ctx.localLastProbeSignature = "";
          emitLocalProbeEvent(ctx, 
            "subtitle:reset",
            undefined,
            undefined,
            undefined,
            probe.filteredUnconfirmedCount,
          );
        }
        return;
      }

      const decision = shouldEmitLocalProbeUpdate(
        ctx.localLastProbeSignature,
        probe,
      );
      if (!decision.shouldEmit) {
        return;
      }

      ctx.localHadProbeText = true;
      ctx.localLastProbeSignature = decision.signature;
      emitLocalProbeEvent(ctx, 
        "subtitle:update",
        probe.text,
        probe.matchedSelector,
        probe.rows,
        probe.filteredUnconfirmedCount,
      );
    } catch (error) {
      reportRuntimeError(ctx, "로컬 자막 감지 중 오류가 발생했습니다.", error);
    }
  }, pollingIntervalMs);
}

export function scheduleTopFrameFallbackTick(ctx: RuntimeCoreContext, delayMs: number): void {
  if (!isTopFrame || ctx.extensionContextInvalidated) {
    return;
  }

  clearTopFallbackTimer(ctx);
  ctx.topFallbackTimer = window.setTimeout(() => {
    ctx.topFallbackTimer = null;
    runTopFrameFallbackTick(ctx);
  }, delayMs);
}

export function runTopFrameFallbackTick(ctx: RuntimeCoreContext): void {
  if (!isTopFrame || ctx.extensionContextInvalidated) {
    clearTopFallbackTimer(ctx);
    return;
  }

  if (ctx.state.status !== "running") {
    ctx.topFallbackMissStreak = 0;
    scheduleTopFrameFallbackTick(ctx, 
      resolveTopFallbackDelayMs(
        ctx.topFallbackMissStreak,
        getEffectivePollingIntervalMs(ctx),
      ),
    );
    return;
  }

  const now = Date.now();
  const staleFor = ctx.state.lastObserverEventAt
    ? now - ctx.state.lastObserverEventAt
    : Number.MAX_SAFE_INTEGER;
  if (staleFor < getEffectivePollingIntervalMs(ctx) * 2) {
    ctx.topFallbackMissStreak = 0;
    scheduleTopFrameFallbackTick(ctx, 
      resolveTopFallbackDelayMs(
        ctx.topFallbackMissStreak,
        getEffectivePollingIntervalMs(ctx),
      ),
    );
    return;
  }

  try {
    const allowUnconfirmedContainerFallback =
      shouldAllowUnconfirmedContainerFallback(
        ctx.topFallbackUnconfirmedFallbackBlockStreak,
      );
    const probeOptions = {
      filterUnconfirmedEnabled: ctx.settings.filterUnconfirmedEnabled,
      allowUnconfirmedContainerFallback,
      sourceUrl: window.location.href,
    };
    const cachedFramePath = ctx.lastSuccessfulFallbackFramePath;
    const cachedProbe =
      cachedFramePath && cachedFramePath.length
        ? probeFramePath(cachedFramePath, ctx.state.currentSelector, probeOptions)
        : null;
    const probe =
      cachedProbe && cachedProbe.found && cachedProbe.text
        ? cachedProbe
        : probeBestAccessibleSubtitle(ctx.state.currentSelector, probeOptions);
    ctx.topFallbackUnconfirmedFallbackBlockStreak =
      updateUnconfirmedFallbackBlockStreak(
        ctx.topFallbackUnconfirmedFallbackBlockStreak,
        probe,
      );
    if (!probe.found || !probe.text) {
      if (probe.blockedByUnconfirmedFilter) {
        updateRowDiagnostics(ctx, [], probe.filteredUnconfirmedCount ?? 0);
        setPersistabilityState(ctx, "filtered");
        setPanelNotice(ctx, buildPersistabilityDiagnostics("filtered").hint);
        syncUserInterfaces(ctx);
      }
      ctx.topFallbackMissStreak += 1;
      if (now - ctx.lastSubtitleActivationAttemptAt >= 2000) {
        requestSubtitleLayerActivation(ctx);
      }
      scheduleTopFrameFallbackTick(ctx, 
        resolveTopFallbackDelayMs(
          ctx.topFallbackMissStreak,
          getEffectivePollingIntervalMs(ctx),
        ),
      );
      return;
    }

    ctx.topFallbackMissStreak = 0;
    ctx.lastSuccessfulFallbackFramePath = [...probe.framePath];

    handleTopFrameEvent(ctx, {
      source: OBSERVER_BRIDGE_SOURCE,
      kind: "subtitle:update",
      raw: probe.text,
      rows: probe.rows,
      selector: probe.matchedSelector,
      framePath: probe.framePath,
      timestamp: now,
      sourceUrl: window.location.href,
      observerActive: false,
      filteredUnconfirmedCount: probe.filteredUnconfirmedCount,
    });
  } catch (error) {
    ctx.topFallbackMissStreak += 1;
    reportRuntimeError(ctx, 
      "프레임 자막 fallback 탐색 중 오류가 발생했습니다.",
      error,
    );
  }

  scheduleTopFrameFallbackTick(ctx, 
    resolveTopFallbackDelayMs(
      ctx.topFallbackMissStreak,
      getEffectivePollingIntervalMs(ctx),
    ),
  );
}

export function startTopFrameFallback(ctx: RuntimeCoreContext): void {
  if (!isTopFrame || ctx.extensionContextInvalidated || !isCapturePage()) {
    clearTopFallbackTimer(ctx);
    return;
  }

  ctx.topFallbackMissStreak = 0;
  scheduleTopFrameFallbackTick(ctx, 
    resolveTopFallbackDelayMs(
      ctx.topFallbackMissStreak,
      getEffectivePollingIntervalMs(ctx),
    ),
  );
}
