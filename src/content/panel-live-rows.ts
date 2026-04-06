import {
  createLivePanelRowFromEntry,
  type CaptureMode,
  type LivePanelRow,
} from "../core/live-capture";
import { sanitizeCommittedText } from "../core/subtitle-pipeline";
import type { SubtitleEntry } from "../core/subtitle-models";
import { isAssemblyPlenaryUrl, PIPELINE_DEFAULTS } from "../shared/constants";
import type { ExtensionSettings } from "../storage/types";

function cloneOptionalFramePath(framePath?: number[]): number[] | undefined {
  return framePath ? [...framePath] : undefined;
}

function resolveIsoTimestamp(value: string | undefined, fallback: string): string {
  return value && Number.isFinite(Date.parse(value)) ? value : fallback;
}

export function buildOutputEntriesFromPanelRows(
  rows: LivePanelRow[],
  now = Date.now(),
  settings?: Partial<ExtensionSettings>,
): SubtitleEntry[] {
  return rows.flatMap((row, index) => {
    const sanitizedText = sanitizeCommittedText(row.text, settings);
    if (!sanitizedText) {
      return [];
    }

    const resolvedMs =
      Number.isFinite(row.updatedAt) && row.updatedAt > 0
        ? row.updatedAt
        : now;
    const fallbackTimestamp = new Date(resolvedMs).toISOString();
    const timestamp = resolveIsoTimestamp(row.timestamp, fallbackTimestamp);
    const startTime = resolveIsoTimestamp(row.startTime, timestamp);
    const endTime = resolveIsoTimestamp(row.endTime, fallbackTimestamp);
    return [
      {
        id: row.entryId || `live:${row.key}:${resolvedMs}:${index}`,
        text: sanitizedText,
        timestamp,
        startTime,
        endTime,
        sourceSelector: row.sourceSelector,
        sourceFramePath: cloneOptionalFramePath(row.sourceFramePath),
        sourceNodeKey: row.sourceNodeKey || row.key,
        speakerColor: row.speakerColor,
        speakerChannel: row.speakerChannel,
      },
    ];
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

export function filterPanelLiveRows(
  rows: LivePanelRow[],
  settings?: Partial<ExtensionSettings>,
): LivePanelRow[] {
  return rows.flatMap((row) => {
    const sanitizedText = sanitizeCommittedText(row.text, settings);
    if (!sanitizedText) {
      return [];
    }

    return [
      {
        ...row,
        text: sanitizedText,
      },
    ];
  });
}
