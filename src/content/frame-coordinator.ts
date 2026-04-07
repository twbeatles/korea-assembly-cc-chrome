import { FRAME_FORWARD_SOURCE, OBSERVER_BRIDGE_SOURCE } from "../shared/constants";
import type {
  FrameForwardMessage,
  ObserverBridgeEvent,
} from "../shared/message-types";

export function forwardFrameEvent(
  event: ObserverBridgeEvent,
  options: {
    isTopFrame: boolean;
    frameForwardNonce: string;
    handleTopFrameEvent: (event: ObserverBridgeEvent) => void;
  },
): void {
  if (options.isTopFrame) {
    options.handleTopFrameEvent(event);
    return;
  }

  if (!options.frameForwardNonce) {
    return;
  }

  const payload: FrameForwardMessage = {
    source: FRAME_FORWARD_SOURCE,
    nonce: options.frameForwardNonce,
    event,
  };
  window.top?.postMessage(payload, "*");
}

export function isObserverBridgeEventMessage(
  data: Partial<ObserverBridgeEvent>,
): data is ObserverBridgeEvent {
  return (
    typeof data.source === "string" &&
    data.source === OBSERVER_BRIDGE_SOURCE &&
    typeof data.token === "string" &&
    typeof data.kind === "string" &&
    typeof data.timestamp === "number" &&
    typeof data.sourceUrl === "string"
  );
}

export function isForwardedFrameMessage(
  data: Partial<FrameForwardMessage>,
): data is FrameForwardMessage {
  return (
    typeof data.source === "string" &&
    data.source === FRAME_FORWARD_SOURCE &&
    typeof data.nonce === "string" &&
    typeof data.event === "object" &&
    data.event !== null &&
    isObserverBridgeEventMessage(data.event)
  );
}

export function resolveForwardedFrameNonceAction(
  expectedNonce: string,
  incomingNonce: string,
): "accept" | "resync" {
  return expectedNonce && expectedNonce === incomingNonce ? "accept" : "resync";
}

export function resolveTopFallbackDelayMs(
  missStreak: number,
  pollingFallbackIntervalMs: number,
): number {
  const baseDelayMs = Math.max(200, pollingFallbackIntervalMs);
  if (missStreak <= 0) {
    return baseDelayMs;
  }
  if (missStreak <= 2) {
    return Math.max(baseDelayMs, 500);
  }
  return Math.max(baseDelayMs, 1000);
}
