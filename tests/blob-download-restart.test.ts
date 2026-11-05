import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storageKey = "assembly-subtitle-download-blob-urls";
function chromeFixture() {
  let onChanged!: (delta: chrome.downloads.DownloadDelta) => void;
  let onMessage!: (
    message: unknown,
    sender: unknown,
    reply: (value: unknown) => void,
  ) => boolean;
  const data: Record<string, unknown> = {};
  const sendMessage = vi.fn((message, reply) =>
    reply(
      message.type === "OFFSCREEN_CREATE_BLOB_URL"
        ? { ok: true, url: "blob:new-export" }
        : { ok: true },
    ),
  );
  vi.stubGlobal("chrome", {
    runtime: {
      id: "fixture",
      getURL: (path: string) => `chrome-extension://fixture/${path}`,
      getContexts: vi.fn(async () => [{ contextType: "OFFSCREEN_DOCUMENT" }]),
      sendMessage,
      onMessage: {
        addListener: (listener: typeof onMessage) => {
          onMessage = listener;
        },
      },
      onStartup: { addListener: vi.fn() },
      onInstalled: { addListener: vi.fn() },
    },
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({
          [key]: structuredClone(data[key]),
        })),
        set: vi.fn(async (values: Record<string, unknown>) => {
          Object.assign(data, structuredClone(values));
        }),
      },
    },
    offscreen: { createDocument: vi.fn() },
    tabs: {
      onRemoved: { addListener: vi.fn() },
      onUpdated: { addListener: vi.fn() },
    },
    downloads: {
      onChanged: {
        addListener: (listener: typeof onChanged) => {
          onChanged = listener;
        },
      },
      search: vi.fn((_query, reply) => reply([{ id: 7, state: "complete" }])),
      download: vi.fn((_options, reply) => {
        onChanged({ id: 7, state: { current: "complete" } });
        reply(7);
      }),
    },
  });
  return {
    data,
    sendMessage,
    changed: (delta: chrome.downloads.DownloadDelta) => onChanged(delta),
    request: (message: unknown) =>
      new Promise((resolve) => onMessage(message, { id: "fixture" }, resolve)),
  };
}

beforeEach(() => vi.resetModules());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("offscreen Blob downloads across service worker lifetimes", () => {
  it("revokes a persisted Blob when completion wakes a new service worker", async () => {
    const fixture = chromeFixture();
    fixture.data[storageKey] = { 7: "blob:previous-worker" };
    await import("../src/background/service-worker");
    fixture.changed({ id: 7, state: { current: "complete" } });
    await vi.waitFor(() =>
      expect(fixture.sendMessage).toHaveBeenCalledWith(
        { type: "OFFSCREEN_REVOKE_BLOB_URL", url: "blob:previous-worker" },
        expect.any(Function),
      ),
    );
    await vi.waitFor(() => expect(fixture.data[storageKey]).toEqual({}));
  });

  it("cleans a download that completed before its start callback", async () => {
    const fixture = chromeFixture();
    await import("../src/background/service-worker");
    expect(
      await fixture.request({
        type: "DOWNLOAD_REQUEST",
        filename: "test.txt",
        content: "fixture",
        mimeType: "text/plain",
      }),
    ).toMatchObject({ ok: true, downloadId: 7 });
    await vi.waitFor(() =>
      expect(fixture.sendMessage).toHaveBeenCalledWith(
        { type: "OFFSCREEN_REVOKE_BLOB_URL", url: "blob:new-export" },
        expect.any(Function),
      ),
    );
  });
});
