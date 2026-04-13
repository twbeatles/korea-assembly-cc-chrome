import type { CaptureMode, NormalizedCaptureEvent } from "../core/live-capture";
import type { ObservedSubtitleRow } from "../shared/message-types";
import { resolveCaptureNotice } from "./capture-notice";

export const RESET_CAPTURE_NOTICE_MIN_MS = 2000;

export interface CaptureCommitAnalysis {
  previewText: string;
  stableRows: ObservedSubtitleRow[];
  hasUnstableRows: boolean;
  shouldCommit: boolean;
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
}): string {
  return resolveCaptureNotice({
    captureMode: input.captureMode,
    observerActive: input.observerActive,
    hasStableRows: input.hasStableRows,
    isResetting:
      typeof input.lastCommittedResetAt === "number" &&
      input.now - input.lastCommittedResetAt < RESET_CAPTURE_NOTICE_MIN_MS,
  });
}
