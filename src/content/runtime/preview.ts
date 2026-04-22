import type { CaptureMode } from "../../core/live-capture";
import { normalizeSubtitleText } from "../../core/text-normalizer";
import { formatFallbackPreviewText } from "../fallback-preview";

export function resolveLivePreviewText(
  ledgerPreviewText: string,
  statePreviewText: string,
): string {
  return ledgerPreviewText || statePreviewText;
}

export function formatPreviewForDisplay(
  previewText: string,
  captureMode: CaptureMode,
  sourceUrl?: string,
): string {
  const normalized = normalizeSubtitleText(previewText);
  if (!normalized) {
    return "";
  }

  if (captureMode !== "fallback") {
    return normalized;
  }

  return formatFallbackPreviewText(previewText, sourceUrl);
}
