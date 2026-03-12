import { PIPELINE_DEFAULTS } from "../shared/constants";
import type { ExtensionSettings } from "../storage/types";
import {
  hasRequiredSubtitleContent,
  isMeaningfulSubtitleText,
  isNoiseOnly,
} from "./noise-filter";
import {
  cloneState,
  createId,
  type SessionState,
  type SubtitleEntry,
} from "./subtitle-models";
import {
  compactSubtitleText,
  joinStreamText,
  normalizeRawText,
  stripZeroWidth,
} from "./text-normalizer";
import { toIsoString } from "./timeline";

const MIN_COMPACT_ANCHOR = 10;
const LARGE_APPEND_MIN = 200;

export interface PipelineSourceMeta {
  selector?: string;
  framePath?: number[];
  sourceNodeKey?: string;
  forceNewEntry?: boolean;
}

export interface LiveRowCommitMeta extends PipelineSourceMeta {
  entryId?: string;
  baselineCompact?: string | null;
}

export interface PipelineResult {
  state: SessionState;
  changed: boolean;
  appendedEntry?: SubtitleEntry;
  reason?: string;
}

export interface IncrementalExtractResult {
  text: string;
  matched: boolean;
  duplicate: boolean;
  ambiguous: boolean;
  reason:
    | "empty"
    | "no_history"
    | "identical_history"
    | "contained_in_history"
    | "suffix"
    | "suffix_duplicate"
    | "history"
    | "history_duplicate"
    | "overlap"
    | "overlap_duplicate"
    | "full";
}

function updateStateMetadata(
  state: SessionState,
  now: number,
  meta?: PipelineSourceMeta,
): SessionState {
  const next = cloneState(state);
  next.updatedAt = toIsoString(now);
  next.lastObserverEventAt = now;
  if (meta?.selector) {
    next.currentSelector = meta.selector;
  }
  if (meta?.framePath) {
    next.currentFramePath = [...meta.framePath];
  }
  return next;
}

function applySourceMeta(entry: SubtitleEntry, meta?: PipelineSourceMeta): void {
  if (!meta) {
    return;
  }
  if (meta.selector) {
    entry.sourceSelector = meta.selector;
  }
  if (meta.framePath) {
    entry.sourceFramePath = [...meta.framePath];
  }
  if (meta.sourceNodeKey) {
    entry.sourceNodeKey = meta.sourceNodeKey;
  }
}

export function buildConfirmedCompactHistory(
  entries: SubtitleEntry[],
  maxLength: number = PIPELINE_DEFAULTS.confirmedCompactMaxLength,
): string {
  if (!entries.length) {
    return "";
  }

  const parts: string[] = [];
  let currentLength = 0;

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const compact = compactSubtitleText(entries[index].text);
    if (!compact) {
      continue;
    }

    parts.unshift(compact);
    currentLength += compact.length;
    if (currentLength >= maxLength) {
      break;
    }
  }

  return parts.join("").slice(-maxLength);
}

function resolveConfirmedCompactMaxLength(
  settings?: Partial<ExtensionSettings>,
): number {
  const candidate = Number(settings?.maxBufferLength);
  if (Number.isFinite(candidate) && candidate >= 1000) {
    return Math.floor(candidate);
  }
  return PIPELINE_DEFAULTS.confirmedCompactMaxLength;
}

function rebuildConfirmedHistory(
  state: SessionState,
  settings?: Partial<ExtensionSettings>,
): void {
  state.confirmedCompact = buildConfirmedCompactHistory(
    state.entries,
    resolveConfirmedCompactMaxLength(settings),
  );
  state.trailingSuffix = state.confirmedCompact.slice(-PIPELINE_DEFAULTS.suffixLength);
}

function softResyncHistory(
  state: SessionState,
  settings?: Partial<ExtensionSettings>,
): void {
  const recentEntries = state.entries.slice(-PIPELINE_DEFAULTS.recentResyncEntries);
  state.confirmedCompact = buildConfirmedCompactHistory(
    recentEntries,
    resolveConfirmedCompactMaxLength(settings),
  );
  state.trailingSuffix = state.confirmedCompact.slice(-PIPELINE_DEFAULTS.suffixLength);
  state.previewDesyncCount = 0;
  state.previewAmbiguousSkipCount = 0;
}

function buildRecentCompactHistory(entries: SubtitleEntry[]): string {
  return buildConfirmedCompactHistory(
    entries.slice(-PIPELINE_DEFAULTS.recentHistoryEntries),
    PIPELINE_DEFAULTS.recentHistoryCompactLength,
  );
}

