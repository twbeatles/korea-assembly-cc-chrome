import { PIPELINE_DEFAULTS } from "../shared/constants";
import { compactSubtitleText, normalizeSubtitleText } from "./text-normalizer";

export interface SuffixPositions {
  first: number;
  last: number;
}

function clampCompactIndex(text: string, compactIndex: number): number {
  if (!text || compactIndex <= 0) {
    return 0;
  }

  let compactCount = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (/\s/.test(text[index])) {
      continue;
    }
    if (compactCount >= compactIndex) {
      return index;
    }
    compactCount += 1;
  }

  return text.length;
}

export function sliceFromCompactIndex(text: string, compactIndex: number): string {
  if (!text) {
    return "";
  }

  if (compactIndex <= 0) {
    return text;
  }

  const startIndex = clampCompactIndex(text, compactIndex);
  if (startIndex >= text.length) {
    return "";
  }

  return text.slice(startIndex);
}

export function findSuffixPositions(rawCompact: string, suffix: string): SuffixPositions {
  if (!rawCompact || !suffix) {
    return { first: -1, last: -1 };
  }

  return {
    first: rawCompact.indexOf(suffix),
    last: rawCompact.lastIndexOf(suffix),
  };
}

export function findCompactSuffixPrefixOverlap(
  previousCompact: string,
  nextCompact: string,
  minOverlap = 10,
  maxOverlap = PIPELINE_DEFAULTS.recentHistoryCompactLength,
): number {
  if (!previousCompact || !nextCompact) {
    return 0;
  }

  const maxPossible = Math.min(previousCompact.length, nextCompact.length, maxOverlap);
  for (let overlap = maxPossible; overlap >= minOverlap; overlap -= 1) {
    if (previousCompact.endsWith(nextCompact.slice(0, overlap))) {
      return overlap;
    }
  }

  return 0;
}

export function compactHistoryTail(
  history: string[],
  maxEntries = 8,
  maxCompactLength = 3000,
): string {
  const tail = history.slice(-maxEntries).join(" ");
  const compact = compactSubtitleText(tail);
  if (compact.length <= maxCompactLength) {
    return compact;
  }
  return compact.slice(-maxCompactLength);
}

function extractAfterCompactAnchor(raw: string, rawCompact: string, anchorCompact: string): string | null {
  if (!raw || !rawCompact || !anchorCompact) {
    return null;
  }

  const anchorPosition = rawCompact.lastIndexOf(anchorCompact);
  if (anchorPosition < 0) {
    return null;
  }

  return sliceFromCompactIndex(raw, anchorPosition + anchorCompact.length).trim();
}

function extractAfterBestSuffix(raw: string, rawCompact: string, anchorCompact: string): string | null {
  if (!raw || !rawCompact || !anchorCompact) {
    return null;
  }

  const maxSuffixLength = Math.min(100, anchorCompact.length);
  for (let suffixLength = maxSuffixLength; suffixLength >= 10; suffixLength -= 1) {
    const suffix = anchorCompact.slice(-suffixLength);
    const suffixPosition = rawCompact.lastIndexOf(suffix);
    if (suffixPosition < 0) {
      continue;
    }

    return sliceFromCompactIndex(raw, suffixPosition + suffixLength).trim();
  }

  return null;
}

export function extractByTrailingSuffix(
  raw: string,
  rawCompact: string,
  trailingSuffix: string,
): string {
  if (!trailingSuffix) {
    return raw;
  }

  const suffixPosition = rawCompact.lastIndexOf(trailingSuffix);
  if (suffixPosition < 0) {
    return raw;
  }

  const startIndex = suffixPosition + trailingSuffix.length;
  if (startIndex >= rawCompact.length) {
    return "";
  }

  return sliceFromCompactIndex(raw, startIndex).trim();
}

export function extractStreamDelta(raw: string, lastRaw: string): string | null {
  if (!lastRaw) {
    return null;
  }

  const normalizedRaw = normalizeSubtitleText(raw);
  const normalizedPrevious = normalizeSubtitleText(lastRaw);
  const rawCompact = compactSubtitleText(normalizedRaw);
  const previousCompact = compactSubtitleText(normalizedPrevious);

  if (!rawCompact || !previousCompact) {
    return "";
  }

  if (rawCompact === previousCompact) {
    return "";
  }

  if (rawCompact.startsWith(previousCompact)) {
    return sliceFromCompactIndex(normalizedRaw, previousCompact.length).trim();
  }

  const directAnchorDelta = extractAfterCompactAnchor(
    normalizedRaw,
    rawCompact,
    previousCompact,
  );
  if (directAnchorDelta !== null) {
    return directAnchorDelta;
  }

  const suffixDelta = extractAfterBestSuffix(normalizedRaw, rawCompact, previousCompact);
  if (suffixDelta !== null) {
    return suffixDelta;
  }

  const overlapLength = findCompactSuffixPrefixOverlap(previousCompact, rawCompact, 10);
  if (overlapLength > 0) {
    return sliceFromCompactIndex(normalizedRaw, overlapLength).trim();
  }

  return null;
}

export function sliceIncrementalPart(
  raw: string,
  anchorCompact: string,
  rawCompact = compactSubtitleText(raw),
  minAnchor = 20,
  minOverlap = 8,
): string | null {
  if (!raw || !rawCompact || !anchorCompact) {
    return null;
  }

  if (anchorCompact.length >= minAnchor) {
    const directAnchorDelta = extractAfterCompactAnchor(raw, rawCompact, anchorCompact);
    if (directAnchorDelta !== null) {
      return directAnchorDelta;
    }
  }

  const suffixDelta = extractAfterBestSuffix(raw, rawCompact, anchorCompact);
  if (suffixDelta !== null) {
    return suffixDelta;
  }

  const overlapLength = findCompactSuffixPrefixOverlap(anchorCompact, rawCompact, minOverlap);
  if (overlapLength > 0) {
    return sliceFromCompactIndex(raw, overlapLength).trim();
  }

  return null;
}

export function extractIncrement(text: string, previous: string, history: string[] = []): string {
  const normalizedText = normalizeSubtitleText(text);
  const normalizedPrevious = normalizeSubtitleText(previous);

  if (!normalizedText) {
    return "";
  }

  if (!normalizedPrevious) {
    return normalizedText;
  }

  if (normalizedText === normalizedPrevious) {
    return "";
  }

  if (normalizedText.startsWith(normalizedPrevious)) {
    return normalizedText.slice(normalizedPrevious.length).trim();
  }

  const previousCompact = compactSubtitleText(normalizedPrevious);
  const nextCompact = compactSubtitleText(normalizedText);

  const directAnchorDelta = extractAfterCompactAnchor(
    normalizedText,
    nextCompact,
    previousCompact,
  );
  if (directAnchorDelta !== null) {
    return directAnchorDelta;
  }

  const streamDelta = extractStreamDelta(normalizedText, normalizedPrevious);
  if (streamDelta !== null) {
    return streamDelta.trim();
  }

  const historyAnchor = compactHistoryTail(history, 8, 3000);
  if (historyAnchor) {
    const incremental = sliceIncrementalPart(normalizedText, historyAnchor, nextCompact);
    if (incremental !== null) {
      return incremental.trim();
    }
  }

  const overlapLength = findCompactSuffixPrefixOverlap(previousCompact, nextCompact, 10);
  if (overlapLength > 0) {
    return sliceFromCompactIndex(normalizedText, overlapLength).trim();
  }

  return normalizedText;
}
