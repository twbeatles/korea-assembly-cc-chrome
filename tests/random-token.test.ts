import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createPrefixedRandomToken,
  createRandomToken,
} from "../src/shared/random-token";

describe("random-token", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prefers crypto.randomUUID when available", () => {
    const fakeUuid = "11111111-2222-3333-4444-555555555555";
    vi.stubGlobal("crypto", {
      randomUUID: () => fakeUuid,
      getRandomValues: () => {
        throw new Error("getRandomValues should not be called when randomUUID exists");
      },
    });

    expect(createRandomToken()).toBe(fakeUuid);
    expect(createPrefixedRandomToken("entry")).toBe(`entry_${fakeUuid}`);
  });

  it("falls back to crypto.getRandomValues when randomUUID is missing", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (target: Uint8Array) => {
        target.fill(0xab);
        return target;
      },
    });

    const token = createRandomToken();
    expect(token).toMatch(/^[0-9a-f]+$/);
    expect(token.length).toBeGreaterThanOrEqual(32);
  });

  it("falls back to Date.now + Math.random when crypto is unavailable", () => {
    vi.stubGlobal("crypto", undefined);

    const token = createRandomToken();
    expect(token).toMatch(/^[0-9a-f]+_[0-9a-f]+$/);
  });
});
