import { extractTailLines, normalizeSubtitleText } from "../core/text-normalizer";
import { PIPELINE_DEFAULTS, isAssemblyPlenaryUrl } from "../shared/constants";

export function normalizeFallbackInternalRaw(
  rawText: string,
  options:
    | number
    | {
        maxChars?: number;
        sourceUrl?: string;
      } = PIPELINE_DEFAULTS.fallbackInternalRawMaxChars,
): string {
  const raw = String(rawText ?? "").replace(/\r/g, "\n").trim();
  if (!raw) {
    return "";
  }

  const maxChars =
    typeof options === "number"
      ? options
      : options.maxChars ?? PIPELINE_DEFAULTS.fallbackInternalRawMaxChars;
  const preserveFullRaw =
    typeof options === "object" && isAssemblyPlenaryUrl(options.sourceUrl);

  if (preserveFullRaw) {
    return raw;
  }

  if (raw.length <= maxChars) {
    return raw;
  }

  return raw.slice(-maxChars);
}

export function formatFallbackPreviewText(rawText: string): string {
  const normalized = normalizeSubtitleText(rawText);
  if (!normalized) {
    return "";
  }

  const normalizedLineCount = String(rawText ?? "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => normalizeSubtitleText(line))
    .filter(Boolean).length;

  if (
    normalized.length <= PIPELINE_DEFAULTS.fallbackPreviewMaxChars &&
    normalizedLineCount <= PIPELINE_DEFAULTS.fallbackPreviewMaxLines
  ) {
    return normalized;
  }

  const tailPreview = normalizeSubtitleText(
    extractTailLines(rawText, PIPELINE_DEFAULTS.fallbackPreviewMaxLines),
  );

  if (tailPreview.length <= PIPELINE_DEFAULTS.fallbackPreviewMaxChars) {
    return tailPreview;
  }

  return tailPreview.slice(-PIPELINE_DEFAULTS.fallbackPreviewMaxChars).trim();
}
