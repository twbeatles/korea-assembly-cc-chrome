import { describe, expect, it, vi } from "vitest";

import {
  clearPersistedFrameForwardNonce,
  getFrameForwardNonceStorageKey,
  getOrCreatePersistedFrameForwardNonce,
  readPersistedFrameForwardNonce,
  rotatePersistedFrameForwardNonce,
} from "../src/background/frame-forward-nonce-store";

function createStorage(initial: Record<string, unknown> = {}) {
  const snapshot = { ...initial };
  return {
    snapshot,
    storage: {
      get: vi.fn(async (keys?: string | string[] | null) => {
        if (typeof keys === "string") {
          return { [keys]: snapshot[keys] };
        }
        return { ...snapshot };
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(snapshot, items);
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        const normalized = Array.isArray(keys) ? keys : [keys];
        normalized.forEach((key) => {
          delete snapshot[key];
        });
      }),
    },
  };
}

describe("frame forward nonce store", () => {
  it("reuses a persisted nonce when cache is empty", async () => {
    const tabId = 14;
    const storageKey = getFrameForwardNonceStorageKey(tabId);
    const { storage } = createStorage({
      [storageKey]: "persisted-nonce",
    });
    const cache = new Map<number, string>();

    const nonce = await getOrCreatePersistedFrameForwardNonce({
      tabId,
      cache,
      storage,
      createNonce: () => "generated-nonce",
    });

    expect(nonce).toBe("persisted-nonce");
    expect(cache.get(tabId)).toBe("persisted-nonce");
    expect(storage.set).not.toHaveBeenCalled();
    await expect(readPersistedFrameForwardNonce(storage, tabId)).resolves.toBe("persisted-nonce");
  });

  it("rotates and clears stored nonces for a tab", async () => {
    const tabId = 28;
    const { storage, snapshot } = createStorage();
    const cache = new Map<number, string>();

    const rotated = await rotatePersistedFrameForwardNonce({
      tabId,
      cache,
      storage,
      createNonce: () => "rotated-nonce",
    });

    expect(rotated).toBe("rotated-nonce");
    expect(snapshot[getFrameForwardNonceStorageKey(tabId)]).toBe("rotated-nonce");

    await clearPersistedFrameForwardNonce({
      tabId,
      cache,
      storage,
    });

    expect(cache.has(tabId)).toBe(false);
    expect(snapshot[getFrameForwardNonceStorageKey(tabId)]).toBeUndefined();
  });
});
