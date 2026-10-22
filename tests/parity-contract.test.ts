import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ASSEMBLY_HOSTS,
  PIPELINE_DEFAULTS,
  DEFAULT_EXTENSION_SETTINGS,
  isAssemblyPlenaryUrl,
} from "../src/shared/constants";
import {
  FALLBACK_COMMIT_OBSERVATION_THRESHOLD,
  FALLBACK_COMMIT_STABLE_MS,
  SUBTITLE_RESET_GRACE_MS,
} from "../src/content/app/runtime/constants";
import { getSubtitleSelectorCandidates } from "../src/content/dom-probe";
import {
  PRIMARY_SPEAKER_COLOR,
  SECONDARY_SPEAKER_COLOR,
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
import {
  LARGE_APPEND_MIN,
  MIN_COMPACT_ANCHOR,
} from "../src/core/subtitle-pipeline/types";
import type { PipelineSourceMeta } from "../src/core/subtitle-pipeline/types";
import type { SubtitleEntry } from "../src/core/subtitle-models";
import {
  compactSubtitleText,
  joinStreamText,
  normalizeRawText,
} from "../src/core/text-normalizer";
import {
  hasRequiredSubtitleContent,
  isMeaningfulSubtitleText,
  isPlaceholderSubtitleText,
} from "../src/core/noise-filter";

// 데스크톱 저장소(korea-assembly-cc)의 tests/test_parity_contract.py 와 같은 파일을 검증한다.
function readParityJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(resolve(__dirname, "..", "parity", name), "utf8"),
  ) as T;
}

interface CaptureContract {
  site: {
    primaryHost: string;
    plenary: { xcode: string; xcgcdPrefix: string };
  };
  selectorCandidatesOrdered: string[];
  speakerColors: { primary: string; secondary: string };
  unconfirmed: {
    filterEnabledByDefault: boolean;
    containerFallbackAllowStreak: number;
    knownHighlightBackgrounds: string[];
  };
  placeholderTexts: string[];
  pipeline: Record<string, number | boolean>;
  intentionalDifferences: { mergeMaxChars: { chrome: number } };
}

interface Vectors {
  defaults: {
    recentDuplicateMinLength: number;
    mergeGapSeconds: number;
    mergeMaxChars: number;
    baseTimeIso: string;
    lastEntryText: string;
    nextText: string;
  };
  normalize: Array<{ input: string; normalized: string; compact: string }>;
  extractIncremental: Array<{
    name: string;
    raw: string;
    history: string;
    expected: unknown;
  }>;
  extractWithRecentHistory: Array<{
    name: string;
    raw: string;
    history: string;
    recent: string;
    expected: unknown;
  }>;
  joinStreamText: Array<{ base: string; addition: string; expected: string }>;
  committable: Array<{ text: string; expected: boolean }>;
  shouldMerge: Array<{
    name: string;
    last: Partial<SubtitleEntry>;
    meta: PipelineSourceMeta;
    text?: string;
    nowOffsetMs: number;
    mergeMaxChars?: number;
    afterReset?: boolean;
    expected: boolean;
  }>;
  keepalive: Array<{ raw: string; lastEntryText: string; expected: boolean }>;
  backgroundHighlight: Array<{
    backgroundColor: string;
    backgroundImage: string;
    expected: boolean;
  }>;
  sampleEvenly: Array<{
    count: number;
    maxTake: number;
    expectedIndices: number[];
  }>;
}

const contract = readParityJson<CaptureContract>("capture-contract.json");
const vectors = readParityJson<Vectors>("pipeline-vectors.json");

