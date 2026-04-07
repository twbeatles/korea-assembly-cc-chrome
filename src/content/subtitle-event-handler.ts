import type { CaptureMode } from "../core/live-capture";
import type { ObservedSubtitleRow } from "../shared/message-types";
import { resolveCaptureNotice } from "./capture-notice";

export const RESET_CAPTURE_NOTICE_MIN_MS = 2000;

export function hasOnlyStableRows(rows: ObservedSubtitleRow[]): boolean {
  return rows.length > 0 && rows.every((row) => !row.unstableKey);
}

export function shouldCommitCaptureEvent(input: {
  captureMode: CaptureMode;
  rows: ObservedSubtitleRow[];
}): boolean {
  return input.captureMode === "structured" && hasOnlyStableRows(input.rows);
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
