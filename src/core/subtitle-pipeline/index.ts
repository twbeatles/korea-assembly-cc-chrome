/**
 * subtitle-pipeline 공개 진입점 (SOLID facade).
 * 타입·히스토리·증분 추출·커밋·라이프사이클 모듈로 분리.
 */
export type {
  PipelineSourceMeta,
  LiveRowCommitMeta,
  PipelineResult,
  IncrementalExtractResult,
} from "./types";

export { buildConfirmedCompactHistory } from "./history";
export { extractIncrementalTextFromHistory } from "./extract";
export {
  flushPendingPreviews,
  applyPreview,
  commitLiveRow,
  applyStructuredEntry,
} from "./commit";
export { applyKeepalive, applyReset, finalizeSession } from "./lifecycle";

export { hasRequiredSubtitleContent, isNoiseOnly } from "../noise-filter";
export { normalizeRawText } from "../text-normalizer";