describe("parity capture contract (desktop ↔ chrome)", () => {
  it("keeps site, selector and speaker color constants", () => {
    expect(ASSEMBLY_HOSTS.map((host) => new URL(host).hostname)[0]).toBe(
      contract.site.primaryHost,
    );
    expect(getSubtitleSelectorCandidates("")).toEqual(
      contract.selectorCandidatesOrdered,
    );
    expect(PRIMARY_SPEAKER_COLOR).toBe(contract.speakerColors.primary);
    expect(SECONDARY_SPEAKER_COLOR).toBe(contract.speakerColors.secondary);
    const { xcode, xcgcdPrefix } = contract.site.plenary;
    expect(
      isAssemblyPlenaryUrl(
        `https://${contract.site.primaryHost}/main/player.asp?xcode=${xcode}`,
      ),
    ).toBe(true);
    expect(
      isAssemblyPlenaryUrl(
        `https://${contract.site.primaryHost}/main/player.asp?xcode=26&xcgcd=${xcgcdPrefix}224390101`,
      ),
    ).toBe(true);
  });

  it("keeps pipeline constants", () => {
    const p = contract.pipeline;
    expect(PIPELINE_DEFAULTS.suffixLength).toBe(p.suffixLength);
    expect(MIN_COMPACT_ANCHOR).toBe(p.minCompactAnchor);
    expect(LARGE_APPEND_MIN).toBe(p.largeAppendMin);
    expect(PIPELINE_DEFAULTS.recentDuplicateMinLength).toBe(
      p.recentDuplicateMinLength,
    );
    expect(PIPELINE_DEFAULTS.recentHistoryEntries).toBe(p.recentHistoryEntries);
    expect(PIPELINE_DEFAULTS.recentHistoryCompactLength).toBe(
      p.recentHistoryCompactLength,
    );
    expect(PIPELINE_DEFAULTS.recentResyncEntries).toBe(p.recentResyncEntries);
    expect(PIPELINE_DEFAULTS.previewResyncThreshold).toBe(
      p.previewResyncThreshold,
    );
    expect(PIPELINE_DEFAULTS.previewAmbiguousResyncThreshold).toBe(
      p.previewAmbiguousResyncThreshold,
    );
    expect(PIPELINE_DEFAULTS.confirmedCompactMaxLength).toBe(
      p.confirmedCompactMaxLength,
    );
    expect(PIPELINE_DEFAULTS.mergeGapSeconds).toBe(p.mergeGapSeconds);
    expect(PIPELINE_DEFAULTS.fallbackMergeGapFactor).toBe(
      p.fallbackMergeGapFactor,
    );
    expect(PIPELINE_DEFAULTS.keepaliveIntervalMs).toBe(p.keepaliveIntervalMs);
    expect(SUBTITLE_RESET_GRACE_MS).toBe(p.subtitleResetGraceMs);
    expect(PIPELINE_DEFAULTS.liveLedgerMaxRows).toBe(p.liveLedgerMaxRows);
    expect(FALLBACK_COMMIT_OBSERVATION_THRESHOLD).toBe(
      p.fallbackCommitObservationThreshold,
    );
    expect(FALLBACK_COMMIT_STABLE_MS).toBe(p.fallbackCommitStableMs);
    expect(PIPELINE_DEFAULTS.fallbackInternalRawMaxChars).toBe(
      p.fallbackInternalRawMaxChars,
    );
    expect(PIPELINE_DEFAULTS.fallbackPreviewMaxChars).toBe(
      p.fallbackPreviewMaxChars,
    );
    expect(PIPELINE_DEFAULTS.unconfirmedFallbackAllowStreak).toBe(
      contract.unconfirmed.containerFallbackAllowStreak,
    );
    expect(DEFAULT_EXTENSION_SETTINGS.filterUnconfirmedEnabled).toBe(
      contract.unconfirmed.filterEnabledByDefault,
    );
    expect(PIPELINE_DEFAULTS.mergeMaxChars).toBe(
      contract.intentionalDifferences.mergeMaxChars.chrome,
    );
  });

  it("treats contract placeholders and highlight backgrounds as non-committable", () => {
    contract.placeholderTexts.forEach((text) => {
      expect(isPlaceholderSubtitleText(`${text}...`)).toBe(true);
    });
    contract.unconfirmed.knownHighlightBackgrounds.forEach((color) => {
      expect(hasVisibleBackgroundHighlightValues(color, "none")).toBe(true);
    });
  });
});

describe("parity pipeline vectors (desktop ↔ chrome)", () => {
  const minLength = vectors.defaults.recentDuplicateMinLength;

  it.each(vectors.normalize)("normalize %#", (c) => {
    expect(normalizeRawText(c.input)).toBe(c.normalized);
    expect(compactSubtitleText(c.input)).toBe(c.compact);
  });

  it.each(vectors.extractIncremental)("extract $name", (c) => {
    expect(
      extractIncrementalTextFromHistory(c.raw, c.history, minLength),
    ).toEqual(c.expected);
  });

  it.each(vectors.extractWithRecentHistory)("extract recent $name", (c) => {
    expect(
      extractIncrementalTextWithRecentHistory(
        c.raw,
        c.history,
        c.recent,
        minLength,
      ),
    ).toEqual(c.expected);
  });

  it.each(vectors.joinStreamText)("join %#", (c) => {
    expect(joinStreamText(c.base, c.addition)).toBe(c.expected);
  });

  it.each(vectors.committable)("committable $text", (c) => {
    expect(
      hasRequiredSubtitleContent(c.text) && isMeaningfulSubtitleText(c.text),
    ).toBe(c.expected);
  });

  it.each(vectors.shouldMerge)("merge $name", (c) => {
    const baseMs = Date.parse(vectors.defaults.baseTimeIso);
    const lastEntry = {
      text: vectors.defaults.lastEntryText,
      endTime: vectors.defaults.baseTimeIso,
      ...c.last,
    } as SubtitleEntry;
    expect(
      shouldMergeIntoLastEntry(
        lastEntry,
        c.text ?? vectors.defaults.nextText,
        baseMs + c.nowOffsetMs,
        c.meta,
        {
          mergeGapSeconds: vectors.defaults.mergeGapSeconds,
          mergeMaxChars: c.mergeMaxChars ?? vectors.defaults.mergeMaxChars,
          afterReset: Boolean(c.afterReset),
        },
      ),
    ).toBe(c.expected);
  });

  it.each(vectors.keepalive)("keepalive %#", (c) => {
    expect(shouldApplyKeepalive(c.raw, c.lastEntryText)).toBe(c.expected);
  });

  it.each(vectors.backgroundHighlight)("highlight %#", (c) => {
    expect(
      hasVisibleBackgroundHighlightValues(c.backgroundColor, c.backgroundImage),
    ).toBe(c.expected);
  });

  it.each(vectors.sampleEvenly)("sampleEvenly %#", (c) => {
    expect(
      sampleEvenly(
        Array.from({ length: c.count }, (_, index) => index),
        c.maxTake,
      ),
    ).toEqual(c.expectedIndices);
  });
});
