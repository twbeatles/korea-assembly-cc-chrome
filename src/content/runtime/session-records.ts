import { finalizeSession } from "../../core/subtitle-pipeline";
import {
  cloneEntry,
  cloneState,
  toSessionRecord,
  type PersistedSessionStatus,
  type SessionRecord,
  type SessionState,
  type SubtitleEntry,
} from "../../core/subtitle-models";
import type { ExtensionSettings } from "../../storage/types";
import {
  buildPreparedSessionRecord as buildPreparedSessionRecordBase,
  buildPreparedSessionState as buildPreparedSessionStateBase,
} from "../session-lifecycle";

export function buildPreparedSessionState(
  state: SessionState,
  settings: ExtensionSettings,
  now = Date.now(),
): SessionState {
  return buildPreparedSessionStateBase(state, settings, now);
}

export function buildVisibleOutputEntries(entries: SubtitleEntry[]): SubtitleEntry[] {
  return entries.map((entry) => cloneEntry(entry));
}

export function buildVisibleSessionState(
  state: SessionState,
  livePreviewText: string,
): SessionState {
  const nextState = cloneState(state);
  nextState.entries = buildVisibleOutputEntries(state.entries);
  nextState.previewText = livePreviewText;
  nextState.lastObservedRaw = livePreviewText;
  return nextState;
}

export function buildVisibleSessionRecord(
  state: SessionState,
  settings: ExtensionSettings,
  persistedStatus: PersistedSessionStatus,
  livePreviewText: string,
  now = Date.now(),
): SessionRecord {
  if (persistedStatus !== "stopped") {
    return toSessionRecord(buildVisibleSessionState(state, livePreviewText), persistedStatus);
  }

  return toSessionRecord(
    finalizeSession(buildVisibleSessionState(state, livePreviewText), now, settings).state,
    persistedStatus,
  );
}

export function buildPreparedSessionRecord(
  state: SessionState,
  settings: ExtensionSettings,
  persistedStatus: PersistedSessionStatus,
  now = Date.now(),
): SessionRecord {
  if (persistedStatus !== "stopped") {
    return buildPreparedSessionRecordBase(state, settings, persistedStatus, now);
  }

  return toSessionRecord(
    finalizeSession(buildPreparedSessionState(state, settings, now), now, settings).state,
    persistedStatus,
  );
}
