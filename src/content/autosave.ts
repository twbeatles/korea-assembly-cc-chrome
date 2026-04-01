import type { SessionState } from "../core/subtitle-models";
import type { SessionRecord } from "../core/subtitle-models";
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

export interface PreparedEligibilitySnapshot {
  status: SessionState["status"];
  preparedEntryCount: number;
  hasVisibleRuntimeContent: boolean;
  canPersistPreparedContent: boolean;
}

export function createPreparedEligibilitySnapshot(
  input: {
    status: SessionState["status"];
    preparedEntryCount: number;
    previewText: string;
    livePreviewText?: string;
    liveRowCount?: number;
  },
): PreparedEligibilitySnapshot {
  const hasVisibleRuntimeContent =
    input.preparedEntryCount > 0 ||
    Boolean(input.previewText.trim()) ||
    Boolean(input.livePreviewText?.trim()) ||
    (input.liveRowCount ?? 0) > 0;

  return {
    status: input.status,
    preparedEntryCount: input.preparedEntryCount,
    hasVisibleRuntimeContent,
    canPersistPreparedContent: input.preparedEntryCount > 0,
  };
}

export function hasPersistableRunningContent(
  state: Pick<SessionState, "status" | "entries" | "previewText" | "pendingPreviews">,
): boolean {
  return (
    state.status === "running" &&
    (state.entries.length > 0 ||
      state.pendingPreviews.length > 0 ||
      Boolean(state.previewText.trim()))
  );
}

export function shouldWarnBeforeUnload(
  isTopFrame: boolean,
  eligibility: Pick<PreparedEligibilitySnapshot, "status" | "canPersistPreparedContent">,
): boolean {
  return isTopFrame && eligibility.status === "running" && eligibility.canPersistPreparedContent;
}

export function applyPersistSuccess(state: SessionState, persistedAt: string): SessionState {
  const next = cloneState(state);
  next.lastPersistedAt = persistedAt;
  return next;
}

export function clearScheduledRunningPersist(
  currentTimer: number | null,
  clearTimer: (timerId: number) => void,
): number | null {
  if (currentTimer !== null) {
    clearTimer(currentTimer);
  }
  return null;
}

export interface RunningPersistSnapshot {
  status: SessionState["status"];
  record: SessionRecord;
}

export interface RunningPersistSchedulerOptions {
  currentTimer: number | null;
  delayMs: number;
  shouldSchedule: boolean;
  clearTimer: (timerId: number) => void;
  setTimer: (callback: () => void, delayMs: number) => number;
  getSnapshot: () => RunningPersistSnapshot;
  persistRecord: (record: SessionRecord) => Promise<SessionRecord>;
  onPersisted: (saved: SessionRecord) => void;
  onError: (error: unknown) => void;
}

export function scheduleRunningPersistTimer(
  options: RunningPersistSchedulerOptions,
): number | null {
  if (!options.shouldSchedule) {
    return clearScheduledRunningPersist(options.currentTimer, options.clearTimer);
  }

  if (options.currentTimer !== null) {
    options.clearTimer(options.currentTimer);
  }

  return options.setTimer(() => {
    const snapshot = options.getSnapshot();
    if (snapshot.status !== "running") {
      return;
    }

    void options.persistRecord(snapshot.record)
      .then(options.onPersisted)
      .catch(options.onError);
  }, options.delayMs);
}
