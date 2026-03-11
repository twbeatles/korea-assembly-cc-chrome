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
  type SpeakerChannel,
  type SessionState,
  type SubtitleEntry,
} from "./subtitle-models";
import {
  compactHistoryTail,
  extractByTrailingSuffix,
  extractIncrement,
  extractStreamDelta,
  findSuffixPositions,
  sliceIncrementalPart,
} from "./suffix-diff";
import {
  compactSubtitleText,
  joinStreamText,
  normalizeRawText,
} from "./text-normalizer";
import { differenceSeconds, toIsoString } from "./timeline";

export interface PipelineSourceMeta {
  selector?: string;
  framePath?: number[];
  sourceNodeKey?: string;
  speakerColor?: string;
  speakerChannel?: SpeakerChannel;
  speakerChanged?: boolean;
  forceNewEntry?: boolean;
}

export interface PipelineResult {
  state: SessionState;
  changed: boolean;
  appendedEntry?: SubtitleEntry;
  reason?: string;
}

interface PreparedPreviewResult {
  state: SessionState;
  prepared: string | null;
  reason: string;
}

function trimConfirmedCompact(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(-maxLength);
}

function recentTexts(
  state: SessionState,
  maxEntries = PIPELINE_DEFAULTS.recentHistoryEntries,
): string[] {
  return state.entries.slice(-maxEntries).map((entry) => entry.text);
}

function recentCompactTail(state: SessionState): string {
  return compactHistoryTail(
    recentTexts(state),
    PIPELINE_DEFAULTS.recentHistoryEntries,
    PIPELINE_DEFAULTS.recentHistoryCompactLength,
  );
}

function softResync(state: SessionState): SessionState {
  const next = cloneState(state);
  const recent = next.entries
    .slice(-PIPELINE_DEFAULTS.recentResyncEntries)
    .map((entry) => entry.text)
    .join(" ");
  const compact = compactSubtitleText(recent);

  next.confirmedCompact = trimConfirmedCompact(
    compact,
    PIPELINE_DEFAULTS.confirmedCompactMaxLength,
  );
  next.trailingSuffix = next.confirmedCompact.slice(-PIPELINE_DEFAULTS.suffixLength);

  return next;
}

