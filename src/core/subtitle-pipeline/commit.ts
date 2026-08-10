import { PIPELINE_DEFAULTS } from "../../shared/constants";
import type { ExtensionSettings } from "../../storage/types";
import {
  hasRequiredSubtitleContent,
  isMeaningfulSubtitleText,
  isNoiseOnly,
} from "../noise-filter";
import {
  createId,
  type SessionState,
  type SubtitleEntry,
} from "../subtitle-models";
import {
  compactSubtitleText,
  joinStreamText,
  normalizeRawText,
} from "../text-normalizer";
import { toIsoString } from "../timeline";
import {
  applySourceMeta,
  cloneEntryAtIndex,
  cloneStateStructure,
  updateStateMetadata,
} from "./state-helpers";
import {
  buildConfirmedCompactHistory,
  buildRecentCompactHistory,
  rebuildConfirmedHistory,
  resolveRecentDuplicateMinLength,
  resolveRecentHistoryCompactLength,
  softResyncHistory,
} from "./history";
import { extractIncrementalTextWithRecentHistory } from "./extract";
import type { LiveRowCommitMeta, PipelineResult, PipelineSourceMeta } from "./types";

function sanitizeCommittedText(
  text: string,
  settings?: Partial<ExtensionSettings>,
): string {
  const normalizedText = normalizeRawText(text);

  if (!normalizedText || !hasRequiredSubtitleContent(normalizedText)) {
    return "";
  }

  if (
    settings?.noiseFilterEnabled !== false &&
    (!isMeaningfulSubtitleText(normalizedText) || isNoiseOnly(normalizedText))
  ) {
    return "";
  }

  return normalizedText;
}

function updateEntryById(
  state: SessionState,
  entryId: string,
  text: string,
  nowIso: string,
  meta?: PipelineSourceMeta,
): { entry: SubtitleEntry | undefined; changed: boolean } {
  const entryIndex = state.entries.findIndex((candidate) => candidate.id === entryId);
  if (entryIndex < 0) {
    return {
      entry: undefined,
      changed: false,
    };
  }

  const previous = state.entries[entryIndex];
  const entry = cloneEntryAtIndex(state, entryIndex);
  if (!entry) {
    return {
      entry: undefined,
      changed: false,
    };
  }

  const beforeText = previous.text;
  const beforeSelector = previous.sourceSelector ?? "";
  const beforeSourceNodeKey = previous.sourceNodeKey ?? "";
  const beforeFramePath = JSON.stringify(previous.sourceFramePath ?? []);

  entry.text = text;
  entry.endTime = nowIso;
  applySourceMeta(entry, meta);

  return {
    entry,
    changed:
      beforeText !== entry.text ||
      beforeSelector !== (entry.sourceSelector ?? "") ||
      beforeSourceNodeKey !== (entry.sourceNodeKey ?? "") ||
      beforeFramePath !== JSON.stringify(entry.sourceFramePath ?? []),
  };
}

