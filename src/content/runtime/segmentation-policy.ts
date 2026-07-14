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

/** 분할 임계값의 이 비율을 넘으면 사전 안내 대상. */
export const SEGMENT_CAPACITY_WARNING_RATIO = 0.85;

export type SegmentCapacityWarningReason = RuntimeSessionSegmentationReason;

/**
 * 자동 분할 직전 용량 경고. 임계값의 85% 이상이면 reason을 반환한다.
 * 이미 분할 임계에 도달한 경우는 null (롤오버가 담당).
 */
export function resolveSegmentCapacityWarning(
  state: SessionState,
  now = Date.now(),
  thresholds: RuntimeSessionSegmentationThresholds = DEFAULT_RUNTIME_SESSION_SEGMENTATION_THRESHOLDS,
  ratio = SEGMENT_CAPACITY_WARNING_RATIO,
): SegmentCapacityWarningReason | null {
  if (state.status !== "running" || !state.entries.length) {
    return null;
  }
  if (resolveRuntimeSessionSegmentationReason(state, now, thresholds)) {
    return null;
  }

  const safeRatio = Number.isFinite(ratio) && ratio > 0 && ratio < 1 ? ratio : SEGMENT_CAPACITY_WARNING_RATIO;
  const maxEntries = resolveSafeThreshold(
    thresholds.maxEntriesPerSegment,
    DEFAULT_RUNTIME_SESSION_SEGMENTATION_THRESHOLDS.maxEntriesPerSegment,
  );
  if (state.entries.length >= Math.floor(maxEntries * safeRatio)) {
    return "entry_limit";
  }

  const maxChars = resolveSafeThreshold(
    thresholds.maxCharsPerSegment,
    DEFAULT_RUNTIME_SESSION_SEGMENTATION_THRESHOLDS.maxCharsPerSegment,
  );
  if (getSessionCharCount(state.entries) >= Math.floor(maxChars * safeRatio)) {
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
  if (now - startedAtMs >= Math.floor(maxDurationMs * safeRatio)) {
    return "duration_limit";
  }

  return null;
}

export function buildSegmentCapacityWarningNotice(
  reason: SegmentCapacityWarningReason,
): string {
  switch (reason) {
    case "entry_limit":
      return "자막 수가 분할 기준에 가까워지고 있습니다. 곧 새 구간으로 자동 저장될 수 있습니다.";
    case "char_limit":
      return "자막 분량이 분할 기준에 가까워지고 있습니다. 곧 새 구간으로 자동 저장될 수 있습니다.";
    case "duration_limit":
      return "수집 시간이 분할 기준에 가까워지고 있습니다. 곧 새 구간으로 자동 저장될 수 있습니다.";
  }
}