function mergeOrAppendEntry(
  state: SessionState,
  text: string,
  nowIso: string,
  meta?: PipelineSourceMeta,
): SubtitleEntry {
  const selector = meta?.selector;
  const framePath = meta?.framePath ? [...meta.framePath] : undefined;
  const sourceNodeKey = meta?.sourceNodeKey;
  const speakerColor = meta?.speakerColor;
  const speakerChannel = meta?.speakerChannel;
  const speakerChanged = Boolean(meta?.speakerChanged);
  const lastEntry = state.entries.at(-1);

  const applySourceMeta = (entry: SubtitleEntry): void => {
    if (selector) {
      entry.sourceSelector = selector;
    }
    if (framePath) {
      entry.sourceFramePath = framePath;
    }
    if (sourceNodeKey) {
      entry.sourceNodeKey = sourceNodeKey;
    }
    if (speakerColor) {
      entry.speakerColor = speakerColor;
    }
    if (speakerChannel) {
      entry.speakerChannel = speakerChannel;
    }
    if (speakerChanged) {
      entry.speakerChanged = true;
    }
  };

  if (lastEntry) {
    if (sourceNodeKey && lastEntry.sourceNodeKey === sourceNodeKey) {
      lastEntry.text = text;
      lastEntry.endTime = nowIso;
      applySourceMeta(lastEntry);
      return lastEntry;
    }

    const speakerBoundary =
      Boolean(meta?.forceNewEntry) ||
      Boolean(state.lastCommittedResetAt) ||
      speakerChanged ||
      Boolean(
        sourceNodeKey &&
          lastEntry.sourceNodeKey &&
          lastEntry.sourceNodeKey !== sourceNodeKey,
      ) ||
      Boolean(
        speakerChannel &&
          lastEntry.speakerChannel &&
          speakerChannel !== "unknown" &&
          lastEntry.speakerChannel !== "unknown" &&
          lastEntry.speakerChannel !== speakerChannel,
      ) ||
      Boolean(
        speakerColor &&
          lastEntry.speakerColor &&
          speakerColor !== lastEntry.speakerColor,
      );

    const gapSeconds = differenceSeconds(lastEntry.endTime || lastEntry.timestamp, nowIso);
    const canMerge =
      !speakerBoundary &&
      gapSeconds <= PIPELINE_DEFAULTS.mergeGapSeconds &&
      lastEntry.text.length + text.length < PIPELINE_DEFAULTS.mergeMaxChars;

    if (canMerge) {
      lastEntry.text = joinStreamText(lastEntry.text, text);
      lastEntry.endTime = nowIso;
      applySourceMeta(lastEntry);
      return lastEntry;
    }
  }

  const entry: SubtitleEntry = {
    id: createId("subtitle"),
    text,
    timestamp: nowIso,
    startTime: nowIso,
    endTime: nowIso,
    sourceSelector: selector,
    sourceFramePath: framePath,
    sourceNodeKey,
    speakerColor,
    speakerChannel,
    speakerChanged: speakerChanged || undefined,
  };
  state.entries.push(entry);
  return entry;
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

function acceptPreparedPreview(
  state: SessionState,
  observedRaw: string,
  rawCompact: string,
  prepared: string,
): PreparedPreviewResult {
  const next = cloneState(state);
  next.previewDesyncCount = 0;
  next.previewAmbiguousSkipCount = 0;
  next.lastObservedRaw = observedRaw;
  next.previewText = observedRaw;
  next.pendingPreviews = [...next.pendingPreviews, observedRaw].slice(-10);
  return {
    state: next,
    prepared,
    reason: rawCompact ? "prepared" : "empty_compact",
  };
}

function preparePreviewCandidate(
  state: SessionState,
  normalized: string,
  force = false,
): PreparedPreviewResult {
  const rawCompact = compactSubtitleText(normalized);
  if (!rawCompact) {
    const next = cloneState(state);
    next.lastObservedRaw = normalized;
    next.previewText = normalized;
    return {
      state: next,
      prepared: null,
      reason: "empty_compact",
    };
  }

  if (!state.trailingSuffix) {
    return acceptPreparedPreview(state, normalized, rawCompact, normalized);
  }

  const positions = findSuffixPositions(rawCompact, state.trailingSuffix);
  if (positions.first < 0) {
    const delta = extractStreamDelta(normalized, state.lastObservedRaw);
    if (delta && delta.length < normalized.length) {
      return acceptPreparedPreview(state, normalized, rawCompact, delta);
    }
    if (delta === "") {
      const next = cloneState(state);
      next.lastObservedRaw = normalized;
      next.previewText = normalized;
      next.pendingPreviews = [];
      return {
        state: next,
        prepared: null,
        reason: "duplicate_stream_delta",
      };
    }

    const historyAnchor = compactHistoryTail(
      recentTexts(state, 8),
      8,
      PIPELINE_DEFAULTS.recentHistoryCompactLength,
    );
    const incremental = sliceIncrementalPart(
      normalized,
      historyAnchor,
      rawCompact,
      20,
      8,
    );
    if (incremental && incremental.length < normalized.length) {
      return acceptPreparedPreview(state, normalized, rawCompact, incremental);
    }
    if (incremental === "") {
      const next = cloneState(state);
      next.lastObservedRaw = normalized;
      next.previewText = normalized;
      next.pendingPreviews = [];
      return {
        state: next,
        prepared: null,
        reason: "history_anchor_empty",
      };
    }

    const next = cloneState(state);
    next.lastObservedRaw = normalized;
    next.previewText = normalized;
    next.previewDesyncCount += 1;
    if (force) {
      return acceptPreparedPreview(next, normalized, rawCompact, normalized);
    }
    if (next.previewDesyncCount >= PIPELINE_DEFAULTS.previewResyncThreshold) {
      return acceptPreparedPreview(softResync(next), normalized, rawCompact, normalized);
    }
    return {
      state: next,
      prepared: null,
      reason: "desync",
    };
  }

  if (positions.first !== positions.last) {
    const predictedAppend = rawCompact.length - (positions.first + state.trailingSuffix.length);
    const largeAppendThreshold = Math.max(200, Math.floor(rawCompact.length / 3));
    if (predictedAppend > largeAppendThreshold) {
      const incremental = sliceIncrementalPart(
        normalized,
        state.trailingSuffix,
        rawCompact,
        20,
        8,
      );
      if (incremental && incremental.length < normalized.length) {
        return acceptPreparedPreview(state, normalized, rawCompact, incremental);
      }
      if (incremental === "") {
        const next = cloneState(state);
        next.lastObservedRaw = normalized;
        next.previewText = normalized;
        next.pendingPreviews = [];
        return {
          state: next,
          prepared: null,
          reason: "ambiguous_empty",
        };
      }

      const next = cloneState(state);
      next.lastObservedRaw = normalized;
      next.previewText = normalized;
      next.previewAmbiguousSkipCount += 1;
      if (force) {
        return acceptPreparedPreview(next, normalized, rawCompact, normalized);
      }
      if (
        next.previewAmbiguousSkipCount >=
        PIPELINE_DEFAULTS.previewAmbiguousResyncThreshold
      ) {
        return acceptPreparedPreview(softResync(next), normalized, rawCompact, normalized);
      }
      return {
        state: next,
        prepared: null,
        reason: "ambiguous",
      };
    }
  }

  return acceptPreparedPreview(state, normalized, rawCompact, normalized);
}

function normalizeIncrementalText(
  state: SessionState,
  prepared: string,
  settings?: Partial<ExtensionSettings>,
): string {
  const coreRaw = prepared.trim();
  if (!coreRaw || coreRaw === state.lastProcessedRaw) {
    return "";
  }

  const coreCompact = compactSubtitleText(coreRaw);
  let newPart = extractByTrailingSuffix(coreRaw, coreCompact, state.trailingSuffix).trim();
  if (!newPart) {
    return "";
  }

  const lastText = state.entries.at(-1)?.text ?? "";
  if (lastText) {
    const refined = extractIncrement(newPart, lastText, recentTexts(state));
    if (!refined) {
      return "";
    }
    newPart = refined.trim();
  }

  if (!newPart || !hasRequiredSubtitleContent(newPart)) {
    return "";
  }

  if (settings?.noiseFilterEnabled !== false && (!isMeaningfulSubtitleText(newPart) || isNoiseOnly(newPart))) {
    return "";
  }

  const recentTail = recentCompactTail(state);
  const newCompact = compactSubtitleText(newPart);
  const duplicateThreshold = Math.max(
    1,
    settings?.recentDuplicateMinLength ?? PIPELINE_DEFAULTS.recentDuplicateMinLength,
  );
  if (recentTail && newCompact.length >= duplicateThreshold && recentTail.includes(newCompact)) {
    return "";
  }

  return newPart;
}

function applyIncrementalAppend(
  state: SessionState,
  prepared: string,
  newPart: string,
  now: number,
  settings?: Partial<ExtensionSettings>,
  meta?: PipelineSourceMeta,
): PipelineResult {
  const next = cloneState(state);
  const newCompact = compactSubtitleText(newPart);
  next.confirmedCompact = trimConfirmedCompact(
    `${next.confirmedCompact}${newCompact}`,
    settings?.maxBufferLength ?? PIPELINE_DEFAULTS.confirmedCompactMaxLength,
  );
  next.trailingSuffix = next.confirmedCompact.slice(-PIPELINE_DEFAULTS.suffixLength);
  next.lastProcessedRaw = prepared.trim() || state.lastProcessedRaw;
  next.pendingPreviews = [];
  next.lastCommittedResetAt = null;
  const appendedEntry = mergeOrAppendEntry(next, newPart, toIsoString(now), meta);

  return {
    state: next,
    changed: true,
    appendedEntry,
    reason: "appended",
  };
}

export function flushPendingPreviews(
  state: SessionState,
  now: number,
  settings?: Partial<ExtensionSettings>,
): SessionState {
  let next = cloneState(state);
  if (!next.pendingPreviews.length) {
    return next;
  }

  const pendingItems = [...next.pendingPreviews];
  next.pendingPreviews = [];

  for (const pending of pendingItems) {
    next = applyPreviewInternal(next, pending, now, settings, undefined, true).state;
  }

  return next;
}

function applyPreviewInternal(
  state: SessionState,
  raw: string,
  now: number,
  settings?: Partial<ExtensionSettings>,
  meta?: PipelineSourceMeta,
  force = false,
): PipelineResult {
  const nextWithMeta = updateStateMetadata(state, now, meta);
  const normalized = normalizeRawText(raw);
  if (!normalized) {
    return {
      state: nextWithMeta,
      changed: nextWithMeta.updatedAt !== state.updatedAt,
      reason: "empty",
    };
  }

  const preparedResult = preparePreviewCandidate(nextWithMeta, normalized, force);
  if (!preparedResult.prepared) {
    return {
      state: preparedResult.state,
      changed: true,
      reason: preparedResult.reason,
    };
  }

  const newPart = normalizeIncrementalText(
    preparedResult.state,
    preparedResult.prepared,
    settings,
  );
  if (!newPart) {
    const next = cloneState(preparedResult.state);
    next.lastProcessedRaw = preparedResult.prepared.trim() || next.lastProcessedRaw;
    next.pendingPreviews = [];
    return {
      state: next,
      changed: true,
      reason: "no_increment",
    };
  }

  return applyIncrementalAppend(
    preparedResult.state,
    preparedResult.prepared,
    newPart,
    now,
    settings,
    meta,
  );
}

export function applyPreview(
  state: SessionState,
  raw: string,
  now: number,
  settings?: Partial<ExtensionSettings>,
  meta?: PipelineSourceMeta,
): PipelineResult {
  return applyPreviewInternal(state, raw, now, settings, meta, false);
}

export function applyStructuredEntry(
  state: SessionState,
  text: string,
  previewText: string,
  now: number,
  settings?: Partial<ExtensionSettings>,
  meta?: PipelineSourceMeta,
): PipelineResult {
  const nextWithMeta = updateStateMetadata(state, now, meta);
  const next = cloneState(nextWithMeta);
  const normalizedPreview = normalizeRawText(previewText);
  const normalizedText = normalizeRawText(text);

  if (normalizedPreview) {
    next.previewText = normalizedPreview;
    next.lastObservedRaw = normalizedPreview;
    next.lastProcessedRaw = normalizedPreview.trim() || next.lastProcessedRaw;
  }

  if (!normalizedText || !hasRequiredSubtitleContent(normalizedText)) {
    return {
      state: next,
      changed:
        next.previewText !== state.previewText || next.updatedAt !== state.updatedAt,
      reason: "structured_empty",
    };
  }

  if (
    settings?.noiseFilterEnabled !== false &&
    (!isMeaningfulSubtitleText(normalizedText) || isNoiseOnly(normalizedText))
  ) {
    return {
      state: next,
      changed:
        next.previewText !== state.previewText || next.updatedAt !== state.updatedAt,
      reason: "structured_filtered",
    };
  }

  next.pendingPreviews = [];
  const appendedEntry = mergeOrAppendEntry(next, normalizedText, toIsoString(now), meta);
  const resynced = softResync(next);
  resynced.previewText = next.previewText;
  resynced.lastObservedRaw = next.lastObservedRaw;
  resynced.lastProcessedRaw = next.lastProcessedRaw;
  resynced.pendingPreviews = [];
  resynced.lastCommittedResetAt = null;

  return {
    state: resynced,
    changed: true,
    appendedEntry: resynced.entries.find((entry) => entry.id === appendedEntry.id),
    reason: "structured",
  };
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
  let next = flushPendingPreviews(state, now, settings);
  next = updateStateMetadata(next, now);
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
  let next = flushPendingPreviews(state, now, settings);
  next = updateStateMetadata(next, now);
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

export { extractIncrement, hasRequiredSubtitleContent, isNoiseOnly, normalizeRawText };