function appendOrMergeEntry(
  state: SessionState,
  text: string,
  nowMs: number,
  nowIso: string,
  meta?: PipelineSourceMeta,
): SubtitleEntry {
  const lastEntryIndex = state.entries.length - 1;
  const lastEntry = lastEntryIndex >= 0 ? state.entries[lastEntryIndex] : undefined;

  if (lastEntry && !state.lastCommittedResetAt && !meta?.forceNewEntry) {
    const structuredBoundary = Boolean(
      meta?.sourceNodeKey &&
        lastEntry.sourceNodeKey &&
        lastEntry.sourceNodeKey !== meta.sourceNodeKey,
    );
    const speakerChannelBoundary = Boolean(
      meta?.speakerChannel &&
        lastEntry.speakerChannel &&
        meta.speakerChannel !== lastEntry.speakerChannel,
    );
    const speakerColorBoundary = Boolean(
      meta?.speakerColor &&
        lastEntry.speakerColor &&
        meta.speakerColor !== lastEntry.speakerColor,
    );
    // structured node key 가 없는 fallback 은 더 짧은 merge gap 을 쓴다.
    const isFallbackPath =
      meta?.sourceCaptureMode === "fallback" ||
      (!meta?.sourceNodeKey && !lastEntry.sourceNodeKey);
    const mergeGapMs =
      (isFallbackPath
        ? Math.max(1, PIPELINE_DEFAULTS.mergeGapSeconds * 0.4)
        : PIPELINE_DEFAULTS.mergeGapSeconds) * 1000;

    const lastEntryEndMs = Date.parse(lastEntry.endTime);
    const exceedsMergeGap =
      Number.isFinite(lastEntryEndMs) && nowMs - lastEntryEndMs > mergeGapMs;

    const canMerge =
      !exceedsMergeGap &&
      !structuredBoundary &&
      !speakerChannelBoundary &&
      !speakerColorBoundary &&
      lastEntry.text.length + text.length < PIPELINE_DEFAULTS.mergeMaxChars;

    if (canMerge) {
      const mergedEntry = cloneEntryAtIndex(state, lastEntryIndex);
      if (mergedEntry) {
        mergedEntry.text = joinStreamText(mergedEntry.text, text);
        mergedEntry.endTime = nowIso;
        applySourceMeta(mergedEntry, meta);
        return mergedEntry;
      }
    }
  }

  const speakerChanged = Boolean(
    lastEntry &&
      ((meta?.speakerChannel &&
        lastEntry.speakerChannel &&
        meta.speakerChannel !== lastEntry.speakerChannel) ||
        (meta?.speakerColor &&
          lastEntry.speakerColor &&
          meta.speakerColor !== lastEntry.speakerColor)),
  );

  const entry: SubtitleEntry = {
    id: createId("subtitle"),
    text,
    timestamp: nowIso,
    startTime: nowIso,
    endTime: nowIso,
  };
  applySourceMeta(entry, meta);
  if (speakerChanged) {
    entry.speakerChanged = true;
  }
  state.entries.push(entry);
  return entry;
}

export function flushPendingPreviews(
  state: SessionState,
  now: number,
  settings?: Partial<ExtensionSettings>,
): SessionState {
  let preparedState = cloneStateStructure(state);
  const pendingPreviews = preparedState.pendingPreviews
    .map((preview) => normalizeRawText(preview))
    .filter(Boolean);

  preparedState.pendingPreviews = [];
  pendingPreviews.forEach((preview, index) => {
    preparedState = applyPreview(preparedState, preview, now + index, settings, {
      selector: preparedState.currentSelector || undefined,
      framePath: preparedState.currentFramePath.length
        ? preparedState.currentFramePath
        : undefined,
    }).state;
  });

  return preparedState;
}

export function applyPreview(
  state: SessionState,
  raw: string,
  now: number,
  settings?: Partial<ExtensionSettings>,
  meta?: PipelineSourceMeta,
): PipelineResult {
  const next = updateStateMetadata(state, now, meta);
  const normalizedRaw = normalizeRawText(raw);
  const previewChanged = next.previewText !== normalizedRaw;

  next.previewText = normalizedRaw;
  next.lastObservedRaw = normalizedRaw;

  const recentDuplicateMinLength = resolveRecentDuplicateMinLength(settings);
  const extraction = extractIncrementalTextWithRecentHistory(
    normalizedRaw,
    next.confirmedCompact,
    buildRecentCompactHistory(next.entries, settings),
    recentDuplicateMinLength,
  );

  if (!extraction.matched && next.confirmedCompact) {
    next.previewDesyncCount += 1;
  } else {
    next.previewDesyncCount = 0;
  }

  if (extraction.ambiguous) {
    next.previewAmbiguousSkipCount += 1;
  } else {
    next.previewAmbiguousSkipCount = 0;
  }

  if (
    next.entries.length > 0 &&
    (next.previewDesyncCount >= PIPELINE_DEFAULTS.previewResyncThreshold ||
      next.previewAmbiguousSkipCount >= PIPELINE_DEFAULTS.previewAmbiguousResyncThreshold)
  ) {
    softResyncHistory(next, settings);
  }

  const retriedExtraction =
    next.previewDesyncCount === 0 && next.previewAmbiguousSkipCount === 0
      ? extractIncrementalTextWithRecentHistory(
          normalizedRaw,
          next.confirmedCompact,
          buildRecentCompactHistory(next.entries, settings),
          recentDuplicateMinLength,
        )
      : extraction;

  if (retriedExtraction.duplicate || !retriedExtraction.text) {
    return {
      state: next,
      changed: previewChanged,
      reason: `preview_${retriedExtraction.reason}`,
    };
  }

  const candidateText = sanitizeCommittedText(retriedExtraction.text, settings);
  if (!candidateText) {
    return {
      state: next,
      changed: previewChanged,
      reason: "preview_filtered",
    };
  }

  const appendedEntry = appendOrMergeEntry(next, candidateText, now, toIsoString(now), meta);
  next.lastProcessedRaw = normalizedRaw;
  next.lastCommittedResetAt = null;
  next.previewDesyncCount = 0;
  next.previewAmbiguousSkipCount = 0;
  rebuildConfirmedHistory(next, settings);

  return {
    state: next,
    changed: true,
    appendedEntry,
    reason: `preview_${retriedExtraction.reason}`,
  };
}

