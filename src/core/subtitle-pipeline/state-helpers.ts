import type { SessionState, SubtitleEntry } from "../subtitle-models";
import { toIsoString } from "../timeline";
import type { PipelineSourceMeta } from "./types";

export function cloneStateStructure(state: SessionState): SessionState {
  return {
    ...state,
    entries: [...state.entries],
    pendingPreviews: [...state.pendingPreviews],
    currentFramePath: [...state.currentFramePath],
  };
}

export function cloneEntryAtIndex(state: SessionState, index: number): SubtitleEntry | undefined {
  const current = state.entries[index];
  if (!current) {
    return undefined;
  }

  const cloned: SubtitleEntry = {
    ...current,
    sourceFramePath: current.sourceFramePath ? [...current.sourceFramePath] : undefined,
  };
  state.entries[index] = cloned;
  return cloned;
}

export function updateStateMetadata(
  state: SessionState,
  now: number,
  meta?: PipelineSourceMeta,
): SessionState {
  const next = cloneStateStructure(state);
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

export function applySourceMeta(entry: SubtitleEntry, meta?: PipelineSourceMeta): void {
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
  if (meta.sourceCaptureMode) {
    entry.sourceCaptureMode = meta.sourceCaptureMode;
  }
  if (meta.speakerColor) {
    entry.speakerColor = meta.speakerColor;
  }
  if (meta.speakerChannel) {
    entry.speakerChannel = meta.speakerChannel;
  }
}
