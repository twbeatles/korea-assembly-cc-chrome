

import { listLivePanelRows, type CaptureMode, type LivePanelRow } from "../../../../../core/live-capture";

import type { FallbackCommitState, ObservedSubtitleRow, PersistabilityState, RowKeySource, StatusSnapshot } from "../../../../../shared/message-types";

import { buildInPagePanelState } from "../../../../inpage-panel";
import { resolvePanelLiveRows } from "../../../../panel-live-rows";

import { createPopupMessages, postToPopupPort } from "../../../../popup-bridge";

import { formatPreviewForDisplay, resolveLivePreviewText } from "../../../../runtime/preview";

import { buildSegmentRolloverDiagnostics } from "../../../../runtime/segment-rollover-diagnostics";
import { SEGMENT_ROLLOVER_EVENT_QUEUE_SAFETY_MAX } from "../../../../runtime/segment-event-queue";

import { buildContentStatusSnapshot, canClearCurrentSessionState } from "../../../../runtime/status-snapshot";

import { isTopFrame } from "../../constants";
import type { RowDiagnosticsState } from "../../types";

import type { RuntimeCoreContext } from "./context";
import { shouldShowPanelNotice } from "./notices";

/** 라이브 행·프리뷰·스냅샷과 UI 동기화 (단일 책임: 상태 가시화). */
export function getPanelLiveRows(ctx: RuntimeCoreContext): LivePanelRow[] {
  return resolvePanelLiveRows({
    structuredRows: listLivePanelRows(ctx.liveCaptureLedger),
    entries: ctx.state.entries,
    captureMode: getCaptureMode(ctx),
    sourceUrl: ctx.state.sourceUrl || window.location.href,
  });
}

export function getLivePreviewText(ctx: RuntimeCoreContext): string {
  return resolveLivePreviewText(
    ctx.liveCaptureLedger.previewText,
    ctx.state.previewText,
  );
}

export function getLivePreviewTextForDisplay(ctx: RuntimeCoreContext): string {
  return formatPreviewForDisplay(getLivePreviewText(ctx), getCaptureMode(ctx));
}

export function getCaptureMode(ctx: RuntimeCoreContext): CaptureMode {
  return ctx.liveCaptureLedger.captureMode;
}

export function setPersistabilityState(ctx: RuntimeCoreContext, stateValue: PersistabilityState): void {
  ctx.latestPersistabilityState = stateValue;
}

export function createEmptyRowDiagnostics(): RowDiagnosticsState {
  return {
    stableRowCount: 0,
    unstableRowCount: 0,
    filteredUnconfirmedCount: 0,
    rowKeySources: {},
  };
}

export function updateRowDiagnostics(ctx: RuntimeCoreContext, 
  rows: ObservedSubtitleRow[] = [],
  filteredUnconfirmedCount = 0,
): void {
  const rowKeySources: Partial<Record<RowKeySource, number>> = {};
  rows.forEach((row) => {
    const source =
      row.nodeKeySource ?? (row.unstableKey ? "generated" : "attribute");
    rowKeySources[source] = (rowKeySources[source] ?? 0) + 1;
  });

  ctx.latestRowDiagnostics = {
    stableRowCount: rows.filter((row) => !row.unstableKey).length,
    unstableRowCount: rows.filter((row) => row.unstableKey).length,
    filteredUnconfirmedCount,
    rowKeySources,
  };
}

export function setFallbackCommitState(ctx: RuntimeCoreContext, stateValue: FallbackCommitState): void {
  ctx.latestFallbackCommitState = stateValue;
}

export function buildStatusSnapshot(ctx: RuntimeCoreContext, 
  requiresReload = false,
  includeExportEstimates = false,
): StatusSnapshot {
  const previewTextRaw = getLivePreviewText(ctx);
  return buildContentStatusSnapshot({
    currentUrl: window.location.href,
    sessionState: ctx.state,
    settings: ctx.settings,
    captureMode: getCaptureMode(ctx),
    livePreviewTextRaw: previewTextRaw,
    livePreviewTextForDisplay: formatPreviewForDisplay(
      previewTextRaw,
      getCaptureMode(ctx),
    ),
    latestPersistabilityState: ctx.latestPersistabilityState,
    rowDiagnostics: ctx.latestRowDiagnostics,
    fallbackCommitState: ctx.latestFallbackCommitState,
    includeExportEstimates,
    requiresReload,
    segmentRollover: buildSegmentRolloverDiagnostics({
      inFlight: ctx.segmentRolloverInFlight,
      queueSize: ctx.queuedSegmentRolloverEvents.length,
      queueMax: SEGMENT_ROLLOVER_EVENT_QUEUE_SAFETY_MAX,
      droppedTotal: ctx.segmentRolloverEventsDroppedTotal,
    }),
  });
}

export function broadcastPopupState(ctx: RuntimeCoreContext, requiresReload = false): void {
  if (!isTopFrame) {
    return;
  }

  ctx.popupPorts.forEach((port) => {
    try {
      const messages = createPopupMessages(
        buildStatusSnapshot(ctx, requiresReload, ctx.diagnosticsPorts.has(port)),
      );
      messages.forEach((message) => postToPopupPort(port, message));
    } catch {
      // Ignore Invalidated context errors on ports
    }
  });
}

export function syncPortState(ctx: RuntimeCoreContext, 
  port: chrome.runtime.Port,
  requiresReload = false,
  includeExportEstimates = ctx.diagnosticsPorts.has(port),
): void {
  createPopupMessages(
    buildStatusSnapshot(ctx, requiresReload, includeExportEstimates),
  ).forEach((message) => postToPopupPort(port, message));
}

export function canClearCurrentSession(ctx: RuntimeCoreContext, 
  showNotice = shouldShowPanelNotice(ctx, ctx.panelNotice),
): boolean {
  return canClearCurrentSessionState({
    status: ctx.state.status,
    entryCount: ctx.state.entries.length,
    livePreviewText: getLivePreviewText(ctx),
    showNotice,
  });
}

export function updateInPagePanel(ctx: RuntimeCoreContext): void {
  if (!isTopFrame || !ctx.inPagePanel) {
    return;
  }

  const showNotice = shouldShowPanelNotice(ctx, ctx.panelNotice);

  ctx.inPagePanel.update(
    buildInPagePanelState(buildStatusSnapshot(ctx, false), {
      collapsed: ctx.panelCollapsed,
      previewCollapsed: ctx.previewCollapsed,
      notice: ctx.panelNotice,
      showNotice,
      autoScroll: ctx.settings.autoScroll,
      recentCopyLineCount: ctx.settings.recentCopyLineCount,
      showSpeakerHighlight: ctx.settings.panelSpeakerHighlightEnabled,
      exportSpeakerEnabled: ctx.settings.txtExportSpeakerEnabled,
      livePreviewText: getLivePreviewTextForDisplay(ctx),
      liveRows: getPanelLiveRows(ctx),
      canClearSession: canClearCurrentSession(ctx, showNotice),
    }),
  );
}

export function syncUserInterfaces(ctx: RuntimeCoreContext, requiresReload = false): void {
  updateInPagePanel(ctx);
  broadcastPopupState(ctx, requiresReload);
}
