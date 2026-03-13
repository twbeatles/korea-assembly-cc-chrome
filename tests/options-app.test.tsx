import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const chromeApiMocks = vi.hoisted(() => ({
  connectToTab: vi.fn(),
  getTab: vi.fn(),
  queryTabs: vi.fn(),
  sendRuntimeMessage: vi.fn(),
}));

const persistRecoveryMocks = vi.hoisted(() => ({
  createEmptyPersistReplayDiagnostics: vi.fn(() => ({
    lastReplayAt: null,
    lastReplayQueuedCount: 0,
    lastReplayReplayedCount: 0,
    lastReplaySkippedCount: 0,
    lastReplayFailedCount: 0,
    lastCleanupAt: null,
    lastCleanupDetectedCount: 0,
    lastCleanupClosedCount: 0,
    lastCleanupFailedCount: 0,
    lastError: null,
  })),
  readPersistReplayDiagnostics: vi.fn(),
}));

const settingsStoreMocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  resetSettings: vi.fn(),
  saveSettings: vi.fn(),
}));

vi.mock("../src/shared/chrome-api", () => chromeApiMocks);
vi.mock("../src/storage/persist-recovery", () => persistRecoveryMocks);
vi.mock("../src/storage/settings-store", () => settingsStoreMocks);

import App from "../src/options/App";

const defaultSettings = {
  autoScroll: true,
  keepaliveIntervalMs: 1000,
  pollingFallbackIntervalMs: 200,
  maxBufferLength: 50000,
  noiseFilterEnabled: true,
  recentDuplicateMinLength: 8,
  filenamePattern: "{date}_{committee}_{time}",
  runningAutoSaveEnabled: true,
  runningAutoSaveDebounceMs: 800,
  recentCopyLineCount: 5,
  debugLogging: false,
  autoStartEnabled: true,
  filterUnconfirmedEnabled: true,
};

describe("options app", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/options.html");
    settingsStoreMocks.getSettings.mockResolvedValue(defaultSettings);
    settingsStoreMocks.resetSettings.mockResolvedValue(defaultSettings);
    settingsStoreMocks.saveSettings.mockResolvedValue(defaultSettings);
    chromeApiMocks.queryTabs.mockResolvedValue([]);
    persistRecoveryMocks.readPersistReplayDiagnostics.mockResolvedValue({
      lastReplayAt: "2026-03-13T09:30:00.000Z",
      lastReplayQueuedCount: 2,
      lastReplayReplayedCount: 1,
      lastReplaySkippedCount: 1,
      lastReplayFailedCount: 0,
      lastCleanupAt: "2026-03-13T09:30:00.000Z",
      lastCleanupDetectedCount: 3,
      lastCleanupClosedCount: 2,
      lastCleanupFailedCount: 1,
      lastError: "Replay failed once",
    });
  });

  it("blocks save and shows a field error for an invalid numeric draft", async () => {
    render(<App />);
    await screen.findByText("필요한 값을 바꾼 뒤 저장하세요.");

    const debounceInput = screen
      .getByText("자동 저장 간격(ms)")
      .closest("label")
      ?.querySelector("input[type='number']") as HTMLInputElement | null;
    expect(debounceInput).not.toBeNull();

    fireEvent.change(debounceInput!, { target: { value: "100" } });

    await waitFor(() => {
      expect(screen.getByText("250 이상이어야 합니다.")).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: "저장" }).hasAttribute("disabled")).toBe(true);
  });

  it("resets numeric drafts and clears field errors after reset", async () => {
    render(<App />);
    await screen.findByText("필요한 값을 바꾼 뒤 저장하세요.");

    const debounceInput = screen
      .getByText("자동 저장 간격(ms)")
      .closest("label")
      ?.querySelector("input[type='number']") as HTMLInputElement | null;
    expect(debounceInput).not.toBeNull();

    fireEvent.change(debounceInput!, { target: { value: "" } });
    await screen.findByText("값을 입력하세요.");

    fireEvent.click(screen.getByRole("button", { name: "기본값으로 되돌리기" }));

    await waitFor(() => {
      expect(screen.queryByText("값을 입력하세요.")).toBeNull();
    });
    expect(debounceInput?.value).toBe("800");
  });

  it("renders persist replay diagnostics in diagnostics view", async () => {
    window.history.replaceState({}, "", "/options.html?view=diagnostics");

    render(<App />);

    await screen.findByText("저장 복구 상태");
    expect(screen.getByText("Replay failed once")).toBeTruthy();
    expect(screen.getByText("1 / 0")).toBeTruthy();
    expect(screen.getByText("2 / 1")).toBeTruthy();
  });
});
