import type { LivePanelRow } from "../../core/live-capture";
import type { StatusSnapshot } from "../../shared/message-types";
import { getCaptureStatusLabel, UI_TEXT } from "../../shared/ui-labels";
import type { InPagePanelState } from "./types";

export function buildInPagePanelState(
  snapshot: StatusSnapshot,
  options: {
    collapsed: boolean;
    previewCollapsed: boolean;
    notice: string;
    showNotice: boolean;
    autoScroll: boolean;
    recentCopyLineCount: number;
    livePreviewText: string;
    liveRows: LivePanelRow[];
    canClearSession: boolean;
  },
): InPagePanelState {
  return {
    visible: true,
    collapsed: options.collapsed,
    previewCollapsed: options.previewCollapsed,
    autoScroll: options.autoScroll,
    status: snapshot.status,
    statusLabel: getCaptureStatusLabel(snapshot.status),
    committeeName: snapshot.committeeName || snapshot.title || UI_TEXT.appName,
    startedAt: snapshot.startedAt,
    lastPersistedAt: snapshot.lastPersistedAt,
    previewText: snapshot.previewText,
    livePreviewText: options.livePreviewText || snapshot.previewText,
    liveRows: options.liveRows,
    captureMode: snapshot.diagnostics.captureMode,
    subtitleCount: snapshot.subtitleCount,
    charCount: snapshot.charCount,
    recentCopyLineCount: options.recentCopyLineCount,
    notice: options.notice,
    hasPersistableContent: snapshot.hasPersistableContent,
    canClearSession: options.canClearSession,
    showNotice: options.showNotice,
    canHighlightLatestEntry: snapshot.recentEntries.some(
      (entry) => !entry.highlighted,
    ),
  };
}
