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

/** 단일 entry note 저장 상한 (세션 note 4KB와 별개). */
export const SESSION_ENTRY_NOTE_MAX_LENGTH = 2048;

/** 단일 entry text 저장 상한 (비정상 payload 방어). */
export const SESSION_ENTRY_TEXT_MAX_LENGTH = 50_000;

export interface NormalizeOutputEntriesOptions {
  stripSpeakerMetadata?: boolean;
}

function clampOptionalText(
  value: string | undefined,
  maxLength: number,
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  if (!value) {
    return undefined;
  }
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

function cloneOutputEntry(
  entry: SubtitleEntry,
  options: NormalizeOutputEntriesOptions = {},
): SubtitleEntry {
  const cloned: SubtitleEntry = {
    ...entry,
    text: normalizeSubtitleText(entry.text).slice(0, SESSION_ENTRY_TEXT_MAX_LENGTH),
    originalText: clampOptionalText(entry.originalText, SESSION_ENTRY_TEXT_MAX_LENGTH),
    entryNote: clampOptionalText(entry.entryNote, SESSION_ENTRY_NOTE_MAX_LENGTH),
    sourceFramePath: entry.sourceFramePath ? [...entry.sourceFramePath] : undefined,
    labels: entry.labels ? [...entry.labels] : undefined,
    sourceEntryIds: entry.sourceEntryIds ? [...entry.sourceEntryIds] : undefined,
  };

  if (options.stripSpeakerMetadata) {
    delete cloned.speakerColor;
    delete cloned.speakerChannel;
    delete cloned.speakerChanged;
  }

  return cloned;
}

/**
 * 영속화(저장/업데이트) 전용 structural sanitize.
 * export/copy의 carry-over exact duplicate 제거는 수행하지 않는다.
 */
export function sanitizeEntriesForStorage(entries: SubtitleEntry[]): SubtitleEntry[] {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .filter((entry): entry is SubtitleEntry => Boolean(entry) && typeof entry === "object")
    .map((entry) => cloneOutputEntry(entry))
    .filter((entry) => Boolean(entry.id) && Boolean(entry.text));
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
