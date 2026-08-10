import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
  maxEntriesPerSegment: 2000,
  maxCharsPerSegment: 120000,
  maxSegmentDurationMinutes: 90,
  noiseFilterEnabled: true,
  recentDuplicateMinLength: 8,
  filenamePattern: "{date}_{committee}_{time}",
  txtExportTimestampsEnabled: false,
  txtExportSpeakerEnabled: false,
  txtExportEntryNotesEnabled: false,
  panelSpeakerHighlightEnabled: false,
  runningAutoSaveEnabled: true,
  runningAutoSaveDebounceMs: 800,
  recentCopyLineCount: 5,
  debugLogging: false,
  autoStartEnabled: true,
  filterUnconfirmedEnabled: true,
  presets: [],
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
    await screen.findByText("바꾼 뒤 아래 저장을 누르세요.");

    const debounceInput = screen.getByRole("spinbutton", {
      name: "자동 저장 간격",
    }) as HTMLInputElement;

    fireEvent.change(debounceInput, { target: { value: "100" } });

    await waitFor(() => {
      expect(screen.getByText("250 이상이어야 합니다.")).toBeTruthy();
    });
    expect(
      screen.getByRole("button", { name: "저장" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("blocks save and shows a field error for a fractional numeric draft", async () => {
    render(<App />);
    await screen.findByText("바꾼 뒤 아래 저장을 누르세요.");

    const recentCopyInput = screen.getByRole("spinbutton", {
      name: "한 번에 복사할 줄 수",
    }) as HTMLInputElement;

    fireEvent.change(recentCopyInput, { target: { value: "2.5" } });

    await waitFor(() => {
      expect(screen.getByText("정수만 입력할 수 있습니다.")).toBeTruthy();
    });
    expect(
      screen.getByRole("button", { name: "저장" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("resets numeric drafts and clears field errors after reset", async () => {
    render(<App />);
    await screen.findByText("바꾼 뒤 아래 저장을 누르세요.");

    const debounceInput = screen.getByRole("spinbutton", {
      name: "자동 저장 간격",
    }) as HTMLInputElement;

    fireEvent.change(debounceInput, { target: { value: "" } });
    await screen.findByText("값을 입력하세요.");

    fireEvent.click(
      screen.getByRole("button", { name: "기본값으로 되돌리기" }),
    );

    await waitFor(() => {
      expect(screen.queryByText("값을 입력하세요.")).toBeNull();
    });
    expect(debounceInput.value).toBe("800");
  });

  it("enforces a minimum of one line for recent-copy settings", async () => {
    render(<App />);
    await screen.findByText("바꾼 뒤 아래 저장을 누르세요.");

    const recentCopyInput = screen.getByRole("spinbutton", {
      name: "한 번에 복사할 줄 수",
    }) as HTMLInputElement;

    fireEvent.change(recentCopyInput, { target: { value: "0" } });

    await waitFor(() => {
      expect(screen.getByText("1 이상이어야 합니다.")).toBeTruthy();
    });
    expect(
      screen.getByRole("button", { name: "저장" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("blocks save and shows a field error for an invalid filename pattern", async () => {
    render(<App />);
    await screen.findByText("바꾼 뒤 아래 저장을 누르세요.");

    const filenameInput = screen.getByRole("textbox", {
      name: "저장 파일 이름",
    });
    fireEvent.change(filenameInput, { target: { value: "{date}/invalid" } });

    await waitFor(() => {
      expect(
        screen.getByText(
          "파일 이름에 사용할 수 없는 문자가 포함되어 있습니다.",
        ),
      ).toBeTruthy();
    });
    expect(
      screen.getByRole("button", { name: "저장" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("renders persist replay diagnostics in diagnostics view", async () => {
    window.history.replaceState({}, "", "/options.html?view=diagnostics");

    render(<App />);

    await screen.findByText("최근 저장 복구");
    expect(screen.getByText("Queue write failed once")).toBeTruthy();
    expect(screen.getByText("Replay failed once")).toBeTruthy();
    expect(screen.getByText("Page exit failed once")).toBeTruthy();
    expect(screen.getByText("session_exit / 7")).toBeTruthy();
    expect(screen.getAllByText("Cleanup failed once").length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByText("1건").length).toBeGreaterThan(0);
    expect(screen.getByText("2건")).toBeTruthy();
  });

  it("renders the foreign-language noise filter guidance", async () => {
    render(<App />);
    await screen.findByText("바꾼 뒤 아래 저장을 누르세요.");

    expect(screen.getByText(/필요한 문장이 빠진다면 이 옵션을 끄세요/)).toBeTruthy();
  });

  it("saves speaker export/copy, panel highlight, and entry note options", async () => {
    render(<App />);
    await screen.findByText("바꾼 뒤 아래 저장을 누르세요.");

    const speakerToggle = screen
      .getByText("내보내기·복사에 발언자 넣기")
      .closest("label")
      ?.querySelector("input");
    const panelSpeakerToggle = screen
      .getByText("발언자 색으로 구분 표시")
      .closest("label")
      ?.querySelector("input");
    const noteToggle = screen
      .getByText("내보내기에 메모·중요 표시")
      .closest("label")
      ?.querySelector("input");

    expect(speakerToggle).not.toBeNull();
    expect(panelSpeakerToggle).not.toBeNull();
    expect(noteToggle).not.toBeNull();
    expect((panelSpeakerToggle as HTMLInputElement).checked).toBe(false);
    expect((speakerToggle as HTMLInputElement).checked).toBe(false);

    fireEvent.click(speakerToggle!);
    fireEvent.click(panelSpeakerToggle!);
    fireEvent.click(noteToggle!);
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => {
      expect(settingsStoreMocks.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          txtExportSpeakerEnabled: true,
          panelSpeakerHighlightEnabled: true,
          txtExportEntryNotesEnabled: true,
        }),
      );
    });
  });

  it("adds editable presets and blocks duplicate preset URLs", async () => {
    render(<App />);
    await screen.findByText("바꾼 뒤 아래 저장을 누르세요.");

    const presetUrl = "https://assembly.webcast.go.kr/main/player.asp?xcode=10";
    fireEvent.change(screen.getByPlaceholderText("프리셋 이름"), {
      target: { value: "정무위" },
    });
    fireEvent.change(screen.getByPlaceholderText(/assembly\.webcast/), {
      target: { value: presetUrl },
    });
    fireEvent.change(screen.getByPlaceholderText("위원회명"), {
      target: { value: "정무위원회" },
    });
    fireEvent.click(screen.getByRole("button", { name: "프리셋 추가" }));

    await screen.findByText("프리셋을 추가했습니다. 저장을 눌러 확정하세요.");

    fireEvent.change(screen.getByPlaceholderText("프리셋 이름"), {
      target: { value: "중복" },
    });
    fireEvent.change(screen.getByPlaceholderText(/assembly\.webcast/), {
      target: { value: presetUrl },
    });
    fireEvent.click(screen.getByRole("button", { name: "프리셋 추가" }));

    await screen.findByText("이미 같은 URL의 프리셋이 있습니다.");
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => {
      expect(settingsStoreMocks.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          presets: [
            expect.objectContaining({
              name: "정무위",
              url: presetUrl,
              committeeName: "정무위원회",
            }),
          ],
        }),
      );
    });
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
              segment: {
                lineageId: "session_options",
                segmentNumber: 1,
                entryCount: 4,
                charCount: 24,
                elapsedMs: 15000,
                maxEntriesPerSegment: 2000,
                maxCharsPerSegment: 120000,
                maxDurationMs: 5400000,
                remainingEntries: 1996,
                remainingChars: 119976,
                remainingDurationMs: 5385000,
              },
              exportEstimates: {
                txtBytes: 240,
                srtBytes: 320,
                vttBytes: 340,
                jsonBytes: 640,
                txtIncludesTimestamps: false,
              },
            },
            hasPersistableContent: true,
          },
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText("4문장")).toBeTruthy();
      expect(screen.getByText("자막을 정상적으로 모으는 중")).toBeTruthy();
      expect(screen.queryByText("저장 가능한 확정 자막이 누적되고 있습니다.")).toBeNull();
      expect(screen.queryByText("4문장 / 2000문장 (0.2%)")).toBeNull();
      expect(screen.queryByText("240 B")).toBeNull();
    });
    expect(port.postMessage).toHaveBeenCalledWith({ type: "GET_DIAGNOSTICS_STATUS" });
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

    window.history.replaceState(
      {},
      "",
      "/options.html?view=diagnostics&tabId=9",
    );
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
