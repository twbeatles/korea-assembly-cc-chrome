import { describe, expect, it, vi } from "vitest";

import {
  handleFrameForwardNonceTabRemoved,
  handleFrameForwardNonceTabUpdated,
  shouldRotateFrameForwardNonce,
} from "../src/background/frame-forward-nonce-lifecycle";

describe("frame forward nonce lifecycle", () => {
  it("rotates nonce only while a tab is loading", async () => {
    const rotateNonce = vi.fn(async () => undefined);

    expect(shouldRotateFrameForwardNonce({ status: "loading" })).toBe(true);
    expect(shouldRotateFrameForwardNonce({ status: "complete" })).toBe(false);

    await handleFrameForwardNonceTabUpdated(14, { status: "complete" }, rotateNonce);
    expect(rotateNonce).not.toHaveBeenCalled();

    await handleFrameForwardNonceTabUpdated(14, { status: "loading" }, rotateNonce);
    expect(rotateNonce).toHaveBeenCalledWith(14);
  });

  it("clears persisted nonce state when a tab is removed", async () => {
    const clearNonce = vi.fn(async () => undefined);

    await handleFrameForwardNonceTabRemoved(28, clearNonce);

    expect(clearNonce).toHaveBeenCalledWith(28);
  });
});
