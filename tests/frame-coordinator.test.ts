import { describe, expect, it } from "vitest";

import {
  isForwardedFrameMessage,
  isObserverBridgeEventMessage,
  resolveForwardedFrameNonceAction,
  resolveTopFallbackDelayMs,
} from "../src/content/frame-coordinator";
import { FRAME_FORWARD_SOURCE, OBSERVER_BRIDGE_SOURCE } from "../src/shared/constants";

describe("frame coordinator", () => {
  it("accepts only matching forwarded frame nonces", () => {
    expect(resolveForwardedFrameNonceAction("nonce-a", "nonce-a")).toBe("accept");
    expect(resolveForwardedFrameNonceAction("nonce-a", "nonce-b")).toBe("resync");
    expect(resolveForwardedFrameNonceAction("", "nonce-b")).toBe("resync");
  });

  it("validates observer bridge event payload guards", () => {
    expect(
      isObserverBridgeEventMessage({
        source: OBSERVER_BRIDGE_SOURCE,
        token: "token",
        kind: "subtitle:update",
        timestamp: Date.now(),
        sourceUrl: "https://assembly.webcast.go.kr/main/player.asp",
      }),
    ).toBe(true);

    expect(
      isObserverBridgeEventMessage({
        source: OBSERVER_BRIDGE_SOURCE,
        kind: "subtitle:update",
        timestamp: Date.now(),
      }),
    ).toBe(false);
  });

  it("validates forwarded frame message guards", () => {
    expect(
      isForwardedFrameMessage({
        source: FRAME_FORWARD_SOURCE,
        nonce: "nonce-a",
        event: {
          source: OBSERVER_BRIDGE_SOURCE,
          token: "token",
          kind: "subtitle:update",
          timestamp: Date.now(),
          sourceUrl: "https://assembly.webcast.go.kr/main/player.asp",
        },
      }),
    ).toBe(true);

    expect(
      isForwardedFrameMessage({
        source: FRAME_FORWARD_SOURCE,
        nonce: "nonce-a",
      }),
    ).toBe(false);
  });

  it("backs off top fallback delay by miss streak", () => {
    expect(resolveTopFallbackDelayMs(0, 120)).toBe(200);
    expect(resolveTopFallbackDelayMs(1, 200)).toBe(500);
    expect(resolveTopFallbackDelayMs(3, 200)).toBe(1000);
  });
});
