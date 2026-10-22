import { PIPELINE_DEFAULTS } from "../../shared/constants";
import type { SpeakerChannel, SubtitleEntry } from "../subtitle-models";
import { compactSubtitleText } from "../text-normalizer";
import type { PipelineSourceMeta } from "./types";

/**
 * entry 병합·keepalive 판정 순수 함수.
 * 데스크톱(korea-assembly-cc) `core/subtitle_pipeline_impl/entry_policy.py` 와 같은 규칙이며
 * `parity/pipeline-vectors.json` 의 `shouldMerge` / `keepalive` 벡터로 양쪽을 함께 검증한다.
 */

export type MergeCandidateEntry = Pick<
  SubtitleEntry,
  "text" | "endTime" | "sourceNodeKey" | "speakerColor" | "speakerChannel"
>;

export interface MergePolicyOptions {
  mergeGapSeconds?: number;
  mergeMaxChars?: number;
  /** subtitle_reset 커밋 직후에는 새 entry 를 연다. */
  afterReset?: boolean;
}

function isKnownSpeakerChannel(
  channel: SpeakerChannel | undefined,
): channel is "primary" | "secondary" {
  return channel === "primary" || channel === "secondary";
}

/** 화자 경계: 양쪽 모두 알려진 channel 이 다르거나, 양쪽 색이 다르면 경계다. */
export function isSpeakerBoundary(
  lastEntry: Pick<SubtitleEntry, "speakerColor" | "speakerChannel">,
  meta?: Pick<PipelineSourceMeta, "speakerColor" | "speakerChannel">,
): boolean {
  const channelBoundary =
    isKnownSpeakerChannel(meta?.speakerChannel) &&
    isKnownSpeakerChannel(lastEntry.speakerChannel) &&
    meta?.speakerChannel !== lastEntry.speakerChannel;
  const colorBoundary = Boolean(
    meta?.speakerColor &&
    lastEntry.speakerColor &&
    meta.speakerColor !== lastEntry.speakerColor,
  );
  return channelBoundary || colorBoundary;
}

export function shouldMergeIntoLastEntry(
  lastEntry: MergeCandidateEntry,
  text: string,
  nowMs: number,
  meta?: PipelineSourceMeta,
  options: MergePolicyOptions = {},
): boolean {
  if (options.afterReset || meta?.forceNewEntry) {
    return false;
  }

  const structuredBoundary = Boolean(
    meta?.sourceNodeKey &&
    lastEntry.sourceNodeKey &&
    lastEntry.sourceNodeKey !== meta.sourceNodeKey,
  );
  const isFallbackMeta = meta?.sourceCaptureMode === "fallback";
  // structured/화자 신호가 있는 entry 뒤에 container fallback 이 오면 이어 붙이지 않는다.
  const fallbackBoundary =
    isFallbackMeta &&
    Boolean(
      lastEntry.sourceNodeKey ||
      lastEntry.speakerColor ||
      isKnownSpeakerChannel(lastEntry.speakerChannel),
    );
  // structured node key 가 없는 fallback 은 더 짧은 merge gap 을 쓴다.
  const isFallbackPath =
    isFallbackMeta || (!meta?.sourceNodeKey && !lastEntry.sourceNodeKey);
  const baseGapSeconds =
    options.mergeGapSeconds ?? PIPELINE_DEFAULTS.mergeGapSeconds;
  const mergeGapMs =
    (isFallbackPath
      ? Math.max(1, baseGapSeconds * PIPELINE_DEFAULTS.fallbackMergeGapFactor)
      : baseGapSeconds) * 1000;

  const lastEntryEndMs = Date.parse(lastEntry.endTime);
  const exceedsMergeGap =
    Number.isFinite(lastEntryEndMs) && nowMs - lastEntryEndMs > mergeGapMs;
  const mergeMaxChars =
    options.mergeMaxChars ?? PIPELINE_DEFAULTS.mergeMaxChars;

  return (
    !exceedsMergeGap &&
    !structuredBoundary &&
    !fallbackBoundary &&
    !isSpeakerBoundary(lastEntry, meta) &&
    lastEntry.text.length + text.length < mergeMaxChars
  );
}

/**
 * 동일 raw 유지 중 마지막 entry 의 endTime 을 연장해도 되는지 판정한다.
 * raw 가 비어 있으면(호출자가 raw 를 모름) 기존처럼 허용하고,
 * raw 가 있으면 화면 텍스트가 마지막 entry 로 끝날 때만 연장한다.
 */
export function shouldApplyKeepalive(
  raw: string | undefined,
  lastEntryText: string,
): boolean {
  const lastCompact = compactSubtitleText(lastEntryText);
  if (!lastCompact) {
    return false;
  }
  const rawCompact = compactSubtitleText(raw ?? "");
  if (!rawCompact) {
    return true;
  }
  return rawCompact === lastCompact || rawCompact.endsWith(lastCompact);
}