export function commitLiveRow(
  state: SessionState,
  rowText: string,
  previewText: string,
  now: number,
  settings?: Partial<ExtensionSettings>,
  meta?: LiveRowCommitMeta,
): PipelineResult {
  const next = updateStateMetadata(state, now, meta);
  const normalizedPreview = normalizeRawText(previewText) || normalizeRawText(rowText);
  const previewChanged = next.previewText !== normalizedPreview;
  const baselineCompact = meta?.baselineCompact ?? next.confirmedCompact;
  const recentBaselineCompact = compactSubtitleText(baselineCompact).slice(
    -resolveRecentHistoryCompactLength(settings),
  );

  next.previewText = normalizedPreview;
  next.lastObservedRaw = normalizedPreview;

  const extraction = extractIncrementalTextWithRecentHistory(
    rowText,
    baselineCompact,
    recentBaselineCompact,
    resolveRecentDuplicateMinLength(settings),
  );
  const candidateText = sanitizeCommittedText(extraction.text, settings);

  if (!candidateText) {
    return {
      state: next,
      changed: previewChanged,
      reason: extraction.duplicate ? "row_duplicate" : "row_filtered",
    };
  }

  const nowIso = toIsoString(now);

  if (meta?.entryId) {
    const updated = updateEntryById(next, meta.entryId, candidateText, nowIso, meta);
    if (!updated.entry) {
      return {
        state: next,
        changed: previewChanged,
        reason: "row_entry_missing",
      };
    }

    next.lastProcessedRaw = normalizeRawText(rowText);
    next.lastCommittedResetAt = null;
    rebuildConfirmedHistory(next, settings);

    return {
      state: next,
      changed: previewChanged || updated.changed,
      appendedEntry: updated.entry,
      reason: "row_update",
    };
  }

  const appendedEntry = appendOrMergeEntry(next, candidateText, now, nowIso, {
    ...meta,
    forceNewEntry: true,
  });
  next.lastProcessedRaw = normalizeRawText(rowText);
  next.lastCommittedResetAt = null;
  rebuildConfirmedHistory(next, settings);

  return {
    state: next,
    changed: true,
    appendedEntry,
    reason: "row_append",
  };
}

export function applyStructuredEntry(
  state: SessionState,
  text: string,
  previewText: string,
  now: number,
  settings?: Partial<ExtensionSettings>,
  meta?: PipelineSourceMeta,
): PipelineResult {
  const lastEntry = state.entries.at(-1);

  if (
    meta?.sourceNodeKey &&
    lastEntry?.sourceNodeKey === meta.sourceNodeKey &&
    !meta.forceNewEntry
  ) {
    const baselineCompact = buildConfirmedCompactHistory(state.entries.slice(0, -1));
    return commitLiveRow(state, text, previewText, now, settings, {
      ...meta,
      entryId: lastEntry.id,
      baselineCompact,
    });
  }

  return commitLiveRow(state, text, previewText, now, settings, {
    ...meta,
    baselineCompact: state.confirmedCompact,
  });
}
