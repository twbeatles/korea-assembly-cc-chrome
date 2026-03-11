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
  joinStreamText,
  normalizeRawText,
} from "./text-normalizer";
import { toIsoString } from "./timeline";

export interface PipelineSourceMeta {
  selector?: string;
  framePath?: number[];
  sourceNodeKey?: string;
  forceNewEntry?: boolean;
}

export interface PipelineResult {
  state: SessionState;
  changed: boolean;
  appendedEntry?: SubtitleEntry;
  reason?: string;
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

function mergeOrAppendEntry(
  state: SessionState,
  text: string,
  nowIso: string,
  meta?: PipelineSourceMeta,
): SubtitleEntry {
  const selector = meta?.selector;
  const framePath = meta?.framePath ? [...meta.framePath] : undefined;
  const sourceNodeKey = meta?.sourceNodeKey;
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
  };

  if (lastEntry && !state.lastCommittedResetAt && !meta?.forceNewEntry) {
    if (sourceNodeKey && lastEntry.sourceNodeKey === sourceNodeKey) {
      // 같은 nodeKey이면 Update
      if (lastEntry.text !== text) {
        lastEntry.text = text;
        lastEntry.endTime = nowIso;
        applySourceMeta(lastEntry);
      }
      return lastEntry;
    }

    // 다른 nodeKey이거나 nodeKey가 없으면 기존 자막에 이어서 쓰기 (무한 Merge)
    lastEntry.text = joinStreamText(lastEntry.text, text);
    lastEntry.endTime = nowIso;
    applySourceMeta(lastEntry);
    return lastEntry;
  }

  // 첫 자막이거나 사용자가 강제로 Reset(수집 초기화 등)을 누른 경우에만 새로 생성
  const entry: SubtitleEntry = {
    id: createId("subtitle"),
    text,
    timestamp: nowIso,
    startTime: nowIso,
    endTime: nowIso,
    sourceSelector: selector,
    sourceFramePath: framePath,
    sourceNodeKey,
  };
  state.entries.push(entry);
  return entry;
}

// ----------------------------------------------------------------------
// Simplified Pipeline APIs
// ----------------------------------------------------------------------

export function flushPendingPreviews(
  state: SessionState,
  now: number,
  settings?: Partial<ExtensionSettings>,
): SessionState {
  // Previews are no longer queued. Just return state.
  return state;
}

export function applyPreview(
  state: SessionState,
  raw: string,
  now: number,
  settings?: Partial<ExtensionSettings>,
  meta?: PipelineSourceMeta,
): PipelineResult {
  // Preview logic is now just synonymous to appending structured text directly.
  return applyStructuredEntry(state, raw, raw, now, settings, meta);
}

export function applyStructuredEntry(
  state: SessionState,
  text: string,
  previewText: string,
  now: number,
  settings?: Partial<ExtensionSettings>,
  meta?: PipelineSourceMeta,
): PipelineResult {
  const next = updateStateMetadata(state, now, meta);
  const normalizedText = normalizeRawText(text);

  if (!normalizedText || !hasRequiredSubtitleContent(normalizedText)) {
    return {
      state: next,
      changed: next.updatedAt !== state.updatedAt,
      reason: "structured_empty",
    };
  }

  if (
    settings?.noiseFilterEnabled !== false &&
    (!isMeaningfulSubtitleText(normalizedText) || isNoiseOnly(normalizedText))
  ) {
    return {
      state: next,
      changed: next.updatedAt !== state.updatedAt,
      reason: "structured_filtered",
    };
  }

  const lastEntry = next.entries.at(-1);
  if (lastEntry && lastEntry.text === normalizedText && (!meta?.sourceNodeKey || lastEntry.sourceNodeKey === meta.sourceNodeKey)) {
    return {
      state: next,
      changed: false,
      reason: "structured_duplicate",
    };
  }

  const appendedEntry = mergeOrAppendEntry(next, normalizedText, toIsoString(now), meta);
  next.lastObservedRaw = normalizedText;
  next.previewText = normalizedText;
  next.lastProcessedRaw = normalizedText;
  next.lastCommittedResetAt = null;

  return {
    state: next,
    changed: true,
    appendedEntry,
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
  let next = updateStateMetadata(state, now);
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
  let next = updateStateMetadata(state, now);
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
