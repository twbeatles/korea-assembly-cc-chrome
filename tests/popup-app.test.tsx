import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const chromeApiMocks = vi.hoisted(() => ({
  addTabActivatedListener: vi.fn(),
  addTabRemovedListener: vi.fn(),
  addTabUpdatedListener: vi.fn(),
  connectToTab: vi.fn(),
  queryActiveTab: vi.fn(),
  removeTabActivatedListener: vi.fn(),
  removeTabRemovedListener: vi.fn(),
  removeTabUpdatedListener: vi.fn(),
  sendRuntimeMessage: vi.fn(),
}));

vi.mock("../src/shared/chrome-api", () => chromeApiMocks);

import App from "../src/popup/App";

describe("popup app", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chromeApiMocks.queryActiveTab.mockResolvedValue({
      id: 1,
      url: "https://example.com/",
    });
  });

  it("hydrates session counts from the initial capture status payload", async () => {
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

    chromeApiMocks.queryActiveTab.mockResolvedValue({
      id: 1,
      url: "https://assembly.webcast.go.kr/main/player.asp",
    });
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
            sessionId: "session_popup",
            title: "정무위",
            committeeName: "정무위원회",
            sourceUrl: "https://assembly.webcast.go.kr/main/player.asp",
            subtitleCount: 3,
            charCount: 18,
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
      expect(screen.getByText("3문장")).toBeTruthy();
      expect(screen.getByText("18자")).toBeTruthy();
    });
    expect(port.postMessage).toHaveBeenCalledWith({ type: "GET_STATUS" });
  });

  it("disables save when there is no persistable content and shows popup feedback messages", async () => {
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

    chromeApiMocks.queryActiveTab.mockResolvedValue({
      id: 1,
      url: "https://assembly.webcast.go.kr/main/player.asp",
    });
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
            status: "idle",
            sessionId: "session_popup_empty",
            title: "정무위",
            committeeName: "정무위원회",
            sourceUrl: "https://assembly.webcast.go.kr/main/player.asp",
            subtitleCount: 0,
            charCount: 0,
            previewText: "",
            recentEntries: [],
            startedAt: null,
            endedAt: null,
            updatedAt: null,
            lastPersistedAt: null,
            observerActive: false,
            currentSelector: "",
            currentFramePath: [],
            diagnostics: {
              captureMode: "idle",
              observerActive: false,
              currentSelector: "",
              currentFramePath: [],
              sourceLabel: "대기 중",
              persistabilityState: "idle",
              persistabilityHint: "화면 자막을 기다리고 있습니다.",
            },
            hasPersistableContent: false,
          },
        }),
      );
      messageListeners.forEach((listener) =>
        listener({
          type: "POPUP_FEEDBACK",
          payload: {
            command: "SAVE_SESSION",
            message: "저장할 자막이 아직 없습니다.",
          },
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText("저장할 자막이 아직 없습니다.")).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: "지금 저장" }).hasAttribute("disabled")).toBe(true);
  });

  it("shows a user-facing error when opening history fails", async () => {
    chromeApiMocks.sendRuntimeMessage.mockRejectedValueOnce(new Error("history failed"));

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "저장된 기록" }));

    await waitFor(() => {
      expect(screen.getByText("history failed")).toBeTruthy();
    });
  });

  it("shows a user-facing error when opening options fails", async () => {
    chromeApiMocks.sendRuntimeMessage.mockRejectedValueOnce(new Error("options failed"));

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "환경 설정" }));

    await waitFor(() => {
      expect(screen.getByText("options failed")).toBeTruthy();
    });
  });

  it("shows a user-facing error when opening diagnostics fails", async () => {
    chromeApiMocks.sendRuntimeMessage.mockRejectedValueOnce(new Error("diagnostics failed"));

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "수집 진단" }));

    await waitFor(() => {
      expect(screen.getByText("diagnostics failed")).toBeTruthy();
    });
  });

  it("reconnects to the current active tab when the active tab changes", async () => {
    let activatedListener:
      | ((activeInfo: chrome.tabs.TabActiveInfo) => void)
      | undefined;
    chromeApiMocks.addTabActivatedListener.mockImplementationOnce((listener) => {
      activatedListener = listener;
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

    chromeApiMocks.queryActiveTab
      .mockResolvedValueOnce({
        id: 1,
        url: "https://assembly.webcast.go.kr/main/player.asp",
      })
      .mockResolvedValueOnce({
        id: 2,
        url: "https://assembly.webcast.go.kr/main/player.asp?xcode=10",
      });
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
      expect(chromeApiMocks.connectToTab).toHaveBeenCalledTimes(1);
    });

    act(() => {
      activatedListener?.({ tabId: 2, windowId: 1 });
    });

    await waitFor(() => {
      expect(chromeApiMocks.connectToTab).toHaveBeenCalledTimes(2);
    });
    expect(firstPort.disconnect).toHaveBeenCalled();
    expect(chromeApiMocks.connectToTab).toHaveBeenLastCalledWith(2, 0, "assembly-subtitle-popup");
  });
});
