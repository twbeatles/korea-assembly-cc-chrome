import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OBSERVER_BRIDGE_SOURCE,
  OBSERVER_CONFIG_EVENT,
  OBSERVER_STOP_EVENT,
} from "../src/shared/constants";

type BridgeWindow = Window & { __assemblySubtitleObserverBridge?: unknown };

describe("injected observer token bridge", () => {
  const listeners: Array<[string, EventListenerOrEventListenerObject]> = [];
  let postMessage: import("vitest").MockInstance<typeof window.postMessage>;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    document.body.innerHTML = `<div id="viewSubtit"><div class="smi_word row_1"><span>첫 자막</span></div></div>`;
    // resetModules does not remove window listeners: isolate each imported bridge.
    const add = window.addEventListener.bind(window);
    vi.spyOn(window, "addEventListener").mockImplementation(
      (type, listener, options) => {
        listeners.push([type, listener]);
        add(type, listener, options);
      },
    );
    postMessage = vi.spyOn(window, "postMessage").mockImplementation(() => {});
    await import("../src/content/injected-observer");
  });

  afterEach(() => {
    window.dispatchEvent(new CustomEvent(OBSERVER_STOP_EVENT));
    for (const [type, listener] of listeners.splice(0))
      window.removeEventListener(type, listener);
    delete (window as BridgeWindow).__assemblySubtitleObserverBridge;
    document.body.innerHTML = "";
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function configure(token = "bridge-token-test") {
    window.dispatchEvent(
      new CustomEvent(OBSERVER_CONFIG_EVENT, {
        detail: {
          selectors: ["#viewSubtit .smi_word"],
          pollingIntervalMs: 100,
          filterUnconfirmedEnabled: true,
          token,
        },
      }),
    );
  }

  function events(kind?: string) {
    return postMessage.mock.calls
      .map(([payload]) => payload)
      .filter(
        (payload) =>
          payload.source === OBSERVER_BRIDGE_SOURCE &&
          (!kind || payload.kind === kind),
      );
  }

  async function flushMutations() {
    // Deliver native MutationObserver callbacks without advancing polling timers.
    await Promise.resolve();
    await Promise.resolve();
  }

  it("emits actual subtitle rows with the configured token and origin", () => {
    configure();
    expect(events("subtitle:update")).toEqual([
      expect.objectContaining({
        token: "bridge-token-test",
        raw: "첫 자막",
        observerActive: true,
        rows: [expect.objectContaining({ text: "첫 자막" })],
      }),
    ]);
    expect(postMessage).toHaveBeenCalledWith(
      expect.any(Object),
      window.location.origin,
    );
  });

  it("stays silent before configuration after mutations and timer ticks", async () => {
    document.querySelector("span")!.textContent = "설정 전 자막";
    await flushMutations();
    await vi.advanceTimersByTimeAsync(4000);
    expect(events()).toEqual([]);
  });

  it("observes text changes, suppresses duplicates, and resets emptied subtitles", async () => {
    configure();
    postMessage.mockClear();
    const span = document.querySelector("span")!;
    span.firstChild!.textContent = "변경된 자막";
    await flushMutations();
    expect(events("subtitle:update")).toEqual([
      expect.objectContaining({ raw: "변경된 자막" }),
    ]);
    span.textContent = "변경된 자막";
    await flushMutations();
    expect(events("subtitle:update")).toHaveLength(1);
    document.getElementById("viewSubtit")!.replaceChildren();
    await flushMutations();
    expect(events("subtitle:reset")).toHaveLength(1);
    expect(events("subtitle:reset")[0].token).toBe("bridge-token-test");
  });

  it("reattaches when the page replaces the subtitle container", async () => {
    configure();
    document.getElementById("viewSubtit")!.outerHTML =
      `<div id="viewSubtit"><div class="smi_word row_2">교체 후 자막</div></div>`;
    await vi.advanceTimersByTimeAsync(2000);
    expect(events("subtitle:update").map((event) => event.raw)).toEqual([
      "첫 자막",
      "교체 후 자막",
    ]);
    document.querySelector(".smi_word")!.textContent = "재연결 후 변경";
    await flushMutations();
    expect(events("subtitle:update").at(-1)?.raw).toBe("재연결 후 변경");
  });

  it("emits speaker changes even when the subtitle text stays the same", async () => {
    const span = document.querySelector("span")!;
    span.style.color = "rgb(35, 124, 147)";
    configure();
    expect(events("subtitle:update")[0].rows[0]).toMatchObject({
      speakerChannel: "primary",
      speakerColor: "rgb(35, 124, 147)",
    });
    span.style.color = "rgb(30, 30, 30)";
    await flushMutations();
    expect(events("subtitle:update")).toHaveLength(2);
    expect(events("subtitle:update")[1].rows[0]).toMatchObject({
      text: "첫 자막",
      speakerChannel: "secondary",
      speakerColor: "rgb(30, 30, 30)",
    });
  });

  it("withholds an unconfirmed row until its highlight is removed", async () => {
    const span = document.querySelector("span")!;
    span.style.backgroundColor = "rgb(173, 216, 230)";
    configure();
    expect(events("subtitle:update")).toEqual([]);
    span.style.backgroundColor = "transparent";
    await flushMutations();
    expect(events("subtitle:update")).toEqual([
      expect.objectContaining({
        raw: "첫 자막",
        rows: [expect.objectContaining({ text: "첫 자막" })],
      }),
    ]);
  });

  it("rotates tokens without duplicate observers and stops observation and timers", async () => {
    configure();
    configure("new-token");
    postMessage.mockClear();
    document.querySelector("span")!.textContent = "토큰 갱신 후 자막";
    await flushMutations();
    expect(events("subtitle:update")).toEqual([
      expect.objectContaining({ token: "new-token", raw: "토큰 갱신 후 자막" }),
    ]);
    window.dispatchEvent(new CustomEvent(OBSERVER_STOP_EVENT));
    postMessage.mockClear();
    document.querySelector("span")!.textContent = "종료 후 자막";
    await flushMutations();
    await vi.advanceTimersByTimeAsync(6000);
    expect(events()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
