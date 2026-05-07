import { describe, expect, it, vi } from "vitest";

import type { SessionRecord } from "../src/core/subtitle-models";
import {
  downloadExportWithFallback,
  handleBackgroundCommand,
  isBackgroundCommandMessage,
  type BackgroundCommandDependencies,
} from "../src/background/service-worker-commands";
import type { BackgroundCommandMessage } from "../src/shared/message-types";

function buildSession(status: SessionRecord["status"] = "saved"): SessionRecord {
  return {
    id: "session_background",
    version: "3",
    title: "정무위원회",
    committeeName: "정무위원회",
    sourceUrl: "https://assembly.webcast.go.kr/main/player.asp",
    startedAt: "2026-03-10T09:00:00.000Z",
    endedAt: status === "running" ? null : "2026-03-10T09:00:03.000Z",
    createdAt: "2026-03-10T09:00:00.000Z",
    updatedAt: "2026-03-10T09:00:03.000Z",
    subtitleCount: 1,
    charCount: 6,
    status,
    starred: false,
    pinnedAt: null,
    note: "",
    entries: [
      {
        id: "entry_background_1",
        text: "테스트 자막",
        timestamp: "2026-03-10T09:00:01.000Z",
        startTime: "2026-03-10T09:00:01.000Z",
        endTime: "2026-03-10T09:00:02.000Z",
      },
    ],
  };
}

function createDependencies(): BackgroundCommandDependencies {
  return {
    supportsAssemblyPage: vi.fn(() => true),
    waitForTopFrameReady: vi.fn(async () => true),
    injectConfiguredContentScripts: vi.fn(async () => undefined),
    onInjectConfiguredContentScriptsError: vi.fn(),
    getOrCreateStoredFrameForwardNonce: vi.fn(async () => "nonce_1"),
    queueExitPersistRecord: vi.fn(async () => undefined),
    persistSessionRecord: vi.fn(async () => ({ updatedAt: "2026-03-10T09:00:03.000Z" })),
    deleteSessionRecord: vi.fn(async () => undefined),
    downloadExport: vi.fn(async () => 11),
    openHistoryPage: vi.fn(async () => undefined),
    openOptionsPage: vi.fn(async () => undefined),
    openDiagnosticsPage: vi.fn(async () => undefined),
  };
}

