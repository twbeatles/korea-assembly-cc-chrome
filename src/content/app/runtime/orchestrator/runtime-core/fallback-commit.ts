
import { applyPreview } from "../../../../../core/subtitle-pipeline";

import type { FallbackCommitState } from "../../../../../shared/message-types";

import { resolveRuntimeSessionSegmentationReason, resolveRuntimeSessionSegmentationThresholds } from "../../../../runtime/segmentation-policy";

import { resolveRuntimeCaptureNotice } from "../../../../subtitle-event-handler";
import { buildPersistabilityDiagnostics, resolvePreviewPersistabilityState } from "../../../../persistability";
import { FALLBACK_COMMIT_OBSERVATION_THRESHOLD, FALLBACK_COMMIT_STABLE_MS } from "../../constants";
import type { FallbackCommitCandidate } from "../../types";

import type { RuntimeCoreContext } from "./context";
import { clearFallbackCommitTimer } from "./timers";
import { setPanelNotice } from "./notices";
import { setFallbackCommitState, setPersistabilityState, syncUserInterfaces } from "./panel-status";
import { scheduleRunningPersist } from "./persistence";
import { rollOverRunningSessionSegment } from "./session-lifecycle";
import { maybeEmitSegmentCapacityWarning } from "./session-commands";

/** fallback 텍스트 안정 관측 후 commit (단일 책임: fallback 확정). */
export function clearFallbackCommitCandidate(ctx: RuntimeCoreContext, 
  nextState: FallbackCommitState = "idle",
): void {
  clearFallbackCommitTimer(ctx);
  ctx.fallbackCommitCandidate = null;
  setFallbackCommitState(ctx, nextState);
}

export function scheduleFallbackCommitCandidate(ctx: RuntimeCoreContext, 
  candidate: FallbackCommitCandidate,
): void {
  clearFallbackCommitTimer(ctx);
  const delayMs = Math.max(
    0,
    FALLBACK_COMMIT_STABLE_MS - (Date.now() - candidate.firstSeenAt),
  );
  ctx.fallbackCommitTimer = window.setTimeout(() => {
    ctx.fallbackCommitTimer = null;
    commitFallbackCandidate(ctx, candidate.token, Date.now());
  }, delayMs);
}

export function resolveFallbackResultState(ctx: RuntimeCoreContext, reason?: string): FallbackCommitState {
  if (reason?.includes("duplicate")) {
    return "duplicate";
  }
  if (reason?.includes("filtered")) {
    return "filtered";
  }
  return "stable";
}

export function commitFallbackCandidate(ctx: RuntimeCoreContext, token: number, now = Date.now()): boolean {
  const candidate = ctx.fallbackCommitCandidate;
  if (!candidate || candidate.token !== token || ctx.state.status !== "running") {
    return false;
  }

  const result = applyPreview(ctx.state, candidate.raw, now, ctx.settings, {
    selector: candidate.selector,
    framePath: candidate.framePath,
    sourceCaptureMode: "fallback",
  });
  const committed = Boolean(result.appendedEntry);
  if (result.changed) {
    ctx.state = result.state;
  }

  clearFallbackCommitCandidate(ctx, 
    committed ? "committed" : resolveFallbackResultState(ctx, result.reason),
  );
  setPersistabilityState(ctx, 
    committed
      ? "persistable"
      : resolvePreviewPersistabilityState(result.reason),
  );
  const persistability = buildPersistabilityDiagnostics(
    ctx.latestPersistabilityState,
  );
  setPanelNotice(ctx, 
    resolveRuntimeCaptureNotice({
      captureMode: "fallback",
      observerActive: ctx.state.observerActive,
      hasStableRows: false,
      lastCommittedResetAt: ctx.state.lastCommittedResetAt,
      now,
      persistabilityState: persistability.state,
      persistabilityHint: persistability.hint,
    }),
  );

  if (committed) {
    const segmentationReason = resolveRuntimeSessionSegmentationReason(
      ctx.state,
      now,
      resolveRuntimeSessionSegmentationThresholds(ctx.settings),
    );
    if (segmentationReason) {
      ctx.lastSegmentCapacityWarningReason = null;
      // 큐를 비우지 않는다 — 이전 잔여·경합 이벤트는 롤오버 후 flush 로 재생한다.
      ctx.segmentRolloverInFlight = true;
      const rolloverToken = ++ctx.segmentRolloverToken;
      setPanelNotice(ctx, 
        "현재 세그먼트를 저장하고 다음 구간으로 전환하고 있습니다.",
      );
      syncUserInterfaces(ctx);
      void rollOverRunningSessionSegment(ctx, 
        segmentationReason,
        now,
        rolloverToken,
      );
      return true;
    }
    maybeEmitSegmentCapacityWarning(ctx, now);
    scheduleRunningPersist(ctx, "commit", now);
  }

  syncUserInterfaces(ctx);
  return committed;
}

export function observeFallbackCommitCandidate(ctx: RuntimeCoreContext, 
  raw: string,
  now: number,
  selector?: string,
  framePath?: number[],
): boolean {
  const normalizedRaw = raw.trim();
  if (!normalizedRaw) {
    clearFallbackCommitCandidate(ctx);
    return false;
  }

  if (ctx.fallbackCommitCandidate?.raw === normalizedRaw) {
    ctx.fallbackCommitCandidate = {
      ...ctx.fallbackCommitCandidate,
      selector,
      framePath: framePath ? [...framePath] : undefined,
      lastSeenAt: now,
      observationCount: ctx.fallbackCommitCandidate.observationCount + 1,
    };
  } else {
    ctx.fallbackCommitCandidate = {
      raw: normalizedRaw,
      selector,
      framePath: framePath ? [...framePath] : undefined,
      firstSeenAt: now,
      lastSeenAt: now,
      observationCount: 1,
      token: ++ctx.fallbackCommitToken,
    };
  }

  setFallbackCommitState(ctx, "pending");

  if (
    ctx.fallbackCommitCandidate.observationCount >=
      FALLBACK_COMMIT_OBSERVATION_THRESHOLD ||
    now - ctx.fallbackCommitCandidate.firstSeenAt >= FALLBACK_COMMIT_STABLE_MS
  ) {
    return commitFallbackCandidate(ctx, ctx.fallbackCommitCandidate.token, now);
  }

  scheduleFallbackCommitCandidate(ctx, ctx.fallbackCommitCandidate);
  return false;
}
