
import { applyKeepalive, applyReset, commitLiveRow } from "../../../../../core/subtitle-pipeline";
import { clearLiveCaptureLedger, getLiveRow, markLiveRowCommitted, normalizeCaptureEvent, reconcileLiveCapture, setLiveRowBaseline } from "../../../../../core/live-capture";
import { cloneState } from "../../../../../core/subtitle-models";
import { OBSERVER_BRIDGE_SOURCE } from "../../../../../shared/constants";

import type { ObservedSubtitleRow, ObserverBridgeEvent } from "../../../../../shared/message-types";

import { RESET_CAPTURE_NOTICE } from "../../../../capture-notice";

import { forwardFrameEvent } from "../../../../frame-coordinator";

import { SEGMENT_ROLLOVER_EVENT_QUEUE_SAFETY_MAX, drainSegmentEventQueue, enqueueBoundedSegmentEvent } from "../../../../runtime/segment-event-queue";

import { resolveRuntimeSessionSegmentationReason, resolveRuntimeSessionSegmentationThresholds } from "../../../../runtime/segmentation-policy";

import { analyzeCaptureCommit, resolveRuntimeCaptureNotice } from "../../../../subtitle-event-handler";
import { buildPersistabilityDiagnostics } from "../../../../persistability";
import { SUBTITLE_RESET_GRACE_MS, isTopFrame, localFramePath } from "../../constants";

import { cloneObserverBridgeEventForReplay, deriveCommitteeName } from "../helpers";
import type { RuntimeCoreContext } from "./context";
import { clearPendingReset } from "./timers";
import { logDebug, reportRuntimeError, setPanelNotice } from "./notices";
import { createEmptyRowDiagnostics, setPersistabilityState, syncUserInterfaces, updateRowDiagnostics } from "./panel-status";
import { resolvePreviewPersistability } from "./snapshots";
import { scheduleRunningPersist } from "./persistence";
import { clearFallbackCommitCandidate, observeFallbackCommitCandidate } from "./fallback-commit";
import { rollOverRunningSessionSegment } from "./session-lifecycle";
import { maybeEmitSegmentCapacityWarning } from "./session-commands";

/** structured/fallback 캡처 이벤트 처리와 라이브 조정 (단일 책임: 이벤트 → 상태). */
interface StructuredRowsApplyResult {
  changed: boolean;
  committed: boolean;
  sawDuplicate: boolean;
  sawFiltered: boolean;
}

export function applyPreviewStateOnly(ctx: RuntimeCoreContext, previewText: string, now: number): boolean {
  if (previewText === ctx.state.previewText) {
    return false;
  }

  const next = cloneState(ctx.state);
  next.previewText = previewText;
  next.lastObservedRaw = previewText;
  next.updatedAt = new Date(now).toISOString();
  next.lastObserverEventAt = now;
  ctx.state = next;
  return true;
}

