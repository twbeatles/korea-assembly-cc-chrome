import {
  DEFAULT_RUNTIME_SESSION_SEGMENT_MAX_CHARS,
  DEFAULT_RUNTIME_SESSION_SEGMENT_MAX_DURATION_MINUTES,
  DEFAULT_RUNTIME_SESSION_SEGMENT_MAX_ENTRIES,
} from "../../shared/constants";
import { getSessionCharCount, type SessionState } from "../../core/subtitle-models";
import type { ExtensionSettings } from "../../storage/types";

export type RuntimeSessionSegmentationReason =
  | "entry_limit"
  | "char_limit"
  | "duration_limit";

export interface RuntimeSessionSegmentationThresholds {
  maxEntriesPerSegment: number;
  maxCharsPerSegment: number;
  maxDurationMs: number;
}

export const DEFAULT_RUNTIME_SESSION_SEGMENTATION_THRESHOLDS: RuntimeSessionSegmentationThresholds = {
  maxEntriesPerSegment: DEFAULT_RUNTIME_SESSION_SEGMENT_MAX_ENTRIES,
  maxCharsPerSegment: DEFAULT_RUNTIME_SESSION_SEGMENT_MAX_CHARS,
  maxDurationMs: DEFAULT_RUNTIME_SESSION_SEGMENT_MAX_DURATION_MINUTES * 60 * 1000,
};

function resolveSafeThreshold(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export function resolveRuntimeSessionSegmentationThresholds(
  settings: Pick<
    ExtensionSettings,
    "maxEntriesPerSegment" | "maxCharsPerSegment" | "maxSegmentDurationMinutes"
  >,
): RuntimeSessionSegmentationThresholds {
  return {
    maxEntriesPerSegment: resolveSafeThreshold(
      settings.maxEntriesPerSegment,
      DEFAULT_RUNTIME_SESSION_SEGMENTATION_THRESHOLDS.maxEntriesPerSegment,
    ),
    maxCharsPerSegment: resolveSafeThreshold(
      settings.maxCharsPerSegment,
      DEFAULT_RUNTIME_SESSION_SEGMENTATION_THRESHOLDS.maxCharsPerSegment,
    ),
    maxDurationMs:
      resolveSafeThreshold(
        settings.maxSegmentDurationMinutes,
        DEFAULT_RUNTIME_SESSION_SEGMENT_MAX_DURATION_MINUTES,
      ) * 60 * 1000,
  };
}

export function resolveRuntimeSessionSegmentationReason(
  state: SessionState,
  now = Date.now(),
  thresholds: RuntimeSessionSegmentationThresholds = DEFAULT_RUNTIME_SESSION_SEGMENTATION_THRESHOLDS,
): RuntimeSessionSegmentationReason | null {
  if (state.status !== "running" || !state.entries.length) {
    return null;
  }

  const maxEntriesPerSegment = resolveSafeThreshold(
    thresholds.maxEntriesPerSegment,
    DEFAULT_RUNTIME_SESSION_SEGMENTATION_THRESHOLDS.maxEntriesPerSegment,
  );
  if (state.entries.length >= maxEntriesPerSegment) {
    return "entry_limit";
  }

  const maxCharsPerSegment = resolveSafeThreshold(
    thresholds.maxCharsPerSegment,
    DEFAULT_RUNTIME_SESSION_SEGMENTATION_THRESHOLDS.maxCharsPerSegment,
  );
  if (getSessionCharCount(state.entries) >= maxCharsPerSegment) {
    return "char_limit";
  }

  if (!state.startedAt) {
    return null;
  }

  const startedAtMs = Date.parse(state.startedAt);
  if (!Number.isFinite(startedAtMs)) {
    return null;
  }

  const maxDurationMs = resolveSafeThreshold(
    thresholds.maxDurationMs,
    DEFAULT_RUNTIME_SESSION_SEGMENTATION_THRESHOLDS.maxDurationMs,
  );
  if (now - startedAtMs >= maxDurationMs) {
    return "duration_limit";
  }

  return null;
}
