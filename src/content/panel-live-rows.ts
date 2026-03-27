import {
  createLivePanelRowFromEntry,
  type CaptureMode,
  type LivePanelRow,
} from "../core/live-capture";
import type { SubtitleEntry } from "../core/subtitle-models";
import { isAssemblyPlenaryUrl, PIPELINE_DEFAULTS } from "../shared/constants";

function cloneOptionalFramePath(framePath?: number[]): number[] | undefined {
  return framePath ? [...framePath] : undefined;
}

function resolveIsoTimestamp(value: string | undefined, fallback: string): string {
  return value && Number.isFinite(Date.parse(value)) ? value : fallback;
}

export function buildOutputEntriesFromPanelRows(
  rows: LivePanelRow[],
  now = Date.now(),
): SubtitleEntry[] {
  return rows.map((row, index) => {
    const resolvedMs =
      Number.isFinite(row.updatedAt) && row.updatedAt > 0
        ? row.updatedAt
        : now;
    const fallbackTimestamp = new Date(resolvedMs).toISOString();
    const timestamp = resolveIsoTimestamp(row.timestamp, fallbackTimestamp);
    const startTime = resolveIsoTimestamp(row.startTime, timestamp);
    const endTime = resolveIsoTimestamp(row.endTime, fallbackTimestamp);
    return {
      id: row.entryId || `live:${row.key}:${resolvedMs}:${index}`,
      text: row.text,
      timestamp,
      startTime,
      endTime,
      sourceSelector: row.sourceSelector,
      sourceFramePath: cloneOptionalFramePath(row.sourceFramePath),
      sourceNodeKey: row.sourceNodeKey || row.key,
      speakerColor: row.speakerColor,
      speakerChannel: row.speakerChannel,
    };
  });
}

export function buildCommittedEntryLiveRows(
  entries: SubtitleEntry[],
  maxRows = PIPELINE_DEFAULTS.liveLedgerMaxRows,
): LivePanelRow[] {
  return entries
    .slice(-maxRows)
    .map((entry) => createLivePanelRowFromEntry(entry, `entry::${entry.id}`));
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
