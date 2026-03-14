import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const chromeApiMocks = vi.hoisted(() => ({
  connectToTab: vi.fn(),
  queryActiveTab: vi.fn(),
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
              captureMode: "dom-observer",
              observerActive: true,
              currentSelector: "#viewSubtit",
              currentFramePath: [],
              sourceLabel: "DOM observer",
            },
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
});
