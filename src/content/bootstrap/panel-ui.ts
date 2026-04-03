import type { ExtensionSettings } from "../../storage/types";
import type { InPagePanelController } from "../inpage-panel";
import { buildInPagePanelState } from "../inpage-panel";
import {
  createPopupMessages,
  postToPopupPort,
} from "../popup-bridge";
import type { PreparedOutputSnapshot } from "./runtime-view";
import type { StatusSnapshot } from "../../shared/message-types";

interface PanelUiContext {
  isTopFrame: boolean;
  inPagePanel: InPagePanelController | null;
  popupPorts: Set<chrome.runtime.Port>;
  panelCollapsed: boolean;
  previewCollapsed: boolean;
  panelNotice: string;
  settings: ExtensionSettings;
}

export function broadcastPopupState(
  context: PanelUiContext,
  buildStatusSnapshot: (requiresReload?: boolean) => StatusSnapshot,
  requiresReload = false,
): void {
  if (!context.isTopFrame) {
    return;
  }

  const messages = createPopupMessages(buildStatusSnapshot(requiresReload));
  context.popupPorts.forEach((port) => {
    try {
      messages.forEach((message) => postToPopupPort(port, message));
    } catch {
      // Ignore Invalidated context errors on ports
    }
  });
}

export function syncPortState(
  port: chrome.runtime.Port,
  buildStatusSnapshot: (requiresReload?: boolean) => StatusSnapshot,
  requiresReload = false,
): void {
  createPopupMessages(buildStatusSnapshot(requiresReload)).forEach((message) =>
    postToPopupPort(port, message),
  );
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
  requiresReload = false,
): void {
  updateInPagePanel(context, buildPreparedOutputSnapshot(), buildStatusSnapshot(false));
  broadcastPopupState(context, buildStatusSnapshot, requiresReload);
}
