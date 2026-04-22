import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionRecord } from "../src/core/subtitle-models";
import { SESSION_LIBRARY_REVISION_STORAGE_KEY } from "../src/shared/constants";
import { SESSION_LIBRARY_TRANSFER_LIMIT_BYTES } from "../src/storage/session-backup";

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
  listSessionLineageSegments: vi.fn(),
  listSessionsPage: vi.fn(),
  loadSession: vi.fn(),
  loadSessionsByIds: vi.fn(),
  updateSessionMetadata: vi.fn(),
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

function buildSession(overrides: Partial<SessionRecord> = {}) {
  return {
    ...buildSessionBase(),
    ...overrides,
  };
}

function buildSessionBase(): SessionRecord {
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
      maxEntriesPerSegment: 2000,
      maxCharsPerSegment: 120000,
      maxSegmentDurationMinutes: 90,
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
    });

    const session = buildSession();
    sessionStoreMocks.listSessionsPage.mockResolvedValue({
      sessions: [session],
      totalCount: 1,
      page: 1,
      pageSize: 200,
    });
    sessionStoreMocks.loadSession.mockResolvedValue(session);
    sessionStoreMocks.listSessionLineageSegments.mockResolvedValue([session]);
    sessionStoreMocks.loadSessionsByIds.mockImplementation(async (ids: string[]) =>
      ids.includes(session.id) ? [session] : [],
    );
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
    sessionStoreMocks.updateSessionMetadata.mockResolvedValue(session);
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

  it("disables reopen when source url is not a supported assembly player url", async () => {
    const unsupportedSession = buildSession({
      sourceUrl: "https://example.com/not-supported",
    });
    sessionStoreMocks.listSessionsPage.mockResolvedValueOnce({
      sessions: [unsupportedSession],
      totalCount: 1,
      page: 1,
      pageSize: 200,
    });
    sessionStoreMocks.loadSession.mockResolvedValueOnce(unsupportedSession);
    sessionStoreMocks.loadSessionsByIds.mockImplementationOnce(async (ids: string[]) =>
      ids.includes(unsupportedSession.id) ? [unsupportedSession] : [],
    );

    render(<App />);
    const reopenButton = await screen.findByRole("button", { name: "원본 페이지 열기" });

    expect((reopenButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(reopenButton);
    expect(chromeApiMocks.createTab).not.toHaveBeenCalled();
  });

  it("shows a segment badge for segmented session records", async () => {
    const segmentedSession = buildSession({
      id: "session_segmented_2",
      lineageId: "lineage_segmented",
      segmentNumber: 2,
    });
    sessionStoreMocks.listSessionsPage.mockResolvedValueOnce({
      sessions: [segmentedSession],
      totalCount: 1,
      page: 1,
      pageSize: 200,
    });
    sessionStoreMocks.loadSession.mockResolvedValueOnce(segmentedSession);
    sessionStoreMocks.loadSessionsByIds.mockImplementationOnce(async (ids: string[]) =>
      ids.includes(segmentedSession.id) ? [segmentedSession] : [],
    );

    render(<App />);

    const badges = await screen.findAllByText("세그먼트 2");
    expect(badges.length).toBeGreaterThan(0);
  });

  it("switches to lineage-wide export when the merged lineage view is enabled", async () => {
    const segmentOne = buildSession({
      id: "lineage_history",
      title: "국회 본회의",
      committeeName: "정무위원회",
      lineageId: "lineage_history",
      segmentNumber: 1,
      entries: [
        {
          id: "entry_segment_1",
          text: "첫 번째 세그먼트",
          timestamp: "2026-03-10T09:00:00.000Z",
          startTime: "2026-03-10T09:00:00.000Z",
          endTime: "2026-03-10T09:00:02.000Z",
        },
      ],
      subtitleCount: 1,
      charCount: 9,
    });
    const segmentTwo = buildSession({
      id: "lineage_history_2",
      title: "국회 본회의",
      committeeName: "정무위원회",
      startedAt: "2026-03-10T09:10:00.000Z",
      endedAt: "2026-03-10T09:12:00.000Z",
      createdAt: "2026-03-10T09:10:00.000Z",
      updatedAt: "2026-03-10T09:12:00.000Z",
      lineageId: "lineage_history",
      segmentNumber: 2,
      entries: [
        {
          id: "entry_segment_2",
          text: "두 번째 세그먼트",
          timestamp: "2026-03-10T09:11:00.000Z",
          startTime: "2026-03-10T09:11:00.000Z",
          endTime: "2026-03-10T09:11:02.000Z",
        },
      ],
      subtitleCount: 1,
      charCount: 9,
    });

    sessionStoreMocks.listSessionsPage.mockResolvedValueOnce({
      sessions: [segmentOne, segmentTwo],
      totalCount: 2,
      page: 1,
      pageSize: 200,
    });
    sessionStoreMocks.loadSession.mockResolvedValueOnce(segmentOne);
    sessionStoreMocks.listSessionLineageSegments.mockResolvedValueOnce([segmentOne, segmentTwo]);
    sessionStoreMocks.loadSessionsByIds.mockImplementationOnce(async (ids: string[]) =>
      [segmentOne, segmentTwo].filter((session) => ids.includes(session.id)),
    );

    render(<App />);

    const toggleButton = await screen.findByRole("button", { name: "연속 캡처 전체 보기" });
    fireEvent.click(toggleButton);
    fireEvent.click(screen.getByRole("button", { name: "텍스트(TXT)" }));

    await waitFor(() => {
      expect(chromeApiMocks.sendRuntimeMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "DOWNLOAD_SESSION_LINEAGE_EXPORT",
          lineageId: "lineage_history",
          format: "txt",
        }),
      );
    });
  });

  it("shows a user-facing error when exporting fails", async () => {
    chromeApiMocks.sendRuntimeMessage.mockRejectedValueOnce(new Error("export failed"));

    render(<App />);
    await screen.findByRole("button", { name: "텍스트(TXT)" });
    fireEvent.click(screen.getByRole("button", { name: "텍스트(TXT)" }));

    await waitFor(() => {
      expect(screen.getByText("export failed")).toBeTruthy();
    });
  });

  it("maps oversized download request errors to a user-facing export message", async () => {
    chromeApiMocks.sendRuntimeMessage.mockResolvedValueOnce({
      ok: false,
      error: "Message length exceeded",
    });

    render(<App />);
    await screen.findByRole("button", { name: "텍스트(TXT)" });
    fireEvent.click(screen.getByRole("button", { name: "텍스트(TXT)" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "내보내기 데이터가 커서 저장 요청을 전송하지 못했습니다. 범위를 나누어 다시 시도해 주세요.",
        ),
      ).toBeTruthy();
    });
  });

  it("passes the TXT timestamp setting through when exporting", async () => {
    render(<App />);
    await screen.findByRole("button", { name: "텍스트(TXT)" });
    fireEvent.click(screen.getByRole("button", { name: "텍스트(TXT)" }));

    await waitFor(() => {
      expect(chromeApiMocks.sendRuntimeMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "DOWNLOAD_SESSION_EXPORT",
          sessionId: "session_history_1",
          format: "txt",
          filenamePattern: "{date}_{committee}_{time}",
          txtExportTimestampsEnabled: false,
          entryIds: undefined,
        }),
      );
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

  it("shows backup progress, locks only JSON tasks, and supports cancellation", async () => {
    const deferred = createDeferred<{
      sessionCount: number;
      payload: {
        filename: string;
        format: "json";
        mimeType: string;
        content: string;
      };
    }>();
    sessionStoreMocks.buildSessionLibraryBackupExport.mockImplementationOnce(async (options) => {
      options?.onProgress?.({
        kind: "backup",
        phase: "collect",
        completed: 1,
        total: 3,
        message: "전체 JSON 백업을 준비하고 있습니다. (1 / 3)",
      });
      return deferred.promise;
    });

    render(<App />);
    const backupButton = await screen.findByRole("button", { name: "전체 JSON 백업" });
    const importButton = screen.getByRole("button", { name: "JSON 가져오기" });
    const deleteAllButton = screen.getByRole("button", { name: "전체 삭제" });

    fireEvent.click(backupButton);

    await waitFor(() => {
      expect(backupButton.hasAttribute("disabled")).toBe(true);
      expect(importButton.hasAttribute("disabled")).toBe(true);
      expect(deleteAllButton.hasAttribute("disabled")).toBe(false);
      expect(screen.getByText("단계: 기록 수집")).toBeTruthy();
      expect(screen.getByText("진행: 1 / 3")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "취소" }));

    await waitFor(() => {
      expect(sessionStoreMocks.buildSessionLibraryBackupExport).toHaveBeenCalledWith(
        expect.objectContaining({
          signal: expect.objectContaining({ aborted: true }),
        }),
      );
    });
    deferred.reject(new DOMException("backup aborted", "AbortError"));

    await waitFor(() => {
      expect(backupButton.hasAttribute("disabled")).toBe(false);
      expect(importButton.hasAttribute("disabled")).toBe(false);
      expect(screen.getByText("전체 JSON 백업을 취소했습니다.")).toBeTruthy();
    });
  });

  it("shows a partial import summary when JSON import is cancelled after some writes", async () => {
    const deferred = createDeferred<{
      addedCount: number;
      updatedCount: number;
      keptCount: number;
      failedCount: number;
    }>();
    sessionStoreMocks.importSessionRecords.mockImplementationOnce(async (_records, options) => {
      options?.onProgress?.({
        kind: "import",
        phase: "write",
        completed: 1,
        total: 2,
        message: "JSON 가져오기를 진행하고 있습니다. (1 / 2)",
      });
      return deferred.promise;
    });

    render(<App />);
    await screen.findByRole("button", { name: "JSON 가져오기" });

    const importInput = document.querySelector(".hidden-file-input") as HTMLInputElement | null;
    expect(importInput).not.toBeNull();

    const file = {
      name: "backup.json",
      type: "application/json",
      text: vi.fn().mockResolvedValue(
        JSON.stringify({
          kind: "assembly-subtitle-session-backup",
          version: "1",
          exportedAt: "2026-03-10T09:00:00.000Z",
          sessions: [
            buildSession({
              id: "session_import_a",
              updatedAt: "2026-03-10T09:00:04.000Z",
            }),
            buildSession({
              id: "session_import_b",
              updatedAt: "2026-03-10T09:00:05.000Z",
            }),
          ],
        }),
      ),
    } as unknown as File;

    fireEvent.change(importInput!, {
      target: {
        files: [file],
      },
    });

    await waitFor(() => {
      expect(screen.getByText("단계: 기록 저장")).toBeTruthy();
      expect(screen.getByText("진행: 1 / 2")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "취소" }));

    await waitFor(() => {
      expect(sessionStoreMocks.importSessionRecords).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          signal: expect.objectContaining({ aborted: true }),
        }),
      );
    });

    deferred.reject(
      Object.assign(new DOMException("import aborted", "AbortError"), {
        summary: {
          addedCount: 1,
          updatedCount: 0,
          keptCount: 0,
          failedCount: 0,
        },
      }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(
          "JSON 가져오기를 취소했습니다. 추가 1건 / 갱신 0건 / 유지 0건 / 실패 0건 / 무효 0건",
        ),
      ).toBeTruthy();
    });
  });

  it("shows a cancellation message when import is aborted during the read phase", async () => {
    const firstChunk = createDeferred<string>();

    render(<App />);
    await screen.findByRole("button", { name: "JSON 가져오기" });

    const importInput = document.querySelector(".hidden-file-input") as HTMLInputElement | null;
    expect(importInput).not.toBeNull();

    const file = {
      name: "backup.json",
      type: "application/json",
      size: 8,
      slice: vi.fn((start: number, end: number) => ({
        text: vi.fn(() => {
          if (start === 0 && end === 8) {
            return firstChunk.promise;
          }
          return Promise.resolve("");
        }),
      })),
      text: vi.fn(),
    } as unknown as File;

    fireEvent.change(importInput!, {
      target: {
        files: [file],
      },
    });

    await screen.findByRole("button", { name: "취소" });
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    firstChunk.resolve('{"a":1}');

    await waitFor(() => {
      expect(screen.getByText("JSON 가져오기를 취소했습니다.")).toBeTruthy();
    });
    expect(sessionStoreMocks.importSessionRecords).not.toHaveBeenCalled();
  });

  it("blocks oversized JSON imports before parsing or writing", async () => {
    render(<App />);
    await screen.findByRole("button", { name: "JSON 가져오기" });

    const importInput = document.querySelector(".hidden-file-input") as HTMLInputElement | null;
    expect(importInput).not.toBeNull();

    const file = {
      name: "oversized.json",
      type: "application/json",
      size: SESSION_LIBRARY_TRANSFER_LIMIT_BYTES + 1,
      text: vi.fn(),
    } as unknown as File;

    fireEvent.change(importInput!, {
      target: {
        files: [file],
      },
    });

    await waitFor(() => {
      expect(
        screen.getByText("JSON 가져오기 작업은 25 MiB 이하에서만 지원합니다."),
      ).toBeTruthy();
    });
    expect(sessionStoreMocks.importSessionRecords).not.toHaveBeenCalled();
  });

  it("uses the metadata update helper for favorites and notes", async () => {
    render(<App />);
    await screen.findByRole("button", { name: "즐겨찾기 추가" });

    fireEvent.click(screen.getByRole("button", { name: "즐겨찾기 추가" }));

    await waitFor(() => {
      expect(sessionStoreMocks.updateSessionMetadata).toHaveBeenCalledWith(
        "session_history_1",
        expect.objectContaining({
          starred: true,
          pinnedAt: expect.any(String),
        }),
      );
    });

    const noteInput = document.querySelector("textarea") as HTMLTextAreaElement | null;
    expect(noteInput).not.toBeNull();
    fireEvent.change(noteInput!, { target: { value: "새 메모" } });
    fireEvent.click(screen.getByRole("button", { name: "메모 저장" }));

    await waitFor(() => {
      expect(sessionStoreMocks.updateSessionMetadata).toHaveBeenCalledWith(
        "session_history_1",
        expect.objectContaining({
          note: "새 메모",
        }),
      );
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

  it("discards a dirty note draft after confirmed refresh", async () => {
    render(<App />);
    await screen.findByRole("button", { name: "목록 새로고침" });

    const noteInput = document.querySelector("textarea") as HTMLTextAreaElement | null;
    expect(noteInput).not.toBeNull();
    fireEvent.change(noteInput!, { target: { value: "draft note" } });

    fireEvent.click(screen.getByRole("button", { name: "목록 새로고침" }));

    await waitFor(() => {
      expect(noteInput?.value).toBe("");
    });
  });

  it("discards a dirty note draft after confirmed filter change when the same session remains selected", async () => {
    const starredSession = buildSession({
      starred: true,
    });

    sessionStoreMocks.listSessionsPage.mockImplementation(async () => ({
      sessions: [starredSession],
      totalCount: 1,
      page: 1,
      pageSize: 200,
    }));
    sessionStoreMocks.loadSession.mockResolvedValue(starredSession);
    sessionStoreMocks.loadSessionsByIds.mockImplementation(async (ids: string[]) =>
      ids.includes(starredSession.id) ? [starredSession] : [],
    );

    render(<App />);
    await screen.findByRole("button", { name: "즐겨찾기만 보기" });

    const noteInput = document.querySelector("textarea") as HTMLTextAreaElement | null;
    expect(noteInput).not.toBeNull();
    fireEvent.change(noteInput!, { target: { value: "draft note" } });

    fireEvent.click(screen.getByRole("button", { name: "즐겨찾기만 보기" }));

    await waitFor(() => {
      expect(noteInput?.value).toBe("");
    });
  });
});
