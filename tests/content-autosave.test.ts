import {
  applyPersistSuccess,
  clearScheduledRunningPersist,
  hasPersistableRunningContent,
  resolveRunningPersistDebounceMs,
  scheduleRunningPersistTimer,
  shouldPersistFinalSession,
  shouldScheduleRunningPersist,
  shouldWarnBeforeUnload,
} from "../src/content/autosave";
import { createEmptySessionState, toSessionRecord } from "../src/core/subtitle-models";
import { DEFAULT_EXTENSION_SETTINGS } from "../src/shared/constants";

describe("content autosave policy", () => {
  it("schedules running autosave when enabled", () => {
    const state = createEmptySessionState("https://assembly.webcast.go.kr/main/player.asp");
    state.status = "running";
    state.entries.push({
      id: "entry_1",
      text: "테스트 자막",
      timestamp: "2026-03-10T09:00:00.000Z",
      startTime: "2026-03-10T09:00:00.000Z",
      endTime: "2026-03-10T09:00:00.000Z",
    });

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

  it("does not schedule running autosave without committed entries", () => {
    const state = createEmptySessionState("https://assembly.webcast.go.kr/main/player.asp");
    state.status = "running";
    state.previewText = "실시간 미리보기만 있음";

    expect(
      shouldScheduleRunningPersist(true, state, {
        runningAutoSaveEnabled: true,
      }),
    ).toBe(false);
  });

  it("still allows final save even when autosave is disabled", () => {
    expect(shouldPersistFinalSession(true, 3)).toBe(true);
    expect(shouldPersistFinalSession(false, 3)).toBe(false);
    expect(shouldPersistFinalSession(true, 0)).toBe(false);
  });

  it("does not treat preview-only content as persistable before navigation", () => {
    const state = createEmptySessionState("https://assembly.webcast.go.kr/main/player.asp");
    state.status = "running";
    state.previewText = "새 자막";

    expect(hasPersistableRunningContent(state)).toBe(false);
  });

  it("warns before unload only when a running session has content", () => {
    const state = createEmptySessionState("https://assembly.webcast.go.kr/main/player.asp");
    state.status = "running";
    state.entries.push({
      id: "entry_1",
      text: "테스트 자막",
      timestamp: "2026-03-10T09:00:00.000Z",
      startTime: "2026-03-10T09:00:00.000Z",
      endTime: "2026-03-10T09:00:00.000Z",
    });

    expect(shouldWarnBeforeUnload(true, state)).toBe(true);

    state.status = "stopped";
    expect(shouldWarnBeforeUnload(true, state)).toBe(false);
    expect(shouldWarnBeforeUnload(false, state)).toBe(false);
  });

  it("does not warn before unload for preview-only content", () => {
    const state = createEmptySessionState("https://assembly.webcast.go.kr/main/player.asp");
    state.status = "running";
    state.previewText = "페이지에만 보이는 자막";

    expect(hasPersistableRunningContent(state)).toBe(false);
    expect(shouldWarnBeforeUnload(true, state)).toBe(false);
  });

  it("still rejects empty final saves even when previewText is present", () => {
    const state = createEmptySessionState("https://assembly.webcast.go.kr/main/player.asp");
    state.status = "running";
    state.previewText = "123456"; // numeric-only → filtered by noise filter
    const record = toSessionRecord(state, "saved");

    expect(record.entries).toHaveLength(0);
    expect(shouldPersistFinalSession(true, record.entries.length)).toBe(false);
    expect(hasPersistableRunningContent(state)).toBe(false);
    expect(state.previewText.trim()).not.toBe("");
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

  it("clears the pending timer handle", () => {
    const clearTimer = vi.fn();

    expect(clearScheduledRunningPersist(42, clearTimer)).toBeNull();
    expect(clearTimer).toHaveBeenCalledWith(42);
  });

  it("skips persisting when the session stops before debounce fires", async () => {
    vi.useFakeTimers();
    const state = createEmptySessionState("https://assembly.webcast.go.kr/main/player.asp");
    state.status = "running";
    state.startedAt = "2026-03-10T09:00:00.000Z";
    state.createdAt = "2026-03-10T09:00:00.000Z";
    state.updatedAt = "2026-03-10T09:00:00.000Z";

    const persistRecord = vi.fn().mockResolvedValue(toSessionRecord(state, "running"));
    const onPersisted = vi.fn();
    const onError = vi.fn();

    const timer = scheduleRunningPersistTimer({
      currentTimer: null,
      delayMs: 800,
      shouldSchedule: true,
      clearTimer: (timerId) => clearTimeout(timerId),
      setTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
      getSnapshot: () => ({
        status: state.status,
        record: toSessionRecord(state, "running"),
      }),
      persistRecord,
      onPersisted,
      onError,
    });

    expect(timer).not.toBeNull();

    state.status = "stopped";
    await vi.advanceTimersByTimeAsync(800);

    expect(persistRecord).not.toHaveBeenCalled();
    expect(onPersisted).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("skips persisting when the running snapshot has no committed entries", async () => {
    vi.useFakeTimers();
    const state = createEmptySessionState("https://assembly.webcast.go.kr/main/player.asp");
    state.status = "running";
    state.startedAt = "2026-03-10T09:00:00.000Z";
    state.createdAt = "2026-03-10T09:00:00.000Z";
    state.updatedAt = "2026-03-10T09:00:00.000Z";
    state.previewText = "실시간 텍스트만 있음";

    const persistRecord = vi.fn().mockResolvedValue(toSessionRecord(state, "running"));
    const onPersisted = vi.fn();
    const onError = vi.fn();

    const timer = scheduleRunningPersistTimer({
      currentTimer: null,
      delayMs: 800,
      shouldSchedule: true,
      clearTimer: (timerId) => clearTimeout(timerId),
      setTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
      getSnapshot: () => ({
        status: state.status,
        record: toSessionRecord(state, "running"),
      }),
      persistRecord,
      onPersisted,
      onError,
    });

    expect(timer).not.toBeNull();

    await vi.advanceTimersByTimeAsync(800);

    expect(persistRecord).not.toHaveBeenCalled();
    expect(onPersisted).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
