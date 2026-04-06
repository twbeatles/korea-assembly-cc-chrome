import type { ExtensionSettings } from "../../storage/types";
import type { InPagePanelController } from "../inpage-panel";
import { buildInPagePanelState } from "../inpage-panel";
import type { PreparedOutputSnapshot } from "./runtime-view";
import type { StatusSnapshot } from "../../shared/message-types";

interface PanelUiContext {
  isTopFrame: boolean;
  inPagePanel: InPagePanelController | null;
  panelCollapsed: boolean;
  previewCollapsed: boolean;
  panelNotice: string;
  settings: ExtensionSettings;
}

export function updateInPagePanel(
  context: PanelUiContext,
  preparedOutput: PreparedOutputSnapshot,
  statusSnapshot: StatusSnapshot,
): void {
  if (!context.isTopFrame || !context.inPagePanel) {
    return;
  }

  context.inPagePanel.update(
    buildInPagePanelState(statusSnapshot, {
      collapsed: context.panelCollapsed,
      previewCollapsed: context.previewCollapsed,
      notice: context.panelNotice,
      autoScroll: context.settings.autoScroll,
      recentCopyLineCount: context.settings.recentCopyLineCount,
      livePreviewText: preparedOutput.livePreviewText,
      liveRows: preparedOutput.liveRows,
    }),
  );
}

export function syncUserInterfaces(
  context: PanelUiContext,
  buildPreparedOutputSnapshot: () => PreparedOutputSnapshot,
  buildStatusSnapshot: (requiresReload?: boolean) => StatusSnapshot,
): void {
  updateInPagePanel(context, buildPreparedOutputSnapshot(), buildStatusSnapshot(false));
}
