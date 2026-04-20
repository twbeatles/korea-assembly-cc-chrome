import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addTabActivatedListener,
  addTabRemovedListener,
  addTabUpdatedListener,
  connectToTab,
  createTab,
  getTab,
  openOptionsPage,
  queryActiveTab,
  queryTabs,
  removeTabActivatedListener,
  removeTabRemovedListener,
  removeTabUpdatedListener,
  sendRuntimeMessage,
  sendTabMessage,
} from "../src/shared/chrome-api";

describe("chrome api helpers", () => {
  const originalChrome = globalThis.chrome;

  const runtimeOnMessage = {
    addListener: vi.fn(),
    removeListener: vi.fn(),
  };
  const tabsOnActivated = {
    addListener: vi.fn(),
    removeListener: vi.fn(),
  };
  const tabsOnUpdated = {
    addListener: vi.fn(),
    removeListener: vi.fn(),
  };
  const tabsOnRemoved = {
    addListener: vi.fn(),
    removeListener: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: {
        runtime: {
          lastError: undefined,
          sendMessage: vi.fn((_message, callback) => callback({ ok: true })),
          openOptionsPage: vi.fn((callback) => callback()),
          onMessage: runtimeOnMessage,
        },
        tabs: {
          sendMessage: vi.fn((_tabId, _message, callback) => callback({ ok: true })),
          query: vi.fn((queryInfo, callback) => {
            if (queryInfo.active) {
              callback([{ id: 7, url: "https://assembly.webcast.go.kr/main/player.asp" }]);
              return;
            }
            callback([{ id: 7, url: "https://assembly.webcast.go.kr/main/player.asp" }]);
          }),
          get: vi.fn((_tabId, callback) =>
            callback({ id: 7, url: "https://assembly.webcast.go.kr/main/player.asp" }),
          ),
          connect: vi.fn(() => ({ name: "assembly-subtitle-popup" })),
          create: vi.fn(({ url }, callback) => callback({ id: 8, url })),
          onActivated: tabsOnActivated,
          onUpdated: tabsOnUpdated,
          onRemoved: tabsOnRemoved,
        },
      },
    });
  });

  afterAll(() => {
    if (typeof originalChrome === "undefined") {
      delete (globalThis as { chrome?: typeof chrome }).chrome;
      return;
    }

    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: originalChrome,
    });
  });

  it("wraps callback-based runtime and tab APIs in promises", async () => {
    await expect(sendRuntimeMessage({ type: "OPEN_HISTORY_PAGE" })).resolves.toEqual({ ok: true });
    await expect(sendTabMessage(7, { type: "PING" })).resolves.toEqual({ ok: true });
    await expect(queryActiveTab()).resolves.toMatchObject({ id: 7 });
    await expect(queryTabs({ currentWindow: true })).resolves.toHaveLength(1);
    await expect(getTab(7)).resolves.toMatchObject({ id: 7 });
    await expect(createTab("https://example.com")).resolves.toMatchObject({
      id: 8,
      url: "https://example.com",
    });
    await expect(openOptionsPage()).resolves.toBeUndefined();
    expect(connectToTab(7, 0, "assembly-subtitle-popup")).toMatchObject({
      name: "assembly-subtitle-popup",
    });
  });

  it("registers and unregisters tab event listeners through explicit wrappers", () => {
    const activatedListener = vi.fn();
    const updatedListener = vi.fn();
    const removedListener = vi.fn();

    addTabActivatedListener(activatedListener);
    addTabUpdatedListener(updatedListener);
    addTabRemovedListener(removedListener);
    removeTabActivatedListener(activatedListener);
    removeTabUpdatedListener(updatedListener);
    removeTabRemovedListener(removedListener);

    expect(tabsOnActivated.addListener).toHaveBeenCalledWith(activatedListener);
    expect(tabsOnUpdated.addListener).toHaveBeenCalledWith(updatedListener);
    expect(tabsOnRemoved.addListener).toHaveBeenCalledWith(removedListener);
    expect(tabsOnActivated.removeListener).toHaveBeenCalledWith(activatedListener);
    expect(tabsOnUpdated.removeListener).toHaveBeenCalledWith(updatedListener);
    expect(tabsOnRemoved.removeListener).toHaveBeenCalledWith(removedListener);
  });
});