function extractIncrementalTextWithRecentHistory(
  rawText: string,
  historyCompact: string,
  recentHistoryCompact: string,
): IncrementalExtractResult {
  const recentHistory = compactSubtitleText(recentHistoryCompact);
  const fullHistory = compactSubtitleText(historyCompact);

  if (recentHistory && recentHistory !== fullHistory) {
    const recentResult = extractIncrementalTextFromHistory(rawText, recentHistory);
    if (recentResult.matched || recentResult.duplicate) {
      return recentResult;
    }
  }

  return extractIncrementalTextFromHistory(rawText, fullHistory);
}

function sliceFromCompactIndex(text: string, compactIndex: number): string {
  const raw = stripZeroWidth(String(text || ""));
  if (compactIndex <= 0) {
    return normalizeRawText(raw);
  }

  let seenCompactChars = 0;
  let index = 0;

  while (index < raw.length) {
    const char = raw[index];
    if (!/\s/.test(char)) {
      seenCompactChars += 1;
      if (seenCompactChars >= compactIndex) {
        index += 1;
        break;
      }
    }
    index += 1;
  }

  return normalizeRawText(raw.slice(index));
}

function findCompactSuffixPrefixOverlap(
  historyCompact: string,
  rawCompact: string,
  minOverlap = MIN_COMPACT_ANCHOR,
): number {
  const maxOverlap = Math.min(historyCompact.length, rawCompact.length);
  for (let length = maxOverlap; length >= minOverlap; length -= 1) {
    if (historyCompact.slice(-length) === rawCompact.slice(0, length)) {
      return length;
    }
  }
  return 0;
}

export function extractIncrementalTextFromHistory(
  rawText: string,
  historyCompact: string,
): IncrementalExtractResult {
  const normalizedRaw = normalizeRawText(rawText);
  const rawCompact = compactSubtitleText(normalizedRaw);
  const compactHistory = compactSubtitleText(historyCompact);

  if (!rawCompact) {
    return {
      text: "",
      matched: false,
      duplicate: true,
      ambiguous: false,
      reason: "empty",
    };
  }

  if (!compactHistory) {
    return {
      text: normalizedRaw,
      matched: false,
      duplicate: false,
      ambiguous: false,
      reason: "no_history",
    };
  }

  if (rawCompact === compactHistory) {
    return {
      text: "",
      matched: true,
      duplicate: true,
      ambiguous: false,
      reason: "identical_history",
    };
  }

  if (
    rawCompact.length >= PIPELINE_DEFAULTS.recentDuplicateMinLength &&
    compactHistory.includes(rawCompact)
  ) {
    return {
      text: "",
      matched: false,
      duplicate: true,
      ambiguous: false,
      reason: "contained_in_history",
    };
  }

  const suffix = compactHistory.slice(-PIPELINE_DEFAULTS.suffixLength);
  if (suffix) {
    const firstPos = rawCompact.indexOf(suffix);
    const lastPos = rawCompact.lastIndexOf(suffix);
    if (lastPos >= 0) {
      const compactStart = lastPos + suffix.length;
      const text = sliceFromCompactIndex(normalizedRaw, compactStart);
      const predictedAppend = Math.max(0, rawCompact.length - compactStart);
      return {
        text,
        matched: true,
        duplicate: !text,
        ambiguous:
          firstPos !== lastPos &&
          predictedAppend > Math.max(LARGE_APPEND_MIN, Math.floor(rawCompact.length / 3)),
        reason: text ? "suffix" : "suffix_duplicate",
      };
    }
  }

  if (compactHistory.length >= MIN_COMPACT_ANCHOR) {
    const historyPos = rawCompact.lastIndexOf(compactHistory);
    if (historyPos >= 0) {
      const compactStart = historyPos + compactHistory.length;
      const text = sliceFromCompactIndex(normalizedRaw, compactStart);
      return {
        text,
        matched: true,
        duplicate: !text,
        ambiguous: false,
        reason: text ? "history" : "history_duplicate",
      };
    }
  }

  const overlap = findCompactSuffixPrefixOverlap(compactHistory, rawCompact);
  if (overlap > 0) {
    const text = sliceFromCompactIndex(normalizedRaw, overlap);
    return {
      text,
      matched: true,
      duplicate: !text,
      ambiguous: false,
      reason: text ? "overlap" : "overlap_duplicate",
    };
  }

  return {
    text: normalizedRaw,
    matched: false,
    duplicate: false,
    ambiguous: false,
    reason: "full",
  };
}

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
  const entry = state.entries.find((candidate) => candidate.id === entryId);
  if (!entry) {
    return {
      entry: undefined,
      changed: false,
    };
  }

  const beforeText = entry.text;
  const beforeSelector = entry.sourceSelector ?? "";
  const beforeSourceNodeKey = entry.sourceNodeKey ?? "";
  const beforeFramePath = JSON.stringify(entry.sourceFramePath ?? []);

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
  const lastEntry = state.entries.at(-1);

  if (lastEntry && !state.lastCommittedResetAt && !meta?.forceNewEntry) {
    const structuredBoundary = Boolean(
      meta?.sourceNodeKey &&
        lastEntry.sourceNodeKey &&
        lastEntry.sourceNodeKey !== meta.sourceNodeKey,
    );

    const lastEntryEndMs = Date.parse(lastEntry.endTime);
    const exceedsMergeGap =
      Number.isFinite(lastEntryEndMs) &&
      nowMs - lastEntryEndMs > PIPELINE_DEFAULTS.mergeGapSeconds * 1000;

    const canMerge =
      !exceedsMergeGap &&
      !structuredBoundary &&
      lastEntry.text.length + text.length < PIPELINE_DEFAULTS.mergeMaxChars;

    if (canMerge) {
      lastEntry.text = joinStreamText(lastEntry.text, text);
      lastEntry.endTime = nowIso;
      applySourceMeta(lastEntry, meta);
      return lastEntry;
    }
  }

  const entry: SubtitleEntry = {
    id: createId("subtitle"),
    text,
    timestamp: nowIso,
    startTime: nowIso,
    endTime: nowIso,
  };
  applySourceMeta(entry, meta);
  state.entries.push(entry);
  return entry;
}

