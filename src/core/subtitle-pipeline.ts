/**
 * 하위 호환 facade — 기존 import 경로 유지.
 * 구현: ./subtitle-pipeline/
 */
export type {
  PipelineSourceMeta,
  LiveRowCommitMeta,
  PipelineResult,
  IncrementalExtractResult,
} from "./subtitle-pipeline/index";
export {
  buildConfirmedCompactHistory,
  extractIncrementalTextFromHistory,
  flushPendingPreviews,
  applyPreview,
  commitLiveRow,
  applyStructuredEntry,
  applyKeepalive,
  applyReset,
  finalizeSession,
  hasRequiredSubtitleContent,
  isNoiseOnly,
  normalizeRawText,
} from "./subtitle-pipeline/index";
