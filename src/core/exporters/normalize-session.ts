import { getSessionCharCount, type SessionRecord, type SubtitleEntry } from "../subtitle-models";
import { compactSubtitleText } from "../text-normalizer";

const EXPORT_DUPLICATE_WINDOW_MS = 12_000;
const EXPORT_DUPLICATE_MIN_LENGTH = 20;
const EXPORT_DUPLICATE_LOOKBACK = 6;

function cloneExportEntry(entry: SubtitleEntry): SubtitleEntry {
  const cloned: SubtitleEntry = {
    ...entry,
    sourceFramePath: entry.sourceFramePath ? [...entry.sourceFramePath] : undefined,
  };

  delete cloned.speakerColor;
  delete cloned.speakerChannel;
  delete cloned.speakerChanged;

  return cloned;
}

function getEntryTimestamp(entry: SubtitleEntry): number {
  const parsed = Date.parse(entry.startTime || entry.timestamp || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function isCarryOverDuplicate(
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
      EXPORT_DUPLICATE_WINDOW_MS;
    const sameSourceNode =
      Boolean(entry.sourceNodeKey) &&
      Boolean(previous.sourceNodeKey) &&
      entry.sourceNodeKey === previous.sourceNodeKey;

    if (sameSourceNode || (compact.length >= EXPORT_DUPLICATE_MIN_LENGTH && withinShortWindow)) {
      return true;
    }
  }

  return false;
}

export function normalizeSessionForExport(session: SessionRecord): SessionRecord {
  const entries = session.entries.reduce<SubtitleEntry[]>((kept, entry) => {
    const cloned = cloneExportEntry(entry);
    const recentEntries = kept.slice(-EXPORT_DUPLICATE_LOOKBACK);
    if (isCarryOverDuplicate(cloned, recentEntries)) {
      return kept;
    }
    kept.push(cloned);
    return kept;
  }, []);

  return {
    ...session,
    entries,
    subtitleCount: entries.length,
    charCount: getSessionCharCount(entries),
  };
}