export function flushPendingPreviews(
  state: SessionState,
  now: number,
  settings?: Partial<ExtensionSettings>,
): SessionState {
  const preparedState = cloneState(state);
  const normalizedPreview = normalizeRawText(preparedState.previewText);
  if (!normalizedPreview) {
    return preparedState;
  }

  const result = applyPreview(preparedState, normalizedPreview, now, settings, {
    selector: preparedState.currentSelector || undefined,
    framePath: preparedState.currentFramePath.length
      ? preparedState.currentFramePath
      : undefined,
  });

  return result.state;
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

  const extraction = extractIncrementalTextWithRecentHistory(
    normalizedRaw,
    next.confirmedCompact,
    buildRecentCompactHistory(next.entries),
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
          buildRecentCompactHistory(next.entries),
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
    -PIPELINE_DEFAULTS.recentHistoryCompactLength,
  );

  next.previewText = normalizedPreview;
  next.lastObservedRaw = normalizedPreview;

  const extraction = extractIncrementalTextWithRecentHistory(
    rowText,
    baselineCompact,
    recentBaselineCompact,
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

export function applyKeepalive(state: SessionState, now: number): PipelineResult {
  const next = updateStateMetadata(state, now);
  const lastEntry = next.entries.at(-1);
  if (!lastEntry) {
    return { state: next, changed: false, reason: "no_entries" };
  }

  lastEntry.endTime = toIsoString(now);
  next.lastKeepaliveAt = now;
  return { state: next, changed: true, appendedEntry: lastEntry, reason: "keepalive" };
}

export function applyReset(
  state: SessionState,
  now: number,
  settings?: Partial<ExtensionSettings>,
): PipelineResult {
  void settings;
  const next = updateStateMetadata(state, now);
  next.previewText = "";
  next.pendingPreviews = [];
  next.confirmedCompact = "";
  next.trailingSuffix = "";
  next.lastObservedRaw = "";
  next.lastProcessedRaw = "";
  next.previewDesyncCount = 0;
  next.previewAmbiguousSkipCount = 0;
  next.lastCommittedResetAt = now;
  return { state: next, changed: true, reason: "reset" };
}

export function finalizeSession(
  state: SessionState,
  now: number,
  settings?: Partial<ExtensionSettings>,
): PipelineResult {
  void settings;
  const next = updateStateMetadata(state, now);
  next.status = "stopped";
  next.endedAt = toIsoString(now);
  next.previewText = "";
  next.pendingPreviews = [];
  next.lastCommittedResetAt = null;
  const lastEntry = next.entries.at(-1);
  if (lastEntry) {
    lastEntry.endTime = toIsoString(now);
  }

  return { state: next, changed: true, appendedEntry: lastEntry, reason: "finalized" };
}

export { hasRequiredSubtitleContent, isNoiseOnly, normalizeRawText };
