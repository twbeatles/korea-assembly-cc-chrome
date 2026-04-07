import type { CaptureMode, LivePanelRow } from "../core/live-capture";
import type { SubtitleEntry } from "../core/subtitle-models";
import { isAssemblyPlenaryUrl, PIPELINE_DEFAULTS } from "../shared/constants";

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

function toIsoTimestamp(value: number, fallback: number): string {
  const timestamp = Number.isFinite(value) ? value : fallback;
  return new Date(timestamp).toISOString();
}

export function buildCommittedEntryLiveRows(
  entries: SubtitleEntry[],
  maxRows = PIPELINE_DEFAULTS.liveLedgerMaxRows,
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

export function buildOutputEntriesFromPanelRows(
  rows: LivePanelRow[],
  sessionId: string,
  now = Date.now(),
): SubtitleEntry[] {
  return rows
    .filter((row) => String(row.text || "").trim())
    .map((row, index) => {
      const timestamp = toIsoTimestamp(row.updatedAt, now + index);
      return {
        id: `${sessionId}::visible::${row.key}::${index}`,
        text: row.text,
        timestamp,
        startTime: timestamp,
        endTime: timestamp,
        sourceNodeKey: row.nodeKey,
        speakerColor: row.speakerColor || undefined,
        speakerChannel: row.speakerChannel || "unknown",
      };
    });
}

export function resolvePanelLiveRows(input: {
  structuredRows: LivePanelRow[];
  entries: SubtitleEntry[];
  captureMode: CaptureMode;
  sourceUrl: string;
}): LivePanelRow[] {
  if (
    input.captureMode !== "fallback" ||
    !isAssemblyPlenaryUrl(input.sourceUrl) ||
    input.structuredRows.length > 0
  ) {
    return input.structuredRows;
  }

  return buildCommittedEntryLiveRows(input.entries);
}
