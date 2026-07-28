import type { ExtensionSettings } from "../../storage/types";
import type { SessionState } from "../subtitle-models";
import { toIsoString } from "../timeline";
import { cloneEntryAtIndex, updateStateMetadata } from "./state-helpers";
import type { PipelineResult } from "./types";

export function applyKeepalive(state: SessionState, now: number): PipelineResult {
  const next = updateStateMetadata(state, now);
  const lastEntryIndex = next.entries.length - 1;
  const lastEntry = lastEntryIndex >= 0 ? cloneEntryAtIndex(next, lastEntryIndex) : undefined;
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
  next.lastCommittedResetAt = null;
  const lastEntryIndex = next.entries.length - 1;
  const lastEntry = lastEntryIndex >= 0 ? cloneEntryAtIndex(next, lastEntryIndex) : undefined;
  if (lastEntry) {
    lastEntry.endTime = toIsoString(now);
  }

  return { state: next, changed: true, appendedEntry: lastEntry, reason: "finalized" };
}
