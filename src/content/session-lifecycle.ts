import {
  cloneState,
  createEmptySessionState,
  toSessionRecord,
  type PersistedSessionStatus,
  type SessionRecord,
  type SessionState,
} from "../core/subtitle-models";
import type { ExtensionSettings } from "../storage/types";

export function buildPreparedSessionState(
  state: SessionState,
  settings: ExtensionSettings,
  now = Date.now(),
): SessionState {
  void settings;
  void now;
  return cloneState(state);
}

export function buildPreparedSessionRecord(
  state: SessionState,
  settings: ExtensionSettings,
  persistedStatus: PersistedSessionStatus,
  now = Date.now(),
): SessionRecord {
  return toSessionRecord(buildPreparedSessionState(state, settings, now), persistedStatus);
}

export function createResetSessionState(sourceUrl: string, title: string, committeeName: string): SessionState {
  return createEmptySessionState(sourceUrl, title, committeeName);
}
