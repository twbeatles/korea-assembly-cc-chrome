import { afterEach, describe, expect, it, vi } from "vitest";

import {
  OBSERVER_BRIDGE_SOURCE,
  OBSERVER_CONFIG_EVENT,
  OBSERVER_STOP_EVENT,
} from "../src/shared/constants";

type BridgeWindow = Window & {
  __assemblySubtitleObserverBridge?: unknown;
};

describe("injected observer token bridge", () => {
  afterEach(() => {
    window.dispatchEvent(new CustomEvent(OBSERVER_STOP_EVENT));
    delete (window as BridgeWindow).__assemblySubtitleObserverBridge;
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("emits observer events with the configured token", async () => {
    vi.resetModules();

    document.body.innerHTML = `
      <div id="viewSubtit">
        <div class="smi_word row_1"><span>bridge token subtitle</span></div>
      </div>
    `;

    const postMessageSpy = vi.spyOn(window, "postMessage");
    await import("../src/content/injected-observer");

    const token = "bridge-token-test";
    window.dispatchEvent(
      new CustomEvent(OBSERVER_CONFIG_EVENT, {
        detail: {
          selectors: ["#viewSubtit .smi_word"],
          pollingIntervalMs: 2000,
          filterUnconfirmedEnabled: true,
          token,
        },
      }),
    );

    const hasTokenizedBridgeEvent = postMessageSpy.mock.calls.some(([payload]) => {
      const data = payload as {
        source?: string;
        kind?: string;
        token?: string;
      };
      return (
        data.source === OBSERVER_BRIDGE_SOURCE &&
        data.token === token
      );
    });

    expect(hasTokenizedBridgeEvent).toBe(true);
  });
});
