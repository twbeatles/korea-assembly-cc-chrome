import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_REVOKE_TIMEOUT_MS,
  downloadPageBlobExport,
} from "../src/history/page-blob-download";

describe("page blob download helper", () => {
  it("downloads a page-created blob URL and revokes it when the download completes", async () => {
    const listeners: Array<(delta: chrome.downloads.DownloadDelta) => void> = [];
    const chromeDownloads = {
      download: vi.fn(
        (
          _options: chrome.downloads.DownloadOptions,
          callback?: (downloadId?: number) => void,
        ) => callback?.(7),
      ),
      onChanged: {
        addListener: vi.fn((listener) => listeners.push(listener)),
        removeListener: vi.fn((listener) => {
          const index = listeners.indexOf(listener);
          if (index >= 0) {
            listeners.splice(index, 1);
          }
        }),
      },
    } as unknown as typeof chrome.downloads;
    const revokeObjectUrl = vi.fn();
    const setTimeoutFn = vi.fn(() => 1);
    const clearTimeoutFn = vi.fn();

    const downloadId = await downloadPageBlobExport(
      {
        filename: "backup.json",
        mimeType: "application/json;charset=utf-8",
        content: "{}",
      },
      {
        createObjectUrl: () => "blob:backup",
        revokeObjectUrl,
        chromeDownloads,
        chromeRuntime: {} as typeof chrome.runtime,
        setTimeoutFn,
        clearTimeoutFn,
      },
    );

    expect(downloadId).toBe(7);
    expect(chromeDownloads.download).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "blob:backup",
        filename: "backup.json",
      }),
      expect.any(Function),
    );
    // 시작 직후에는 revoke 하지 않고 안전망 타이머만 건다.
    expect(revokeObjectUrl).not.toHaveBeenCalled();
    expect(setTimeoutFn).toHaveBeenCalledWith(
      expect.any(Function),
      DEFAULT_REVOKE_TIMEOUT_MS,
    );

    listeners[0]?.({
      id: 7,
      state: {
        current: "complete",
      },
    } as chrome.downloads.DownloadDelta);

    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:backup");
    expect(listeners).toHaveLength(0);
  });

  it("does not revoke on in-progress download state updates", async () => {
    const listeners: Array<(delta: chrome.downloads.DownloadDelta) => void> = [];
    const chromeDownloads = {
      download: vi.fn(
        (
          _options: chrome.downloads.DownloadOptions,
          callback?: (downloadId?: number) => void,
        ) => callback?.(9),
      ),
      onChanged: {
        addListener: vi.fn((listener) => listeners.push(listener)),
        removeListener: vi.fn(),
      },
    } as unknown as typeof chrome.downloads;
    const revokeObjectUrl = vi.fn();

    await downloadPageBlobExport(
      {
        filename: "large.json",
        mimeType: "application/json;charset=utf-8",
        content: "{}",
      },
      {
        createObjectUrl: () => "blob:large",
        revokeObjectUrl,
        chromeDownloads,
        chromeRuntime: {} as typeof chrome.runtime,
        setTimeoutFn: vi.fn(() => 1),
        clearTimeoutFn: vi.fn(),
      },
    );

    listeners[0]?.({
      id: 9,
      state: { current: "in_progress" },
    } as chrome.downloads.DownloadDelta);

    expect(revokeObjectUrl).not.toHaveBeenCalled();
  });
});
