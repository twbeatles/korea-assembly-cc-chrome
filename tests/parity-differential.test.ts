// 데스크톱 ↔ Chrome 차등 검증 하네스. 데스크톱 저장소의
// `python scripts/parity_differential.py` 가 무작위 입력(PARITY_DIFF_IN)을 만들고 이 파일을
// 실행해 Chrome 구현 결과(PARITY_DIFF_OUT)를 받은 뒤 데스크톱 결과와 비교한다.
// 환경 변수가 없는 일반 `npm test` 에서는 아무 일도 하지 않는다.
import { readFileSync, writeFileSync } from "node:fs";
import { it } from "vitest";

import { decideFallbackCommit } from "../src/core/subtitle-pipeline/fallback-commit-gate";
import type { FallbackGateCandidate } from "../src/core/subtitle-pipeline/fallback-commit-gate";
import {
  hasVisibleBackgroundHighlightValues,
  sampleEvenly,
} from "../src/content/subtitle-rows";
import {
  extractIncrementalTextFromHistory,
  extractIncrementalTextWithRecentHistory,
} from "../src/core/subtitle-pipeline/extract";
import {
  shouldApplyKeepalive,
  shouldMergeIntoLastEntry,
} from "../src/core/subtitle-pipeline/entry-policy";
import type { SubtitleEntry } from "../src/core/subtitle-models";
import {
  compactSubtitleText,
  joinStreamText,
  normalizeRawText,
} from "../src/core/text-normalizer";
import {
  hasRequiredSubtitleContent,
  isMeaningfulSubtitleText,
} from "../src/core/noise-filter";

/* eslint-disable @typescript-eslint/no-explicit-any */
it("parity differential dump (no-op without PARITY_DIFF_IN)", () => {
  const input = process.env.PARITY_DIFF_IN;
  const output = process.env.PARITY_DIFF_OUT;
  if (!input || !output) return;
  const cases = JSON.parse(readFileSync(input, "utf-8"));
  const minLength = 8;
  const baseIso = "2026-10-22T10:00:00.000Z";
  const baseMs = Date.parse(baseIso);
  const out: Record<string, any[]> = {};
  out.normalize = cases.normalize.map((c: any) => ({
    normalized: normalizeRawText(c.input),
    compact: compactSubtitleText(c.input),
  }));
  out.committable = cases.committable.map(
    (c: any) =>
      hasRequiredSubtitleContent(c.text) && isMeaningfulSubtitleText(c.text),
  );
  out.extractIncremental = cases.extractIncremental.map((c: any) =>
    extractIncrementalTextFromHistory(c.raw, c.history, minLength),
  );
  out.extractWithRecentHistory = cases.extractWithRecentHistory.map((c: any) =>
    extractIncrementalTextWithRecentHistory(
      c.raw,
      c.history,
      c.recent,
      minLength,
    ),
  );
  out.joinStreamText = cases.joinStreamText.map((c: any) =>
    joinStreamText(c.base, c.addition),
  );
  out.keepalive = cases.keepalive.map((c: any) =>
    shouldApplyKeepalive(c.raw, c.lastEntryText),
  );
  out.shouldMerge = cases.shouldMerge.map((c: any) =>
    shouldMergeIntoLastEntry(
      { endTime: baseIso, ...c.last } as SubtitleEntry,
      c.text,
      baseMs + c.nowOffsetMs,
      c.meta,
      {
        mergeGapSeconds: 5,
        mergeMaxChars: c.mergeMaxChars,
        afterReset: Boolean(c.afterReset),
      },
    ),
  );
  out.backgroundHighlight = cases.backgroundHighlight.map((c: any) =>
    hasVisibleBackgroundHighlightValues(c.backgroundColor, c.backgroundImage),
  );
  out.sampleEvenly = cases.sampleEvenly.map((c: any) =>
    sampleEvenly(
      Array.from({ length: c.count }, (_, i) => i),
      c.maxTake,
    ),
  );
  out.fallbackCommitGate = cases.fallbackCommitGate.map((c: any) => {
    let candidate: FallbackGateCandidate | null = null;
    return c.steps.map((s: any) => {
      const d = decideFallbackCommit(candidate, s.raw, s.atMs, {
        observationThreshold: 2,
        stableMs: 400,
        maxWaitMs: 2000,
      });
      candidate = d.commitNow ? null : d.candidate;
      return {
        commitNow: d.commitNow,
        delayMs: d.delayMs,
        observationCount: d.candidate.observationCount,
        replaced: d.replaced,
        maxWaitReached: d.maxWaitReached,
        pendingSince: d.candidate.pendingSince,
      };
    });
  });
  writeFileSync(output, JSON.stringify(out));
});
