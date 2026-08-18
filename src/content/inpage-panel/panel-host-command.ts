import type { InPagePanelActions, PanelHostCommandDetail } from "./types";

export function isPanelHostCommandEnabled(host: Element): boolean {
  return host.getAttribute("data-assembly-e2e") === "1";
}

export interface PanelHostMirrorSnapshot {
  status: string;
  statusLabel: string;
  notice: string;
  subtitleCount: number;
  captureMode: string;
  collapsed: boolean;
  previewText: string;
  liveText: string;
}

const MIRROR_KEYS = [
  "assemblyStatus",
  "assemblyStatusLabel",
  "assemblyNotice",
  "assemblySubtitleCount",
  "assemblyCaptureMode",
  "assemblyCollapsed",
  "assemblyPreview",
  "assemblyLiveText",
] as const;

/** e2e 마커가 있을 때만 자막·상태 미러를 light DOM 에 남긴다. */
export function applyPanelHostStateMirror(
  host: HTMLElement,
  snapshot: PanelHostMirrorSnapshot,
): void {
  if (!isPanelHostCommandEnabled(host)) {
    for (const key of MIRROR_KEYS) {
      delete host.dataset[key];
    }
    return;
  }

  host.dataset.assemblyStatus = snapshot.status;
  host.dataset.assemblyStatusLabel = snapshot.statusLabel;
  host.dataset.assemblyNotice = snapshot.notice.slice(0, 400);
  host.dataset.assemblySubtitleCount = String(snapshot.subtitleCount);
  host.dataset.assemblyCaptureMode = snapshot.captureMode;
  host.dataset.assemblyCollapsed = snapshot.collapsed ? "1" : "0";
  host.dataset.assemblyPreview = snapshot.previewText.slice(0, 400);
  host.dataset.assemblyLiveText = snapshot.liveText.slice(0, 400);
}

export function applyPanelHostCommandDetail(
  detail: PanelHostCommandDetail | undefined,
  actions: InPagePanelActions,
  clickButtonByLabel: (label: string) => boolean,
): void {
  if (!detail || typeof detail !== "object" || !("type" in detail)) {
    return;
  }

  switch (detail.type) {
    case "click-button":
      if (typeof detail.label === "string" && detail.label) {
        clickButtonByLabel(detail.label);
      }
      break;
    case "start":
      actions.onStartCapture();
      break;
    case "stop":
      actions.onStopCapture();
      break;
    case "save":
      actions.onSaveSession();
      break;
    case "clear":
      actions.onClearSession();
      break;
    default:
      break;
  }
}
