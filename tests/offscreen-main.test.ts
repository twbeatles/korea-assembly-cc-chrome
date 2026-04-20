import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("offscreen main", () => {
  const originalChrome = globalThis.chrome;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(() => {
    vi.resetModules();

    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:test"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterAll(() => {
    if (typeof originalChrome === "undefined") {
      delete (globalThis as { chrome?: typeof chrome }).chrome;
    } else {
      Object.defineProperty(globalThis, "chrome", {
        configurable: true,
        value: originalChrome,
      });
    }

    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: originalCreateObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: originalRevokeObjectURL,
    });
  });

  it("registers an offscreen message listener that creates and revokes blob URLs", async () => {
    let listener:
      | ((
          message: unknown,
          sender: chrome.runtime.MessageSender,
          sendResponse: (response: unknown) => void,
        ) => unknown)
      | undefined;

    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: {
        runtime: {
          onMessage: {
            addListener: vi.fn((nextListener) => {
              listener = nextListener;
            }),
          },
        },
      },
    });

    await import("../src/offscreen/main");

    const createResponse = vi.fn();
    const revokeResponse = vi.fn();
    listener?.(
      {
        type: "OFFSCREEN_CREATE_BLOB_URL",
        content: "{}",
        mimeType: "application/json",
      },
      {},
      createResponse,
    );
    listener?.(
      {
        type: "OFFSCREEN_REVOKE_BLOB_URL",
        url: "blob:test",
      },
      {},
      revokeResponse,
    );

    expect(createResponse).toHaveBeenCalledWith({
      ok: true,
      url: "blob:test",
    });
    expect(revokeResponse).toHaveBeenCalledWith({ ok: true });
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test");
  });
});
