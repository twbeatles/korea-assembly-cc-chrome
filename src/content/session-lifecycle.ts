import { createContinuedSessionState as createContinuedSessionStateBase } from "../core/session-lineage";
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
  const preparedState = cloneState(state);
  preparedState.pendingPreviews = [];
  return preparedState;
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

export function createContinuedSessionState(
  currentState: SessionState,
  sourceUrl: string,
  title: string,
  committeeName: string,
  nowIso = new Date().toISOString(),
): SessionState {
  return createContinuedSessionStateBase(
    currentState,
    sourceUrl,
    title,
    committeeName,
    nowIso,
  );
}
