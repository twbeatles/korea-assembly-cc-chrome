import {
  applyPersistSuccess,
  resolveRunningPersistDebounceMs,
  shouldPersistFinalSession,
  shouldScheduleRunningPersist,
} from "../src/content/autosave";
import { createEmptySessionState } from "../src/core/subtitle-models";
import { DEFAULT_EXTENSION_SETTINGS } from "../src/shared/constants";

describe("content autosave policy", () => {
  it("schedules running autosave when enabled", () => {
    const state = createEmptySessionState("https://assembly.webcast.go.kr/main/player.asp");
    state.status = "running";

    expect(
      shouldScheduleRunningPersist(true, state, {
        runningAutoSaveEnabled: true,
      }),
    ).toBe(true);
    expect(resolveRunningPersistDebounceMs({ runningAutoSaveDebounceMs: 800 })).toBe(800);
  });

  it("skips running autosave when disabled", () => {
    const state = createEmptySessionState("https://assembly.webcast.go.kr/main/player.asp");
    state.status = "running";

    expect(
      shouldScheduleRunningPersist(true, state, {
        runningAutoSaveEnabled: false,
      }),
    ).toBe(false);
  });

  it("still allows final save even when autosave is disabled", () => {
    expect(shouldPersistFinalSession(true, 3)).toBe(true);
    expect(shouldPersistFinalSession(false, 3)).toBe(false);
    expect(shouldPersistFinalSession(true, 0)).toBe(false);
  });

  it("updates lastPersistedAt after a successful save", () => {
    const state = createEmptySessionState("https://assembly.webcast.go.kr/main/player.asp");
    const persisted = applyPersistSuccess(state, "2026-03-10T09:00:01.000Z");

    expect(persisted.lastPersistedAt).toBe("2026-03-10T09:00:01.000Z");
    expect(state.lastPersistedAt).toBeNull();
  });

  it("uses the minimum debounce fallback", () => {
    expect(
      resolveRunningPersistDebounceMs({
        runningAutoSaveDebounceMs: DEFAULT_EXTENSION_SETTINGS.runningAutoSaveDebounceMs,
      }),
    ).toBe(DEFAULT_EXTENSION_SETTINGS.runningAutoSaveDebounceMs);
    expect(resolveRunningPersistDebounceMs({ runningAutoSaveDebounceMs: 100 })).toBe(250);
  });
});
