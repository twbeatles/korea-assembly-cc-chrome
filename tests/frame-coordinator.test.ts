import { describe, expect, it } from "vitest";

import { resolveForwardedFrameNonceAction } from "../src/content/frame-coordinator";

describe("frame coordinator", () => {
  it("accepts only matching forwarded frame nonces", () => {
    expect(resolveForwardedFrameNonceAction("nonce-a", "nonce-a")).toBe("accept");
    expect(resolveForwardedFrameNonceAction("nonce-a", "nonce-b")).toBe("resync");
    expect(resolveForwardedFrameNonceAction("", "nonce-b")).toBe("resync");
  });
});