describe("service worker command helpers", () => {
  it("recognizes supported background command messages", () => {
    expect(isBackgroundCommandMessage({ type: "OPEN_HISTORY_PAGE" })).toBe(true);
    expect(isBackgroundCommandMessage({ type: "UNKNOWN" })).toBe(false);
    expect(isBackgroundCommandMessage(null)).toBe(false);
  });

  it("injects content scripts only after an initial readiness miss", async () => {
    const dependencies = createDependencies();
    (dependencies.waitForTopFrameReady as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const response = await handleBackgroundCommand(
      {
        type: "ENSURE_CONTENT_SCRIPT",
        tabId: 9,
        url: "https://assembly.webcast.go.kr/main/player.asp",
      },
      {},
      dependencies,
    );

    expect(response).toEqual({ ok: true, ready: true, requiresReload: false });
    expect(dependencies.injectConfiguredContentScripts).toHaveBeenCalledWith(9);
  });

  it("rejects non-player assembly pages before reinjection", async () => {
    const dependencies = createDependencies();
    (dependencies.supportsAssemblyPage as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const response = await handleBackgroundCommand(
      {
        type: "ENSURE_CONTENT_SCRIPT",
        tabId: 9,
        url: "https://assembly.webcast.go.kr/main/",
      },
      {},
      dependencies,
    );

    expect(response).toEqual({
      ok: false,
      error: "국회 의사중계 플레이어 페이지에서만 동작합니다.",
    });
    expect(dependencies.injectConfiguredContentScripts).not.toHaveBeenCalled();
  });

  it("requests reload when the page still is not ready after reinjection", async () => {
    const dependencies = createDependencies();
    (dependencies.waitForTopFrameReady as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const response = await handleBackgroundCommand(
      {
        type: "ENSURE_CONTENT_SCRIPT",
        tabId: 9,
        url: "https://assembly.webcast.go.kr/main/player.asp",
      },
      {},
      dependencies,
    );

    expect(response).toEqual({ ok: true, ready: false, requiresReload: true });
    expect(dependencies.injectConfiguredContentScripts).toHaveBeenCalledTimes(1);
  });

  it("normalizes diagnostics and persistence commands through injected dependencies", async () => {
    const dependencies = createDependencies();
    const record = buildSession("running");
    const queued = await handleBackgroundCommand(
      {
        type: "QUEUE_EXIT_PERSIST_RECORD",
        record: buildSession("stopped"),
      },
      {},
      dependencies,
    );

    const persisted = await handleBackgroundCommand(
      {
        type: "PERSIST_SESSION_RECORD",
        record,
      },
      {},
      dependencies,
    );
    const diagnostics = await handleBackgroundCommand(
      {
        type: "OPEN_DIAGNOSTICS_PAGE",
      },
      {
        tab: {
          id: 77,
        } as chrome.tabs.Tab,
      },
      dependencies,
    );

    expect(queued).toEqual({ ok: true });
    expect(dependencies.queueExitPersistRecord).toHaveBeenCalledWith(
      expect.objectContaining({ status: "stopped" }),
    );
    expect(persisted).toEqual({ ok: true, updatedAt: "2026-03-10T09:00:03.000Z" });
    expect(dependencies.persistSessionRecord).toHaveBeenCalledWith(record);
    expect(diagnostics).toEqual({ ok: true });
    expect(dependencies.openDiagnosticsPage).toHaveBeenCalledWith(77);
  });

  it("returns a nonce error when the sender tab is missing", async () => {
    const response = await handleBackgroundCommand(
      {
        type: "GET_FRAME_FORWARD_NONCE",
      },
      {},
      createDependencies(),
    );

    expect(response).toEqual({
      ok: false,
      error: "탭 정보를 확인하지 못했습니다.",
    });
  });

  it("prefers blob downloads and persists their revocation metadata", async () => {
    const requestBlobUrl = vi.fn(async () => "blob:test");
    const downloadByUrl = vi.fn(async () => 33);
    const persistBlobDownload = vi.fn(async () => undefined);

    const downloadId = await downloadExportWithFallback("session.json", "{}", "application/json", {
      requestBlobUrl,
      downloadByUrl,
      persistBlobDownload,
      revokeBlobUrl: vi.fn(async () => undefined),
      toDataUrl: vi.fn(() => "data:test"),
    });

    expect(downloadId).toBe(33);
    expect(downloadByUrl).toHaveBeenCalledWith("blob:test", "session.json");
    expect(persistBlobDownload).toHaveBeenCalledWith(33, "blob:test");
  });

  it("falls back to a data URL when blob export fails", async () => {
    const downloadByUrl = vi.fn(async () => 34);
    downloadByUrl.mockRejectedValueOnce(new Error("blob download failed"));
    const revokeBlobUrl = vi.fn(async () => undefined);
    const onBlobFallbackError = vi.fn();

    const downloadId = await downloadExportWithFallback("session.json", "{}", "application/json", {
      requestBlobUrl: vi.fn(async () => "blob:test"),
      downloadByUrl,
      persistBlobDownload: vi.fn(async () => undefined),
      revokeBlobUrl,
      toDataUrl: vi.fn(() => "data:application/json;base64,e30="),
      onBlobFallbackError,
    });

    expect(downloadId).toBe(34);
    expect(revokeBlobUrl).toHaveBeenCalledWith("blob:test");
    expect(onBlobFallbackError).toHaveBeenCalled();
    expect(downloadByUrl).toHaveBeenLastCalledWith(
      "data:application/json;base64,e30=",
      "session.json",
    );
  });

  it("does not retry the download when blob metadata persistence fails after download succeeds", async () => {
    const requestBlobUrl = vi.fn(async () => "blob:test");
    const downloadByUrl = vi.fn(async () => 35);
    const persistBlobDownload = vi.fn(async () => {
      throw new Error("persist failed");
    });
    const toDataUrl = vi.fn(() => "data:test");

    const downloadId = await downloadExportWithFallback("session.json", "{}", "application/json", {
      requestBlobUrl,
      downloadByUrl,
      persistBlobDownload,
      revokeBlobUrl: vi.fn(async () => undefined),
      toDataUrl,
      onBlobFallbackError: vi.fn(),
    });

    expect(downloadId).toBe(35);
    expect(downloadByUrl).toHaveBeenCalledTimes(1);
    expect(downloadByUrl).toHaveBeenCalledWith("blob:test", "session.json");
    expect(toDataUrl).not.toHaveBeenCalled();
  });

  it("accepts the known background command payload union", () => {
    const commands: BackgroundCommandMessage[] = [
      { type: "OPEN_HISTORY_PAGE" },
      { type: "OPEN_OPTIONS_PAGE" },
      { type: "OPEN_DIAGNOSTICS_PAGE", tabId: 5 },
      { type: "QUEUE_EXIT_PERSIST_RECORD", record: buildSession("stopped") },
      { type: "DELETE_SESSION_RECORD", sessionId: "session_1" },
      {
        type: "DOWNLOAD_REQUEST",
        filename: "session.json",
        content: "{}",
        mimeType: "application/json",
      },
    ];

    expect(commands.every((command) => isBackgroundCommandMessage(command))).toBe(true);
  });

  it("rejects commands from senders whose extension id does not match this extension", async () => {
    const dependencies = createDependencies();
    const originalRuntime = (globalThis as { chrome?: typeof chrome }).chrome?.runtime;
    (globalThis as { chrome?: { runtime?: { id?: string } } }).chrome = {
      runtime: { id: "expected-extension-id" },
    } as unknown as typeof chrome;

    try {
      const response = await handleBackgroundCommand(
        { type: "OPEN_HISTORY_PAGE" } as BackgroundCommandMessage,
        { id: "some-other-extension" },
        dependencies,
      );

      expect(response).toEqual({ ok: false, error: "외부 발신자의 명령을 거부했습니다." });
      expect(dependencies.openHistoryPage).not.toHaveBeenCalled();
    } finally {
      if (originalRuntime) {
        (globalThis as { chrome?: { runtime?: typeof chrome.runtime } }).chrome = {
          runtime: originalRuntime,
        } as unknown as typeof chrome;
      } else {
        delete (globalThis as { chrome?: unknown }).chrome;
      }
    }
  });
});
