import type { CaptureMode, LivePanelRow } from "../core/live-capture";
import { cloneEntry, type SubtitleEntry } from "../core/subtitle-models";
import { PIPELINE_DEFAULTS } from "../shared/constants";

function resolveEntryUpdatedAt(entry: SubtitleEntry): number {
  const endTime = Date.parse(entry.endTime || "");
  if (Number.isFinite(endTime)) {
    return endTime;
  }

  const timestamp = Date.parse(entry.timestamp || "");
  if (Number.isFinite(timestamp)) {
    return timestamp;
  }

  const startTime = Date.parse(entry.startTime || "");
  return Number.isFinite(startTime) ? startTime : 0;
}

export function buildCommittedEntryLiveRows(
  entries: SubtitleEntry[],
  maxRows: number = PIPELINE_DEFAULTS.liveLedgerMaxRows,
): LivePanelRow[] {
  return entries.slice(-maxRows).map((entry) => ({
    key: `entry::${entry.id}`,
    text: entry.text,
    nodeKey: entry.sourceNodeKey || entry.id,
    speakerColor: entry.speakerColor || "",
    speakerChannel: entry.speakerChannel || "unknown",
    updatedAt: resolveEntryUpdatedAt(entry),
  }));
}

export function buildPersistableOutputEntries(input: {
  committedEntries: SubtitleEntry[];
  previewFallbackEntries: SubtitleEntry[];
}): SubtitleEntry[] {
  if (input.committedEntries.length > 0) {
    return input.committedEntries.map((entry) => cloneEntry(entry));
  }

  return input.previewFallbackEntries.map((entry) => cloneEntry(entry));
}

export function resolvePanelLiveRows(input: {
  structuredRows: LivePanelRow[];
  entries: SubtitleEntry[];
  captureMode: CaptureMode;
  sourceUrl: string;
}): LivePanelRow[] {
  void input.structuredRows;
  void input.captureMode;
  void input.sourceUrl;
  return buildCommittedEntryLiveRows(input.entries, Number.MAX_SAFE_INTEGER);
}
