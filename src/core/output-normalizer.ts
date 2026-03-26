import { PIPELINE_DEFAULTS } from "../shared/constants";
import { buildConfirmedCompactHistory } from "./subtitle-pipeline";
import type { SubtitleEntry } from "./subtitle-models";
import {
  compactSubtitleText,
  normalizeSubtitleText,
  stripZeroWidth,
} from "./text-normalizer";

const OUTPUT_DUPLICATE_WINDOW_MS = 12_000;
const OUTPUT_DUPLICATE_MIN_LENGTH = 20;
const OUTPUT_DUPLICATE_LOOKBACK = PIPELINE_DEFAULTS.recentHistoryEntries;
const OUTPUT_MIN_COMPACT_ANCHOR = 10;
const OUTPUT_SHORT_COMPACT_ANCHOR = 5;
const OUTPUT_SHORT_ANCHOR_HISTORY_MIN = 30;
const OUTPUT_TRIM_MAX_PASSES = 3;
const OUTPUT_MIN_RETAINED_COMPACT = 8;
const OUTPUT_MAX_SUFFIX_ANCHOR_SCAN = 120;

export interface NormalizeOutputEntriesOptions {
  stripSpeakerMetadata?: boolean;
}

function cloneOutputEntry(
  entry: SubtitleEntry,
  options: NormalizeOutputEntriesOptions = {},
): SubtitleEntry {
  const cloned: SubtitleEntry = {
    ...entry,
    sourceFramePath: entry.sourceFramePath ? [...entry.sourceFramePath] : undefined,
  };

  if (options.stripSpeakerMetadata) {
    delete cloned.speakerColor;
    delete cloned.speakerChannel;
    delete cloned.speakerChanged;
  }

  return cloned;
}

function getEntryTimestamp(entry: SubtitleEntry): number {
  const parsed = Date.parse(entry.startTime || entry.timestamp || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function isExactCarryOverDuplicate(
  entry: SubtitleEntry,
  recentEntries: SubtitleEntry[],
): boolean {
  const compact = compactSubtitleText(entry.text);
  if (!compact) {
    return true;
  }

  for (let index = recentEntries.length - 1; index >= 0; index -= 1) {
    const previous = recentEntries[index];
    const previousCompact = compactSubtitleText(previous.text);
    if (previousCompact !== compact) {
      continue;
    }

    const withinShortWindow =
      Math.abs(getEntryTimestamp(entry) - getEntryTimestamp(previous)) <=
      OUTPUT_DUPLICATE_WINDOW_MS;
    const sameSourceNode =
      Boolean(entry.sourceNodeKey) &&
      Boolean(previous.sourceNodeKey) &&
      entry.sourceNodeKey === previous.sourceNodeKey;

    if (sameSourceNode || (compact.length >= OUTPUT_DUPLICATE_MIN_LENGTH && withinShortWindow)) {
      return true;
    }
  }

  return false;
}

function sliceFromCompactIndex(text: string, compactIndex: number): string {
  const raw = stripZeroWidth(String(text || ""));
  if (compactIndex <= 0) {
    return normalizeSubtitleText(raw);
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

  return normalizeSubtitleText(raw.slice(index));
}

function findCarryOverOverlap(
  historyCompact: string,
  entryCompact: string,
  minOverlap = OUTPUT_MIN_COMPACT_ANCHOR,
): number {
  const maxOverlap = Math.min(historyCompact.length, entryCompact.length);
  for (let length = maxOverlap; length >= minOverlap; length -= 1) {
    if (historyCompact.slice(-length) === entryCompact.slice(0, length)) {
      return length;
    }
  }
  return 0;
}

function findHistoryContainmentTrimPoint(
  historyCompact: string,
  entryCompact: string,
): number {
  if (!historyCompact || !entryCompact || historyCompact.length > entryCompact.length) {
    return 0;
  }

  if (historyCompact.length >= OUTPUT_MIN_COMPACT_ANCHOR) {
    const fullHistoryPos = entryCompact.lastIndexOf(historyCompact);
    if (fullHistoryPos > 0) {
      const tailLength = entryCompact.length - (fullHistoryPos + historyCompact.length);
      if (tailLength === 0 || tailLength >= OUTPUT_MIN_RETAINED_COMPACT) {
        return fullHistoryPos + historyCompact.length;
      }
    }
  }

  const maxAnchorLength = Math.min(historyCompact.length, OUTPUT_MAX_SUFFIX_ANCHOR_SCAN);
  for (let length = maxAnchorLength; length >= OUTPUT_MIN_COMPACT_ANCHOR; length -= 1) {
    const anchor = historyCompact.slice(-length);
    const anchorPos = entryCompact.lastIndexOf(anchor);
    if (anchorPos <= 0) {
      continue;
    }

    const tailLength = entryCompact.length - (anchorPos + length);
    if (tailLength === 0 || tailLength >= OUTPUT_MIN_RETAINED_COMPACT) {
      return anchorPos + length;
    }
  }

  if (historyCompact.length >= OUTPUT_SHORT_ANCHOR_HISTORY_MIN) {
    const shortOverlap = findCarryOverOverlap(
      historyCompact,
      entryCompact,
      OUTPUT_SHORT_COMPACT_ANCHOR,
    );
    if (shortOverlap > 0) {
      return shortOverlap;
    }
  }

  return 0;
}

function trimCarryOverText(text: string, recentEntries: SubtitleEntry[]): string {
  let nextText = normalizeSubtitleText(text);
  if (!nextText) {
    return "";
  }

  const historyCompact = buildConfirmedCompactHistory(
    recentEntries,
    PIPELINE_DEFAULTS.recentHistoryCompactLength,
  );
  if (!historyCompact) {
    return nextText;
  }

  for (let pass = 0; pass < OUTPUT_TRIM_MAX_PASSES; pass += 1) {
    const compact = compactSubtitleText(nextText);
    if (!compact) {
      return "";
    }

    if (compact.length >= OUTPUT_DUPLICATE_MIN_LENGTH && historyCompact.includes(compact)) {
      return "";
    }

    const containmentTrimPoint = findHistoryContainmentTrimPoint(historyCompact, compact);
    if (containmentTrimPoint > 0) {
      const trimmed = sliceFromCompactIndex(nextText, containmentTrimPoint);
      if (!trimmed) {
        return "";
      }
      if (trimmed === nextText) {
        break;
      }
      nextText = trimmed;
      continue;
    }

    const overlap = findCarryOverOverlap(historyCompact, compact);
    if (overlap > 0) {
      const trimmed = sliceFromCompactIndex(nextText, overlap);
      if (!trimmed) {
        return "";
      }
      if (trimmed === nextText) {
        break;
      }
      nextText = trimmed;
      continue;
    }

    break;
  }

  return nextText;
}

export function normalizeEntriesForOutput(
  entries: SubtitleEntry[],
  options: NormalizeOutputEntriesOptions = {},
): SubtitleEntry[] {
  return entries.reduce<SubtitleEntry[]>((kept, entry) => {
    const cloned = cloneOutputEntry(entry, options);
    const recentEntries = kept.slice(-OUTPUT_DUPLICATE_LOOKBACK);
    if (isExactCarryOverDuplicate(cloned, recentEntries)) {
      return kept;
    }

    const trimmedText = trimCarryOverText(cloned.text, recentEntries);
    if (!trimmedText) {
      return kept;
    }

    cloned.text = trimmedText;
    if (isExactCarryOverDuplicate(cloned, recentEntries)) {
      return kept;
    }

    kept.push(cloned);
    return kept;
  }, []);
}
