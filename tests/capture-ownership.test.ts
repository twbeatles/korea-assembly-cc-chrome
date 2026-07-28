import { describe, expect, it } from "vitest";

import {
  CAPTURE_OWNERSHIP_STORAGE_KEY,
  claimCaptureOwnership,
  isForeignActiveOwnership,
  releaseCaptureOwnership,
  type CaptureOwnershipStorage,
} from "../src/content/runtime/capture-ownership";

function createMemoryStorage(
  initial: Record<string, unknown> = {},
): CaptureOwnershipStorage & { data: Record<string, unknown> } {
  const data = { ...initial };
  return {
    data,
    get: async (keys) => {
      if (keys == null) {
        return { ...data };
      }
      const list = Array.isArray(keys) ? keys : [keys];
      const result: Record<string, unknown> = {};
      list.forEach((key) => {
        if (key in data) {
          result[key] = data[key];
        }
      });
      return result;
    },
    set: async (items) => {
      Object.assign(data, items);
    },
    remove: async (keys) => {
      const list = Array.isArray(keys) ? keys : [keys];
      list.forEach((key) => {
        delete data[key];
      });
    },
  };
}

describe("capture ownership", () => {
  it("detects foreign active ownership within the stale window", () => {
    const now = 1_000_000;
    expect(
      isForeignActiveOwnership(
        { ownerId: "other", updatedAt: now - 5_000 },
        "me",
        now,
      ),
    ).toBe(true);
    expect(
      isForeignActiveOwnership(
        { ownerId: "other", updatedAt: now - 60_000 },
        "me",
        now,
      ),
    ).toBe(false);
    expect(
      isForeignActiveOwnership({ ownerId: "me", updatedAt: now }, "me", now),
    ).toBe(false);
  });

  it("claims ownership and reports foreign active owners", async () => {
    const storage = createMemoryStorage({
      [CAPTURE_OWNERSHIP_STORAGE_KEY]: {
        ownerId: "tab-a",
        updatedAt: Date.now(),
      },
    });

    const claim = await claimCaptureOwnership({
      storage,
      ownerId: "tab-b",
      committeeName: "정무위",
    });

    expect(claim.foreignActive).toBe(true);
    expect(storage.data[CAPTURE_OWNERSHIP_STORAGE_KEY]).toEqual(
      expect.objectContaining({ ownerId: "tab-b", committeeName: "정무위" }),
    );
  });

  it("releases ownership only for the current owner", async () => {
    const storage = createMemoryStorage({
      [CAPTURE_OWNERSHIP_STORAGE_KEY]: {
        ownerId: "tab-a",
        updatedAt: Date.now(),
      },
    });

    await releaseCaptureOwnership({ storage, ownerId: "tab-b" });
    expect(storage.data[CAPTURE_OWNERSHIP_STORAGE_KEY]).toBeDefined();

    await releaseCaptureOwnership({ storage, ownerId: "tab-a" });
    expect(storage.data[CAPTURE_OWNERSHIP_STORAGE_KEY]).toBeUndefined();
  });

  it("tolerates missing storage", async () => {
    const claim = await claimCaptureOwnership({
      storage: null,
      ownerId: "tab-a",
    });
    expect(claim.foreignActive).toBe(false);
    await expect(
      releaseCaptureOwnership({ storage: null, ownerId: "tab-a" }),
    ).resolves.toBeUndefined();
  });
});
