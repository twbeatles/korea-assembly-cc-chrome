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

function trimCarryOverText(text: string, recentEntries: SubtitleEntry[]): string {
  const normalizedText = normalizeSubtitleText(text);
  const compact = compactSubtitleText(normalizedText);
  if (!compact) {
    return "";
  }

  const historyCompact = buildConfirmedCompactHistory(
    recentEntries,
    PIPELINE_DEFAULTS.recentHistoryCompactLength,
  );
  if (!historyCompact) {
    return normalizedText;
  }

  if (compact.length >= OUTPUT_DUPLICATE_MIN_LENGTH && historyCompact.includes(compact)) {
    return "";
  }

  const overlap = findCarryOverOverlap(historyCompact, compact);
  if (overlap <= 0) {
    return normalizedText;
  }

  return sliceFromCompactIndex(normalizedText, overlap);
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
