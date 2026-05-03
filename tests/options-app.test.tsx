import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const chromeApiMocks = vi.hoisted(() => ({
  addTabActivatedListener: vi.fn(),
  addTabRemovedListener: vi.fn(),
  addTabUpdatedListener: vi.fn(),
  connectToTab: vi.fn(),
  getTab: vi.fn(),
  queryTabs: vi.fn(),
  removeTabActivatedListener: vi.fn(),
  removeTabRemovedListener: vi.fn(),
  removeTabUpdatedListener: vi.fn(),
  sendRuntimeMessage: vi.fn(),
}));

const persistRecoveryMocks = vi.hoisted(() => ({
  createEmptyPersistReplayDiagnostics: vi.fn(() => ({
    lastReplayAt: null,
    lastReplayQueuedCount: 0,
    lastReplayReplayedCount: 0,
    lastReplaySkippedCount: 0,
    lastReplayFailedCount: 0,
    lastReplayError: null,
    lastCleanupAt: null,
    lastCleanupDetectedCount: 0,
    lastCleanupClosedCount: 0,
    lastCleanupFailedCount: 0,
    lastCleanupError: null,
    lastQueueWriteError: null,
    lastPageExitPersistAttemptAt: null,
    lastPageExitPersistSessionId: null,
    lastPageExitPersistEntryCount: 0,
    lastPageExitPersistError: null,
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
  txtExportTimestampsEnabled: false,
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
      lastReplayError: "Replay failed once",
      lastCleanupAt: "2026-03-13T09:30:00.000Z",
      lastCleanupDetectedCount: 3,
      lastCleanupClosedCount: 2,
      lastCleanupFailedCount: 1,
      lastCleanupError: "Cleanup failed once",
      lastQueueWriteError: "Queue write failed once",
      lastPageExitPersistAttemptAt: "2026-03-13T09:31:00.000Z",
      lastPageExitPersistSessionId: "session_exit",
      lastPageExitPersistEntryCount: 7,
      lastPageExitPersistError: "Page exit failed once",
      lastError: "Cleanup failed once",
    });
  });

  it("blocks save and shows a field error for an invalid numeric draft", async () => {
    render(<App />);
    await screen.findByText("필요한 값을 바꾼 뒤 저장하세요.");

    const debounceInput = screen.getByRole("spinbutton", {
      name: "자동 저장 간격",
    }) as HTMLInputElement;

    fireEvent.change(debounceInput, { target: { value: "100" } });

    await waitFor(() => {
      expect(screen.getByText("250 이상이어야 합니다.")).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: "저장" }).hasAttribute("disabled")).toBe(true);
  });

  it("blocks save and shows a field error for a fractional numeric draft", async () => {
    render(<App />);
    await screen.findByText("필요한 값을 바꾼 뒤 저장하세요.");

    const recentCopyInput = screen.getByRole("spinbutton", {
      name: "최근 복사 줄 수",
    }) as HTMLInputElement;

    fireEvent.change(recentCopyInput, { target: { value: "2.5" } });

    await waitFor(() => {
      expect(screen.getByText("정수만 입력할 수 있습니다.")).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: "저장" }).hasAttribute("disabled")).toBe(true);
  });

  it("resets numeric drafts and clears field errors after reset", async () => {
    render(<App />);
    await screen.findByText("필요한 값을 바꾼 뒤 저장하세요.");

    const debounceInput = screen.getByRole("spinbutton", {
      name: "자동 저장 간격",
    }) as HTMLInputElement;

    fireEvent.change(debounceInput, { target: { value: "" } });
    await screen.findByText("값을 입력하세요.");

    fireEvent.click(screen.getByRole("button", { name: "기본값으로 되돌리기" }));

    await waitFor(() => {
      expect(screen.queryByText("값을 입력하세요.")).toBeNull();
    });
    expect(debounceInput.value).toBe("800");
  });

  it("enforces a minimum of one line for recent-copy settings", async () => {
    render(<App />);
    await screen.findByText("필요한 값을 바꾼 뒤 저장하세요.");

    const recentCopyInput = screen.getByRole("spinbutton", {
      name: "최근 복사 줄 수",
    }) as HTMLInputElement;

    fireEvent.change(recentCopyInput, { target: { value: "0" } });

    await waitFor(() => {
      expect(screen.getByText("1 이상이어야 합니다.")).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: "저장" }).hasAttribute("disabled")).toBe(true);
  });

  it("blocks save and shows a field error for an invalid filename pattern", async () => {
    render(<App />);
    await screen.findByText("필요한 값을 바꾼 뒤 저장하세요.");

    const filenameInput = screen.getByRole("textbox", {
      name: "저장 파일 이름 규칙",
    });
    fireEvent.change(filenameInput, { target: { value: "{date}/invalid" } });

    await waitFor(() => {
      expect(screen.getByText("파일 이름에 사용할 수 없는 문자가 포함되어 있습니다.")).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: "저장" }).hasAttribute("disabled")).toBe(true);
  });

  it("renders persist replay diagnostics in diagnostics view", async () => {
    window.history.replaceState({}, "", "/options.html?view=diagnostics");

    render(<App />);

    await screen.findByText("저장 복구 상태");
    expect(screen.getByText("Queue write failed once")).toBeTruthy();
    expect(screen.getByText("Replay failed once")).toBeTruthy();
    expect(screen.getByText("Page exit failed once")).toBeTruthy();
    expect(screen.getByText("session_exit / 7")).toBeTruthy();
    expect(screen.getAllByText("Cleanup failed once").length).toBeGreaterThan(0);
    expect(screen.getByText("1 / 0")).toBeTruthy();
    expect(screen.getByText("2 / 1")).toBeTruthy();
  });

  it("renders the foreign-language noise filter guidance", async () => {
    render(<App />);
    await screen.findByText("필요한 값을 바꾼 뒤 저장하세요.");

    expect(
      screen.getByText(/외국어 원문을 최대한 남기려면 이 옵션을 끄세요/),
    ).toBeTruthy();
  });

  it("hydrates diagnostics counts from the initial capture status payload", async () => {
    const messageListeners: Array<(message: unknown) => void> = [];
    const port = {
      onMessage: {
        addListener: vi.fn((listener: (message: unknown) => void) => {
          messageListeners.push(listener);
        }),
      },
      onDisconnect: {
        addListener: vi.fn(),
      },
      postMessage: vi.fn(),
      disconnect: vi.fn(),
    } as unknown as chrome.runtime.Port;

    window.history.replaceState({}, "", "/options.html?view=diagnostics");
    chromeApiMocks.queryTabs.mockResolvedValue([
      {
        id: 1,
        url: "https://assembly.webcast.go.kr/main/player.asp",
        lastAccessed: Date.now(),
      },
    ]);
    chromeApiMocks.sendRuntimeMessage.mockResolvedValue({
      ok: true,
      ready: true,
      requiresReload: false,
    });
    chromeApiMocks.connectToTab.mockReturnValue(port);

    render(<App />);

    await waitFor(() => {
      expect(chromeApiMocks.connectToTab).toHaveBeenCalled();
    });

    act(() => {
      messageListeners.forEach((listener) =>
        listener({
          type: "CAPTURE_STATUS",
          payload: {
            connected: true,
            requiresReload: false,
            status: "running",
            sessionId: "session_options",
            title: "정무위",
            committeeName: "정무위원회",
            sourceUrl: "https://assembly.webcast.go.kr/main/player.asp",
            subtitleCount: 4,
            charCount: 24,
            previewText: "실시간 미리보기",
            recentEntries: [],
            startedAt: "2026-03-10T09:00:00.000Z",
            endedAt: null,
            updatedAt: "2026-03-10T09:00:03.000Z",
            lastPersistedAt: "2026-03-10T09:00:03.000Z",
            observerActive: true,
            currentSelector: "#viewSubtit",
            currentFramePath: [],
            diagnostics: {
              captureMode: "structured",
              observerActive: true,
              currentSelector: "#viewSubtit",
              currentFramePath: [],
              sourceLabel: "structured",
              persistabilityState: "persistable",
              persistabilityHint: "저장 가능한 확정 자막이 누적되고 있습니다.",
            },
            hasPersistableContent: true,
          },
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText("4문장")).toBeTruthy();
      expect(screen.getByText("structured")).toBeTruthy();
      expect(screen.getByText("저장 가능한 확정 자막이 누적되고 있습니다.")).toBeTruthy();
    });
    expect(port.postMessage).toHaveBeenCalledWith({ type: "GET_STATUS" });
  });

  it("falls back to another supported tab when the requested diagnostics tab disappears", async () => {
    let removedListener:
      | ((tabId: number, removeInfo: chrome.tabs.TabRemoveInfo) => void)
      | undefined;
    chromeApiMocks.addTabRemovedListener.mockImplementationOnce((listener) => {
      removedListener = listener;
    });

    const firstPort = {
      onMessage: {
        addListener: vi.fn(),
      },
      onDisconnect: {
        addListener: vi.fn(),
      },
      postMessage: vi.fn(),
      disconnect: vi.fn(),
    } as unknown as chrome.runtime.Port;
    const secondPort = {
      onMessage: {
        addListener: vi.fn(),
      },
      onDisconnect: {
        addListener: vi.fn(),
      },
      postMessage: vi.fn(),
      disconnect: vi.fn(),
    } as unknown as chrome.runtime.Port;

    window.history.replaceState({}, "", "/options.html?view=diagnostics&tabId=9");
    chromeApiMocks.getTab
      .mockResolvedValueOnce({
        id: 9,
        url: "https://assembly.webcast.go.kr/main/player.asp",
      })
      .mockRejectedValueOnce(new Error("tab missing"));
    chromeApiMocks.queryTabs.mockResolvedValue([
      {
        id: 2,
        url: "https://assembly.webcast.go.kr/main/player.asp?xcode=10",
        active: true,
        lastAccessed: Date.now(),
      },
    ]);
    chromeApiMocks.sendRuntimeMessage.mockResolvedValue({
      ok: true,
      ready: true,
      requiresReload: false,
    });
    chromeApiMocks.connectToTab
      .mockReturnValueOnce(firstPort)
      .mockReturnValueOnce(secondPort);

    render(<App />);

    await waitFor(() => {
      expect(chromeApiMocks.connectToTab).toHaveBeenCalledWith(
        9,
        0,
        "assembly-subtitle-popup",
      );
    });

    act(() => {
      removedListener?.(9, { windowId: 1, isWindowClosing: false });
    });

    await waitFor(() => {
      expect(chromeApiMocks.connectToTab).toHaveBeenCalledWith(
        2,
        0,
        "assembly-subtitle-popup",
      );
    });
    expect(firstPort.disconnect).toHaveBeenCalled();
  });
});
