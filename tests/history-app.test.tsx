import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const chromeApiMocks = vi.hoisted(() => ({
  createTab: vi.fn(),
  sendRuntimeMessage: vi.fn(),
}));

const settingsStoreMocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
}));

const sessionStoreMocks = vi.hoisted(() => ({
  buildSessionLibraryBackupExport: vi.fn(),
  deleteAllSessions: vi.fn(),
  deleteSession: vi.fn(),
  exportSessionData: vi.fn(),
  getSessionLibraryOverview: vi.fn(),
  importSessionRecords: vi.fn(),
  listSessions: vi.fn(),
  upsertSessionRecord: vi.fn(),
}));

vi.mock("../src/shared/chrome-api", () => chromeApiMocks);
vi.mock("../src/storage/settings-store", () => settingsStoreMocks);
vi.mock("../src/storage/session-store", () => sessionStoreMocks);

import App from "../src/history/App";

function buildSession() {
  return {
    id: "session_history_1",
    version: "3",
    title: "정무위",
    committeeName: "정무위원회",
    sourceUrl: "https://assembly.webcast.go.kr/main/player.asp",
    startedAt: "2026-03-10T09:00:00.000Z",
    endedAt: "2026-03-10T09:00:03.000Z",
    createdAt: "2026-03-10T09:00:00.000Z",
    updatedAt: "2026-03-10T09:00:03.000Z",
    subtitleCount: 1,
    charCount: 8,
    status: "saved" as const,
    starred: false,
    pinnedAt: null,
    note: "",
    entries: [
      {
        id: "entry_1",
        text: "테스트 자막",
        timestamp: "2026-03-10T09:00:00.000Z",
        startTime: "2026-03-10T09:00:00.000Z",
        endTime: "2026-03-10T09:00:02.000Z",
      },
    ],
  };
}

describe("history app", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: {
        storage: {
          onChanged: {
            addListener: vi.fn(),
            removeListener: vi.fn(),
          },
        },
      },
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    settingsStoreMocks.getSettings.mockResolvedValue({
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
    });
    sessionStoreMocks.listSessions.mockResolvedValue([buildSession()]);
    sessionStoreMocks.getSessionLibraryOverview.mockResolvedValue({
      totalCount: 1,
      previewSessions: [
        {
          id: "session_history_1",
          title: "정무위",
          committeeName: "정무위원회",
          updatedAt: "2026-03-10T09:00:03.000Z",
        },
      ],
    });
    sessionStoreMocks.deleteAllSessions.mockResolvedValue(undefined);
    sessionStoreMocks.buildSessionLibraryBackupExport.mockResolvedValue({
      sessionCount: 1,
      payload: {
        filename: "backup.json",
        format: "json",
        mimeType: "application/json;charset=utf-8",
        content: "{}",
      },
    });
    chromeApiMocks.sendRuntimeMessage.mockResolvedValue({ ok: true });
  });

  it("shows a user-facing error when reopening the source page fails", async () => {
    chromeApiMocks.createTab.mockRejectedValueOnce(new Error("reopen failed"));

    render(<App />);
    await screen.findByRole("button", { name: "원본 페이지 열기" });
    fireEvent.click(screen.getByRole("button", { name: "원본 페이지 열기" }));

    await waitFor(() => {
      expect(screen.getByText("reopen failed")).toBeTruthy();
    });
  });

  it("shows a user-facing error when exporting fails", async () => {
    sessionStoreMocks.exportSessionData.mockRejectedValueOnce(new Error("export failed"));

    render(<App />);
    await screen.findByRole("button", { name: "텍스트(TXT)" });
    fireEvent.click(screen.getByRole("button", { name: "텍스트(TXT)" }));

    await waitFor(() => {
      expect(screen.getByText("export failed")).toBeTruthy();
    });
  });

  it("uses the library overview helper for delete-all confirmation", async () => {
    render(<App />);
    await screen.findByRole("button", { name: "전체 삭제" });
    fireEvent.click(screen.getByRole("button", { name: "전체 삭제" }));

    await waitFor(() => {
      expect(sessionStoreMocks.getSessionLibraryOverview).toHaveBeenCalled();
      expect(sessionStoreMocks.deleteAllSessions).toHaveBeenCalled();
    });
    expect(
      sessionStoreMocks.listSessions.mock.calls.some(
        ([arg]) => arg?.limit === Number.MAX_SAFE_INTEGER,
      ),
    ).toBe(false);
  });

  it("uses the backup export helper for full-library JSON backup", async () => {
    render(<App />);
    await screen.findByRole("button", { name: "전체 JSON 백업" });
    fireEvent.click(screen.getByRole("button", { name: "전체 JSON 백업" }));

    await waitFor(() => {
      expect(sessionStoreMocks.buildSessionLibraryBackupExport).toHaveBeenCalled();
      expect(chromeApiMocks.sendRuntimeMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          filename: "backup.json",
        }),
      );
    });
  });
});
