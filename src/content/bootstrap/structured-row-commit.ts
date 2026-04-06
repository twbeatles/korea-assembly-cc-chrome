import type { LiveCaptureRow } from "../../core/live-capture";
import {
  buildConfirmedCompactHistory,
  commitLiveRow,
  sanitizeCommittedText,
} from "../../core/subtitle-pipeline";
import type {
  SessionState,
  SubtitleEntry,
} from "../../core/subtitle-models";
import { normalizeSubtitleText } from "../../core/text-normalizer";
import type { ExtensionSettings } from "../../storage/types";

export interface StructuredRowCommitResult {
  state: SessionState;
  entry: SubtitleEntry | null;
  changed: boolean;
  baselineCompact: string | null;
  committedEntryId: string | null;
}

export function commitStructuredLiveRow(input: {
  state: SessionState;
  row: LiveCaptureRow;
  previewText: string;
  now: number;
  settings?: Partial<ExtensionSettings>;
  selector?: string;
  framePath?: number[];
}): StructuredRowCommitResult {
  const normalizedText = normalizeSubtitleText(input.row.text);
  const sanitizedText = sanitizeCommittedText(normalizedText, input.settings);
  if (!sanitizedText) {
    return {
      state: input.state,
      entry: null,
      changed: false,
      baselineCompact: input.row.baselineCompact,
      committedEntryId: input.row.committedEntryId,
    };
  }

  const existingEntry = input.row.committedEntryId
    ? input.state.entries.find((entry) => entry.id === input.row.committedEntryId)
    : undefined;

  const updateBaselineCompact =
    existingEntry && !input.row.unstableKey
      ? input.row.baselineCompact ??
        buildConfirmedCompactHistory(
          input.state.entries.filter((entry) => entry.id !== existingEntry.id),
        )
      : null;

  const canUpdateExisting = Boolean(existingEntry && !input.row.unstableKey);

  const baselineCompact = canUpdateExisting
    ? updateBaselineCompact
    : input.state.confirmedCompact;

  const result = commitLiveRow(
    input.state,
    sanitizedText,
    input.previewText,
    input.now,
    input.settings,
    {
      selector: input.selector,
      framePath: input.framePath,
      sourceNodeKey: input.row.key,
      ...(canUpdateExisting && existingEntry
        ? { entryId: existingEntry.id }
        : {}),
      baselineCompact,
    },
  );

  return {
    state: result.state,
    entry: result.appendedEntry ?? null,
    changed: result.changed,
    baselineCompact: result.appendedEntry ? baselineCompact : input.row.baselineCompact,
    committedEntryId: result.appendedEntry?.id ?? input.row.committedEntryId,
  };
}