export function applyStructuredRowsEvent(ctx: RuntimeCoreContext, 
  rows: ObservedSubtitleRow[],
  previewText: string,
  now: number,
  selector?: string,
  framePath?: number[],
): StructuredRowsApplyResult {
  const captureEvent = normalizeCaptureEvent({
    raw: previewText,
    rows,
    selector,
    framePath,
    timestamp: now,
  });
  const reconciliation = reconcileLiveCapture(ctx.liveCaptureLedger, captureEvent);
  ctx.liveCaptureLedger = reconciliation.ledger;

  let changed =
    reconciliation.changed ||
    applyPreviewStateOnly(ctx, captureEvent.previewText, now);
  let committed = false;
  let sawDuplicate = false;
  let sawFiltered = false;

  reconciliation.rowChanges.forEach((rowChange) => {
    let liveRow = getLiveRow(ctx.liveCaptureLedger, rowChange.key);
    if (!liveRow) {
      return;
    }

    if (liveRow.baselineCompact === null) {
      ctx.liveCaptureLedger = setLiveRowBaseline(
        ctx.liveCaptureLedger,
        rowChange.key,
        ctx.state.confirmedCompact,
      );
      liveRow = getLiveRow(ctx.liveCaptureLedger, rowChange.key);
      if (!liveRow) {
        return;
      }
    }

    const result = commitLiveRow(
      ctx.state,
      liveRow.text,
      captureEvent.previewText,
      now,
      ctx.settings,
      {
        selector,
        framePath,
        sourceNodeKey: liveRow.key,
        sourceCaptureMode: "structured",
        speakerColor: liveRow.speakerColor || undefined,
        speakerChannel: liveRow.speakerChannel,
        entryId: liveRow.committedEntryId ?? undefined,
        baselineCompact: liveRow.baselineCompact ?? ctx.state.confirmedCompact,
      },
    );
    committed =
      committed ||
      Boolean(result.appendedEntry) ||
      result.reason === "row_append" ||
      result.reason === "row_update";
    sawDuplicate =
      sawDuplicate || Boolean(result.reason?.includes("duplicate"));
    sawFiltered = sawFiltered || Boolean(result.reason?.includes("filtered"));

    if (result.changed) {
      ctx.state = result.state;
      changed = true;
    }

    if (!liveRow.committedEntryId && result.appendedEntry) {
      ctx.liveCaptureLedger = markLiveRowCommitted(
        ctx.liveCaptureLedger,
        rowChange.key,
        result.appendedEntry.id,
      );
    }
  });

  return {
    changed,
    committed,
    sawDuplicate,
    sawFiltered,
  };
}

export function clearStructuredRuntimeState(ctx: RuntimeCoreContext): void {
  clearPendingReset(ctx);
  clearFallbackCommitCandidate(ctx);
  ctx.liveCaptureLedger = clearLiveCaptureLedger();
  ctx.localLastProbeSignature = "";
  ctx.localHadProbeText = false;
  ctx.latestRowDiagnostics = createEmptyRowDiagnostics();
}

export function scheduleDeferredSubtitleReset(ctx: RuntimeCoreContext): void {
  if (!isTopFrame || ctx.pendingResetTimer || ctx.state.status !== "running") {
    return;
  }

  ctx.pendingResetTimer = window.setTimeout(() => {
    ctx.pendingResetTimer = null;
    if (ctx.state.status !== "running") {
      return;
    }

    ctx.state = applyReset(ctx.state, Date.now(), ctx.settings).state;
    setPersistabilityState(ctx, "idle");
    clearStructuredRuntimeState(ctx);
    setPanelNotice(ctx, RESET_CAPTURE_NOTICE);
    syncUserInterfaces(ctx);
  }, SUBTITLE_RESET_GRACE_MS);
}

export function queueSegmentRolloverEvent(ctx: RuntimeCoreContext, event: ObserverBridgeEvent): void {
  const enqueued = enqueueBoundedSegmentEvent(
    ctx.queuedSegmentRolloverEvents,
    cloneObserverBridgeEventForReplay(event),
    SEGMENT_ROLLOVER_EVENT_QUEUE_SAFETY_MAX,
  );
  ctx.queuedSegmentRolloverEvents = enqueued.queue;
  if (enqueued.droppedCount > 0) {
    ctx.segmentRolloverEventsDroppedTotal += enqueued.droppedCount;
    setPanelNotice(ctx, 
      `세그먼트 전환 중 이벤트가 많아 ${enqueued.droppedCount}건을 버퍼에서 비웠습니다. (누적 ${ctx.segmentRolloverEventsDroppedTotal}건)`,
    );
    logDebug(ctx, "segment rollover event queue overflow", {
      droppedCount: enqueued.droppedCount,
      totalDropped: ctx.segmentRolloverEventsDroppedTotal,
      queueSize: ctx.queuedSegmentRolloverEvents.length,
    });
  }
}

