import type { SessionState } from "../core/subtitle-models";
import { cloneState } from "../core/subtitle-models";
import type { ExtensionSettings } from "../storage/types";

export function shouldScheduleRunningPersist(
  isTopFrame: boolean,
  state: Pick<SessionState, "status">,
  settings: Pick<ExtensionSettings, "runningAutoSaveEnabled">,
): boolean {
  return isTopFrame && state.status === "running" && settings.runningAutoSaveEnabled;
}

export function resolveRunningPersistDebounceMs(
  settings: Pick<ExtensionSettings, "runningAutoSaveDebounceMs">,
): number {
  return Math.max(250, settings.runningAutoSaveDebounceMs);
}

export function shouldPersistFinalSession(
  isTopFrame: boolean,
  entryCount: number,
): boolean {
  return isTopFrame && entryCount > 0;
}

export function applyPersistSuccess(state: SessionState, persistedAt: string): SessionState {
  const next = cloneState(state);
  next.lastPersistedAt = persistedAt;
  return next;
}
