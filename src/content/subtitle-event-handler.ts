import type { CaptureMode, NormalizedCaptureEvent } from "../core/live-capture";
import type { ObservedSubtitleRow } from "../shared/message-types";
import type { PersistabilityState } from "../shared/message-types";
import {
  resolveCaptureNotice,
  UNCONFIRMED_STALL_HINT_NOTICE,
  UNCONFIRMED_STALL_HINT_THRESHOLD,
} from "./capture-notice";

export const RESET_CAPTURE_NOTICE_MIN_MS = 2000;

export interface CaptureCommitAnalysis {
  previewText: string;
  stableRows: ObservedSubtitleRow[];
  hasUnstableRows: boolean;
  shouldCommit: boolean;
}

export interface StructuredCommitResult {
  changed: boolean;
  committed: boolean;
  sawDuplicate: boolean;
  sawFiltered: boolean;
}

export function analyzeCaptureCommit(input: Pick<NormalizedCaptureEvent, "captureMode" | "previewText" | "rows">): CaptureCommitAnalysis {
  if (input.captureMode !== "structured") {
    return {
      previewText: input.previewText,
      stableRows: [],
      hasUnstableRows: false,
      shouldCommit: false,
    };
  }

  const stableRows = input.rows.filter((row) => !row.unstableKey);
  return {
    previewText: input.previewText,
    stableRows,
    hasUnstableRows: stableRows.length !== input.rows.length,
    shouldCommit: stableRows.length > 0,
  };
}

export function hasOnlyStableRows(rows: ObservedSubtitleRow[]): boolean {
  return rows.length > 0 && rows.every((row) => !row.unstableKey);
}

export function shouldCommitCaptureEvent(input: {
  captureMode: CaptureMode;
  rows: ObservedSubtitleRow[];
  previewText?: string;
}): boolean {
  return analyzeCaptureCommit({
    captureMode: input.captureMode,
    rows: input.rows,
    previewText: input.previewText ?? "",
  }).shouldCommit;
}

export function resolveRuntimeCaptureNotice(input: {
  captureMode: CaptureMode;
  observerActive: boolean;
  hasStableRows: boolean;
  lastCommittedResetAt: number | null;
  now: number;
  persistabilityState: PersistabilityState;
  persistabilityHint: string;
  unconfirmedFallbackBlockStreak?: number;
}): string {
  if (
    input.captureMode !== "fallback" &&
    input.persistabilityState !== "idle" &&
    input.persistabilityState !== "persistable"
  ) {
    return input.persistabilityHint;
  }

  // When container fallback has been blocked by the unconfirmed filter for
  // several consecutive ticks, surface a soft hint so the user understands the
  // panel is intentionally pausing rather than silently broken.
  if (
    !input.hasStableRows &&
    typeof input.unconfirmedFallbackBlockStreak === "number" &&
    input.unconfirmedFallbackBlockStreak >= UNCONFIRMED_STALL_HINT_THRESHOLD
  ) {
    return UNCONFIRMED_STALL_HINT_NOTICE;
  }

  return resolveCaptureNotice({
    captureMode: input.captureMode,
    observerActive: input.observerActive,
    hasStableRows: input.hasStableRows,
    isResetting:
      typeof input.lastCommittedResetAt === "number" &&
      input.now - input.lastCommittedResetAt < RESET_CAPTURE_NOTICE_MIN_MS,
  });
}
