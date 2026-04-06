import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const chromeApiMocks = vi.hoisted(() => ({
  queryActiveTab: vi.fn(),
  sendRuntimeMessage: vi.fn(),
  sendTabMessage: vi.fn(),
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

  it("hydrates session counts from the initial status snapshot response", async () => {
    chromeApiMocks.queryActiveTab.mockResolvedValue({
      id: 1,
      url: "https://assembly.webcast.go.kr/main/player.asp",
    });
    chromeApiMocks.sendTabMessage.mockResolvedValue({
      ok: true,
      snapshot: {
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
        canPersistPreparedContent: true,
        persistContext: "running_autosave",
        stopPersistInFlight: false,
        observerActive: true,
        currentSelector: "#viewSubtit",
        currentFramePath: [],
        diagnostics: {
          captureMode: "fallback",
          observerActive: true,
          currentSelector: "#viewSubtit",
          currentFramePath: [],
          sourceLabel: "fallback",
        },
      },
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("3문장")).toBeTruthy();
      expect(screen.getByText("18자")).toBeTruthy();
      expect(screen.getByText("실시간 미리보기")).toBeTruthy();
    });
    expect(chromeApiMocks.sendTabMessage).toHaveBeenCalledWith(1, {
      type: "GET_STATUS",
    });
  });

  it("disables save when there is no persistable content and shows save feedback", async () => {
    chromeApiMocks.queryActiveTab.mockResolvedValue({
      id: 1,
      url: "https://assembly.webcast.go.kr/main/player.asp",
    });
    chromeApiMocks.sendTabMessage
      .mockResolvedValueOnce({
        ok: true,
        snapshot: {
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
          canPersistPreparedContent: false,
          persistContext: "idle",
          stopPersistInFlight: false,
          observerActive: false,
          currentSelector: "",
          currentFramePath: [],
          diagnostics: {
            captureMode: "idle",
            observerActive: false,
            currentSelector: "",
            currentFramePath: [],
            sourceLabel: "대기 중",
          },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        feedback: {
          command: "SAVE_SESSION",
          message: "저장할 자막이 아직 없습니다.",
        },
        snapshot: {
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
          canPersistPreparedContent: false,
          persistContext: "idle",
          stopPersistInFlight: false,
          observerActive: false,
          currentSelector: "",
          currentFramePath: [],
          diagnostics: {
            captureMode: "idle",
            observerActive: false,
            currentSelector: "",
            currentFramePath: [],
            sourceLabel: "대기 중",
          },
        },
      });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "지금 저장" }).hasAttribute("disabled")).toBe(true);
    });

    fireEvent.click(screen.getByRole("button", { name: "페이지 패널 열기" }));

    await waitFor(() => {
      expect(screen.getByText("저장할 자막이 아직 없습니다.")).toBeTruthy();
    });
  });

  it("keeps save disabled when only raw preview text exists without prepared entries", async () => {
    chromeApiMocks.queryActiveTab.mockResolvedValue({
      id: 1,
      url: "https://assembly.webcast.go.kr/main/player.asp",
    });
    chromeApiMocks.sendTabMessage.mockResolvedValue({
      ok: true,
      snapshot: {
        connected: true,
        requiresReload: false,
        status: "running",
        sessionId: "session_popup_preview_only",
        title: "정무위",
        committeeName: "정무위원회",
        sourceUrl: "https://assembly.webcast.go.kr/main/player.asp",
        subtitleCount: 0,
        charCount: 0,
        previewText: "실시간 미리보기만 있음",
        recentEntries: [],
        startedAt: "2026-03-10T09:00:00.000Z",
        endedAt: null,
        updatedAt: "2026-03-10T09:00:03.000Z",
        lastPersistedAt: null,
        canPersistPreparedContent: false,
        persistContext: "running_autosave",
        stopPersistInFlight: false,
        observerActive: true,
        currentSelector: "#viewSubtit",
        currentFramePath: [],
        diagnostics: {
          captureMode: "fallback",
          observerActive: true,
          currentSelector: "#viewSubtit",
          currentFramePath: [],
          sourceLabel: "fallback",
        },
      },
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("실시간 미리보기만 있음")).toBeTruthy();
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
});