export function flushQueuedSegmentRolloverEvent(ctx: RuntimeCoreContext): void {
  if (ctx.segmentRolloverInFlight || !ctx.queuedSegmentRolloverEvents.length) {
    return;
  }

  ctx.queuedSegmentRolloverEvents = drainSegmentEventQueue(
    ctx.queuedSegmentRolloverEvents,
    (queuedEvent) => {
      handleTopFrameEvent(ctx, queuedEvent);
      return !ctx.segmentRolloverInFlight;
    },
  );
}

export function forwardToTop(ctx: RuntimeCoreContext, event: ObserverBridgeEvent): void {
  forwardFrameEvent(event, {
    isTopFrame,
    frameForwardNonce: ctx.frameForwardNonce,
    handleTopFrameEvent: (event) => handleTopFrameEvent(ctx, event),
  });
}

export function handleTopFrameEvent(ctx: RuntimeCoreContext, event: ObserverBridgeEvent): void {
  if (!isTopFrame) {
    return;
  }

  try {
    ctx.state.observerActive = Boolean(event.observerActive);
    if (event.selector) {
      ctx.state.currentSelector = event.selector;
    }
    if (event.framePath) {
      ctx.state.currentFramePath = [...event.framePath];
    }

    const now = event.timestamp || Date.now();
    if (event.kind === "subtitle:health") {
      ctx.state.lastObserverEventAt = now;
      // SPA-like in-page navigation can change the URL/title without
      // re-bootstrapping the content script. Refresh the cached source
      // metadata on health pings so saved snapshots reflect the current
      // page even if no subtitle:update has arrived yet.
      if (typeof event.sourceUrl === "string" && event.sourceUrl) {
        ctx.state.sourceUrl = event.sourceUrl;
      }
      const currentTitle = document.title;
      if (currentTitle && currentTitle !== ctx.state.title) {
        ctx.state.title = currentTitle;
        ctx.state.committeeName = deriveCommitteeName(currentTitle);
      }
      return;
    }

    if (ctx.state.status !== "running") {
      return;
    }

    if (ctx.segmentRolloverInFlight) {
      queueSegmentRolloverEvent(ctx, event);
      return;
    }

    if (event.kind === "subtitle:reset") {
      scheduleDeferredSubtitleReset(ctx);
      return;
    }

    clearPendingReset(ctx);
    const captureEvent = normalizeCaptureEvent({
      raw: event.raw,
      rows: event.rows,
      selector: event.selector,
      framePath: event.framePath,
      timestamp: now,
    });
    if (!captureEvent.previewText) {
      setPersistabilityState(ctx, "idle");
      return;
    }

    const captureCommit = analyzeCaptureCommit(captureEvent);
    updateRowDiagnostics(ctx, 
      captureEvent.rows,
      event.filteredUnconfirmedCount ?? 0,
    );

    if (captureCommit.shouldCommit) {
      clearFallbackCommitCandidate(ctx);
      ctx.localPollingUnconfirmedFallbackBlockStreak = 0;
      ctx.topFallbackUnconfirmedFallbackBlockStreak = 0;
      const structuredResult = applyStructuredRowsEvent(ctx, 
        captureCommit.stableRows,
        captureCommit.previewText,
        now,
        event.selector,
        event.framePath,
      );
      const persistabilityState = structuredResult.committed
        ? "persistable"
        : captureCommit.hasUnstableRows && captureCommit.stableRows.length === 0
          ? "unstable_only"
          : structuredResult.sawFiltered
            ? "filtered"
            : structuredResult.sawDuplicate
              ? "duplicate"
              : "preview_only";
      setPersistabilityState(ctx, persistabilityState);
      const persistability =
        buildPersistabilityDiagnostics(persistabilityState);
      const noticeChanged = setPanelNotice(ctx, 
        resolveRuntimeCaptureNotice({
          captureMode: captureEvent.captureMode,
          observerActive: ctx.state.observerActive,
          hasStableRows: captureCommit.shouldCommit,
          lastCommittedResetAt: ctx.state.lastCommittedResetAt,
          now,
          persistabilityState: persistability.state,
          persistabilityHint: persistability.hint,
        }),
      );
      if (
        !structuredResult.changed &&
        captureEvent.previewText === ctx.state.lastObservedRaw &&
        (!ctx.state.lastKeepaliveAt ||
          now - ctx.state.lastKeepaliveAt >= ctx.settings.keepaliveIntervalMs)
      ) {
        ctx.state = applyKeepalive(ctx.state, now).state;
        scheduleRunningPersist(ctx, "keepalive", now);
        syncUserInterfaces(ctx);
        return;
      }
      if (structuredResult.committed) {
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
          return;
        }
        maybeEmitSegmentCapacityWarning(ctx, now);
        scheduleRunningPersist(ctx, "commit", now);
      }
      if (structuredResult.changed || noticeChanged) {
        syncUserInterfaces(ctx);
      }
      return;
    }

    const persistabilityState =
      captureCommit.hasUnstableRows && captureCommit.stableRows.length === 0
        ? "unstable_only"
        : resolvePreviewPersistability(ctx, captureEvent.previewText, now);
    setPersistabilityState(ctx, persistabilityState);
    const persistability = buildPersistabilityDiagnostics(persistabilityState);
    const noticeChanged = setPanelNotice(ctx, 
      resolveRuntimeCaptureNotice({
        captureMode: captureEvent.captureMode,
        observerActive: ctx.state.observerActive,
        hasStableRows: captureCommit.shouldCommit,
        lastCommittedResetAt: ctx.state.lastCommittedResetAt,
        now,
        persistabilityState: persistability.state,
        persistabilityHint: persistability.hint,
        unconfirmedFallbackBlockStreak: Math.max(
          ctx.localPollingUnconfirmedFallbackBlockStreak,
          ctx.topFallbackUnconfirmedFallbackBlockStreak,
        ),
      }),
    );

    const fallbackReconciliation = reconcileLiveCapture(ctx.liveCaptureLedger, {
      ...captureEvent,
      rows: [],
      captureMode: "fallback",
    });
    ctx.liveCaptureLedger = fallbackReconciliation.ledger;
    const normalized = captureEvent.previewText;
    if (!normalized) {
      return;
    }

    if (
      normalized === ctx.state.lastObservedRaw &&
      (!ctx.state.lastKeepaliveAt ||
        now - ctx.state.lastKeepaliveAt >= ctx.settings.keepaliveIntervalMs)
    ) {
      ctx.state = applyKeepalive(ctx.state, now).state;
      scheduleRunningPersist(ctx, "keepalive", now);
      syncUserInterfaces(ctx);
      return;
    }

    const previewChanged = applyPreviewStateOnly(ctx, normalized, now);
    const fallbackCommitted = observeFallbackCommitCandidate(ctx, 
      normalized,
      now,
      event.selector,
      event.framePath,
    );
    if (fallbackReconciliation.changed || previewChanged || noticeChanged) {
      syncUserInterfaces(ctx);
    }
    if (fallbackCommitted) {
      return;
    }
  } catch (error) {
    reportRuntimeError(ctx, "자막 파이프라인 처리 중 오류가 발생했습니다.", error);
  }
}

export function emitLocalProbeEvent(ctx: RuntimeCoreContext, 
  kind: "subtitle:update" | "subtitle:reset",
  raw?: string,
  selector?: string,
  rows?: ObservedSubtitleRow[],
  filteredUnconfirmedCount = 0,
): void {
  forwardToTop(ctx, {
    source: OBSERVER_BRIDGE_SOURCE,
    token: ctx.observerBridgeToken,
    kind,
    raw,
    rows,
    selector,
    framePath: localFramePath,
    timestamp: Date.now(),
    sourceUrl: window.location.href,
    observerActive: false,
    filteredUnconfirmedCount,
  });
}
