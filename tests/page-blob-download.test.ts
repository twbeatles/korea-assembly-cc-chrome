import { describe, expect, it, vi } from "vitest";

import { downloadPageBlobExport } from "../src/history/page-blob-download";

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
        setTimeoutFn: vi.fn(() => 1),
        clearTimeoutFn: vi.fn(),
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

    listeners[0]?.({
      id: 7,
      state: {
        current: "complete",
      },
    } as chrome.downloads.DownloadDelta);

    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:backup");
    expect(listeners).toHaveLength(0);
  });
});
