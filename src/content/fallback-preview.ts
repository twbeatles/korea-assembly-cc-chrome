import { extractTailLines, normalizeSubtitleText } from "../core/text-normalizer";
import { PIPELINE_DEFAULTS, isAssemblyPlenaryUrl } from "../shared/constants";

export function normalizeFallbackInternalRaw(
  rawText: string,
  maxChars = PIPELINE_DEFAULTS.fallbackInternalRawMaxChars,
): string {
  const raw = String(rawText ?? "").replace(/\r/g, "\n").trim();
  if (!raw) {
    return "";
  }

  if (raw.length <= maxChars) {
    return raw;
  }

  return raw.slice(-maxChars);
}

export function formatFallbackPreviewText(rawText: string, sourceUrl?: string): string {
  const normalized = normalizeSubtitleText(rawText);
  if (!normalized) {
    return "";
  }

  if (
    normalized.length <= PIPELINE_DEFAULTS.fallbackPreviewMaxChars ||
    isAssemblyPlenaryUrl(sourceUrl)
  ) {
    return normalized;
  }

  return normalizeSubtitleText(
    extractTailLines(rawText, PIPELINE_DEFAULTS.fallbackPreviewMaxLines),
  );
}
