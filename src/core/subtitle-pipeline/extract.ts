import { PIPELINE_DEFAULTS } from "../../shared/constants";
import {
  compactSubtitleText,
  normalizeRawText,
  stripZeroWidth,
} from "../text-normalizer";
import { LARGE_APPEND_MIN, MIN_COMPACT_ANCHOR, type IncrementalExtractResult } from "./types";

export function extractIncrementalTextWithRecentHistory(
  rawText: string,
  historyCompact: string,
  recentHistoryCompact: string,
  recentDuplicateMinLength: number = PIPELINE_DEFAULTS.recentDuplicateMinLength,
): IncrementalExtractResult {
  const recentHistory = compactSubtitleText(recentHistoryCompact);
  const fullHistory = compactSubtitleText(historyCompact);

  if (recentHistory && recentHistory !== fullHistory) {
    const recentResult = extractIncrementalTextFromHistory(
      rawText,
      recentHistory,
      recentDuplicateMinLength,
    );
    if (recentResult.matched || recentResult.duplicate) {
      return recentResult;
    }
  }

  return extractIncrementalTextFromHistory(rawText, fullHistory, recentDuplicateMinLength);
}

export function sliceFromCompactIndex(text: string, compactIndex: number): string {
  const raw = stripZeroWidth(String(text || ""));
  if (compactIndex <= 0) {
    return normalizeRawText(raw);
  }

  let seenCompactChars = 0;
  let index = 0;

  while (index < raw.length) {
    const char = raw[index];
    if (!/\s/.test(char)) {
      seenCompactChars += 1;
      if (seenCompactChars >= compactIndex) {
        index += 1;
        break;
      }
    }
    index += 1;
  }

  return normalizeRawText(raw.slice(index));
}

export function findCompactSuffixPrefixOverlap(
  historyCompact: string,
  rawCompact: string,
  minOverlap = MIN_COMPACT_ANCHOR,
): number {
  const maxOverlap = Math.min(historyCompact.length, rawCompact.length);
  for (let length = maxOverlap; length >= minOverlap; length -= 1) {
    if (historyCompact.slice(-length) === rawCompact.slice(0, length)) {
      return length;
    }
  }
  return 0;
}

export function extractIncrementalTextFromHistory(
  rawText: string,
  historyCompact: string,
  recentDuplicateMinLength: number = PIPELINE_DEFAULTS.recentDuplicateMinLength,
): IncrementalExtractResult {
  const normalizedRaw = normalizeRawText(rawText);
  const rawCompact = compactSubtitleText(normalizedRaw);
  const compactHistory = compactSubtitleText(historyCompact);
  const duplicateMinLength = Math.max(
    1,
    Number.isInteger(recentDuplicateMinLength)
      ? recentDuplicateMinLength
      : PIPELINE_DEFAULTS.recentDuplicateMinLength,
  );

  if (!rawCompact) {
    return {
      text: "",
      matched: false,
      duplicate: true,
      ambiguous: false,
      reason: "empty",
    };
  }

  if (!compactHistory) {
    return {
      text: normalizedRaw,
      matched: false,
      duplicate: false,
      ambiguous: false,
      reason: "no_history",
    };
  }

  if (rawCompact === compactHistory) {
    return {
      text: "",
      matched: true,
      duplicate: true,
      ambiguous: false,
      reason: "identical_history",
    };
  }

  if (
    rawCompact.length >= duplicateMinLength &&
    compactHistory.includes(rawCompact)
  ) {
    return {
      text: "",
      matched: false,
      duplicate: true,
      ambiguous: false,
      reason: "contained_in_history",
    };
  }

  const suffix = compactHistory.slice(-PIPELINE_DEFAULTS.suffixLength);
  if (suffix) {
    const firstPos = rawCompact.indexOf(suffix);
    const lastPos = rawCompact.lastIndexOf(suffix);
    if (lastPos >= 0) {
      const compactStart = lastPos + suffix.length;
      const text = sliceFromCompactIndex(normalizedRaw, compactStart);
      const predictedAppend = Math.max(0, rawCompact.length - compactStart);
      return {
        text,
        matched: true,
        duplicate: !text,
        ambiguous:
          firstPos !== lastPos &&
          predictedAppend > Math.max(LARGE_APPEND_MIN, Math.floor(rawCompact.length / 3)),
        reason: text ? "suffix" : "suffix_duplicate",
      };
    }
  }

  if (compactHistory.length >= MIN_COMPACT_ANCHOR) {
    const historyPos = rawCompact.lastIndexOf(compactHistory);
    if (historyPos >= 0) {
      const compactStart = historyPos + compactHistory.length;
      const text = sliceFromCompactIndex(normalizedRaw, compactStart);
      return {
        text,
        matched: true,
        duplicate: !text,
        ambiguous: false,
        reason: text ? "history" : "history_duplicate",
      };
    }
  }

  const overlap = findCompactSuffixPrefixOverlap(compactHistory, rawCompact);
  if (overlap > 0) {
    const text = sliceFromCompactIndex(normalizedRaw, overlap);
    return {
      text,
      matched: true,
      duplicate: !text,
      ambiguous: false,
      reason: text ? "overlap" : "overlap_duplicate",
    };
  }

  return {
    text: normalizedRaw,
    matched: false,
    duplicate: false,
    ambiguous: false,
    reason: "full",
  };
}
