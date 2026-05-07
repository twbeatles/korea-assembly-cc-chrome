import {
  cloneState,
  createEmptySessionState,
  toSessionRecord,
  type PersistedSessionStatus,
  type SessionRecord,
  type SessionState,
} from "../core/subtitle-models";
import type { ExtensionSettings } from "../storage/types";

// `buildPreparedSessionState` / `buildPreparedSessionRecord` exist as a
// dedicated seam between the live capture state and the persistence layer.
// Today they only clone the state, but the seam is intentionally preserved
// so future preparation logic (e.g., trimming preview-only artifacts before
// persistence) can be added without touching every caller. The `settings` and
// `now` parameters are kept on the signature for the same reason.
export function buildPreparedSessionState(
  state: SessionState,
  settings: ExtensionSettings,
  now: number = Date.now(),
): SessionState {
  void settings;
  void now;
  return cloneState(state);
}

export function buildPreparedSessionRecord(
  state: SessionState,
  settings: ExtensionSettings,
  persistedStatus: PersistedSessionStatus,
  now: number = Date.now(),
): SessionRecord {
  return toSessionRecord(buildPreparedSessionState(state, settings, now), persistedStatus);
}

export function createResetSessionState(sourceUrl: string, title: string, committeeName: string): SessionState {
  return createEmptySessionState(sourceUrl, title, committeeName);
}
