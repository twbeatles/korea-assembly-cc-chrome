import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SESSION_LIBRARY_REVISION_STORAGE_KEY } from "../src/shared/constants";

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
  listSessionsPage: vi.fn(),
  loadSession: vi.fn(),
  loadSessionsByIds: vi.fn(),
  searchSessionsPage: vi.fn(),
  upsertSessionRecord: vi.fn(),
}));

vi.mock("../src/shared/chrome-api", () => chromeApiMocks);
vi.mock("../src/storage/settings-store", () => settingsStoreMocks);
vi.mock("../src/storage/session-store", () => sessionStoreMocks);

import App from "../src/history/App";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return {
    promise,
    resolve,
    reject,
  };
}

function buildSession(overrides: Partial<ReturnType<typeof buildSessionBase>> = {}) {
  return {
    ...buildSessionBase(),
    ...overrides,
  };
}

function buildSessionBase() {
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

function buildSearchHit(
  session: ReturnType<typeof buildSession>,
  overrides: Partial<{
    matchedEntryIds: string[];
    matchedCount: number;
    firstSnippet: string;
  }> = {},
) {
  return {
    sessionId: session.id,
    title: session.title,
    committeeName: session.committeeName,
    sourceUrl: session.sourceUrl,
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
    subtitleCount: session.subtitleCount,
    charCount: session.charCount,
    status: session.status,
    starred: session.starred,
    hasNote: Boolean(session.note.trim()),
    matchedEntryIds: overrides.matchedEntryIds ?? session.entries.map((entry) => entry.id),
    matchedCount: overrides.matchedCount ?? 1,
    firstSnippet: overrides.firstSnippet ?? session.entries[0]?.text ?? "",
  };
}

describe("history app", () => {
  const storageListeners: Array<
    (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void
  > = [];

  beforeEach(() => {
    vi.clearAllMocks();
    storageListeners.length = 0;

    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: {
        storage: {
          onChanged: {
            addListener: vi.fn((listener) => {
              storageListeners.push(listener);
            }),
            removeListener: vi.fn((listener) => {
              const index = storageListeners.indexOf(listener);
              if (index >= 0) {
                storageListeners.splice(index, 1);
              }
            }),
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
      exportTxtWithoutTimestamps: true,
      debugLogging: false,
      autoStartEnabled: true,
      filterUnconfirmedEnabled: true,
    });

    const session = buildSession();
    sessionStoreMocks.listSessionsPage.mockResolvedValue({
      sessions: [session],
      totalCount: 1,
      page: 1,
      pageSize: 200,
    });
    sessionStoreMocks.loadSession.mockResolvedValue(session);
    sessionStoreMocks.loadSessionsByIds.mockImplementation(async (ids: string[]) =>
      ids.includes(session.id) ? [session] : [],
    );
    sessionStoreMocks.searchSessionsPage.mockResolvedValue({
      results: [],
      totalCount: 0,
      page: 1,
      pageSize: 200,
    });
    sessionStoreMocks.getSessionLibraryOverview.mockResolvedValue({
      totalCount: 1,
      previewSessions: [
        {
          id: session.id,
          title: session.title,
          committeeName: session.committeeName,
          updatedAt: session.updatedAt,
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
    sessionStoreMocks.upsertSessionRecord.mockResolvedValue(session);
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

  it("disables long-running action buttons while a backup is in progress", async () => {
    const deferred = createDeferred<{
      sessionCount: number;
      payload: {
        filename: string;
        format: "json";
        mimeType: string;
        content: string;
      };
    }>();
    sessionStoreMocks.buildSessionLibraryBackupExport.mockReturnValueOnce(deferred.promise);

    render(<App />);
    const backupButton = await screen.findByRole("button", { name: "전체 JSON 백업" });
    const deleteAllButton = screen.getByRole("button", { name: "전체 삭제" });

    fireEvent.click(backupButton);

    await waitFor(() => {
      expect(backupButton.hasAttribute("disabled")).toBe(true);
      expect(deleteAllButton.hasAttribute("disabled")).toBe(true);
      expect(screen.getByText("전체 JSON 백업을 준비하고 있습니다.")).toBeTruthy();
    });

    deferred.resolve({
      sessionCount: 1,
      payload: {
        filename: "backup.json",
        format: "json",
        mimeType: "application/json;charset=utf-8",
        content: "{}",
      },
    });

    await waitFor(() => {
      expect(backupButton.hasAttribute("disabled")).toBe(false);
      expect(deleteAllButton.hasAttribute("disabled")).toBe(false);
    });
  });

  it("keeps a dirty note draft when the session library revision refreshes the same selection", async () => {
    render(<App />);
    await screen.findByRole("button", { name: "원본 페이지 열기" });

    const noteInput = document.querySelector("textarea") as HTMLTextAreaElement | null;
    expect(noteInput).not.toBeNull();
    fireEvent.change(noteInput!, { target: { value: "draft note" } });

    sessionStoreMocks.loadSession.mockResolvedValueOnce(
      buildSession({
        note: "saved note",
        updatedAt: "2026-03-10T09:00:10.000Z",
      }),
    );

    act(() => {
      storageListeners.forEach((listener) =>
        listener(
          {
            [SESSION_LIBRARY_REVISION_STORAGE_KEY]: {
              oldValue: "old",
              newValue: "new",
            },
          },
          "local",
        ),
      );
    });

    await waitFor(() => {
      expect(sessionStoreMocks.listSessionsPage).toHaveBeenCalledTimes(2);
    });
    expect(noteInput?.value).toBe("draft note");
  });

  it("switches the left list to transcript search results and initializes detail search on selection", async () => {
    const primarySession = buildSession();
    const searchSession = buildSession({
      id: "session_history_search",
      committeeName: "교육위원회",
      title: "교육위",
      entries: [
        {
          id: "entry_search_1",
          text: "특정 자막 검색 결과",
          timestamp: "2026-03-10T09:00:00.000Z",
          startTime: "2026-03-10T09:00:00.000Z",
          endTime: "2026-03-10T09:00:02.000Z",
        },
      ],
      subtitleCount: 1,
      charCount: 11,
    });

    sessionStoreMocks.listSessionsPage.mockResolvedValue({
      sessions: [primarySession, searchSession],
      totalCount: 2,
      page: 1,
      pageSize: 200,
    });
    sessionStoreMocks.loadSession.mockImplementation(async (id: string) =>
      id === searchSession.id ? searchSession : primarySession,
    );
    sessionStoreMocks.loadSessionsByIds.mockImplementation(async (ids: string[]) =>
      ids
        .map((id) => (id === searchSession.id ? searchSession : primarySession))
        .filter((session) => ids.includes(session.id)),
    );
    sessionStoreMocks.searchSessionsPage.mockResolvedValue({
      results: [buildSearchHit(searchSession, { firstSnippet: "특정 자막 검색 결과", matchedCount: 1 })],
      totalCount: 1,
      page: 1,
      pageSize: 200,
    });

    render(<App />);
    const globalSearchInput = await screen.findByPlaceholderText("전체 기록에서 자막 검색");
    fireEvent.change(globalSearchInput, { target: { value: "특정" } });

    await waitFor(() => {
      expect(sessionStoreMocks.searchSessionsPage).toHaveBeenCalledWith({
        query: "특정",
        page: 1,
        pageSize: 200,
        starredOnly: false,
      });
      expect(screen.getByText("일치 항목 1개")).toBeTruthy();
    });

    const searchResultButton = screen.getByText("교육위원회").closest("button");
    if (!searchResultButton) {
      throw new Error("search result button was not rendered");
    }
    fireEvent.click(searchResultButton);

    await waitFor(() => {
      expect(
        (screen.getByPlaceholderText("이 기록 안에서 내용 찾기") as HTMLInputElement).value,
      ).toBe("특정");
    });
  });

  it("restores the paged session list when the global transcript search is cleared", async () => {
    const primarySession = buildSession();
    const searchSession = buildSession({
      id: "session_history_search_restore",
      committeeName: "교육위원회",
      title: "교육위",
      entries: [
        {
          id: "entry_restore_1",
          text: "특정 자막 검색 결과",
          timestamp: "2026-03-10T09:00:00.000Z",
          startTime: "2026-03-10T09:00:00.000Z",
          endTime: "2026-03-10T09:00:02.000Z",
        },
      ],
    });

    sessionStoreMocks.listSessionsPage.mockResolvedValue({
      sessions: [primarySession, searchSession],
      totalCount: 2,
      page: 1,
      pageSize: 200,
    });
    sessionStoreMocks.loadSession.mockImplementation(async (id: string) =>
      id === searchSession.id ? searchSession : primarySession,
    );
    sessionStoreMocks.loadSessionsByIds.mockImplementation(async (ids: string[]) =>
      ids
        .map((id) => (id === searchSession.id ? searchSession : primarySession))
        .filter((session) => ids.includes(session.id)),
    );
    sessionStoreMocks.searchSessionsPage.mockResolvedValue({
      results: [buildSearchHit(searchSession, { firstSnippet: "특정 자막 검색 결과", matchedCount: 1 })],
      totalCount: 1,
      page: 1,
      pageSize: 200,
    });

    render(<App />);
    const globalSearchInput = await screen.findByPlaceholderText("전체 기록에서 자막 검색");
    fireEvent.change(globalSearchInput, { target: { value: "특정" } });

    await waitFor(() => {
      expect(screen.getByText("검색 결과 1개")).toBeTruthy();
    });

    fireEvent.change(globalSearchInput, { target: { value: "" } });

    await waitFor(() => {
      expect(screen.getByText("전체 2개")).toBeTruthy();
      expect(sessionStoreMocks.listSessionsPage).toHaveBeenCalledTimes(2);
    });
  });
});
