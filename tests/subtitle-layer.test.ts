import { describe, expect, it, vi } from "vitest";

import {
  readSubtitleLayerState,
  tryDomSubtitleActivation,
  waitForSubtitleLayer,
} from "../src/content/subtitle-layer";

function attachVisibleRect(element: HTMLElement, width = 240, height = 42): void {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () =>
      ({
        width,
        height,
        top: 0,
        left: 0,
        bottom: height,
        right: width,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) satisfies DOMRect,
  });
}

function mountLayer(options: { visible?: boolean; text?: string } = {}): void {
  document.body.innerHTML = `
    <div id="viewSubtit" style="display:${options.visible ? "block" : "none"}">
      <div class="incont">${options.text ?? ""}</div>
    </div>
  `;
  const layer = document.querySelector<HTMLElement>("#viewSubtit");
  if (layer) {
    attachVisibleRect(layer, 360, 56);
  }
}

describe("subtitle layer helpers", () => {
  it("reads the current subtitle layer state", () => {
    mountLayer({ visible: true, text: "실시간 자막입니다." });

    expect(readSubtitleLayerState()).toEqual({
      found: true,
      visible: true,
      hasText: true,
      controlActive: false,
      text: "실시간 자막입니다.",
    });
  });

  it("clicks the visible subtitle activation control", () => {
    mountLayer();
    const button = document.createElement("button");
    button.className = "btn_subtit_ai";
    button.textContent = "AI 자막보기";
    attachVisibleRect(button, 88, 32);
    button.addEventListener("click", () => {
      const layer = document.querySelector<HTMLElement>("#viewSubtit");
      if (layer) {
        layer.style.display = "block";
      }
    });
    document.body.append(button);

    const result = tryDomSubtitleActivation();

    expect(result).toEqual({
      attempted: true,
      method: "button-click",
      controlSelector: ".btn_subtit_ai",
    });
    expect(readSubtitleLayerState().visible).toBe(true);
  });

  it("falls back to forcing the layer visible when no button exists", () => {
    mountLayer();

    const result = tryDomSubtitleActivation();

    expect(result).toEqual({
      attempted: true,
      method: "layer-style",
    });
    expect(readSubtitleLayerState().visible).toBe(true);
  });

  it("reports an active activation control and treats it as a successful visible state", async () => {
    vi.useFakeTimers();
    mountLayer({ visible: true });

    const button = document.createElement("button");
    button.className = "btn_subtit_ai on";
    button.textContent = "AI 자막보기";
    attachVisibleRect(button, 88, 32);
    document.body.append(button);

    expect(readSubtitleLayerState()).toEqual({
      found: true,
      visible: true,
      hasText: false,
      controlActive: true,
      text: "",
    });

    const pending = waitForSubtitleLayer({ timeoutMs: 1000, intervalMs: 60 });
    await vi.advanceTimersByTimeAsync(60);

    await expect(pending).resolves.toMatchObject({
      visible: true,
      controlActive: true,
    });
    vi.useRealTimers();
  });

  it("waits until the subtitle layer becomes visible", async () => {
    vi.useFakeTimers();
    mountLayer();

    window.setTimeout(() => {
      const layer = document.querySelector<HTMLElement>("#viewSubtit");
      if (layer) {
        layer.style.display = "block";
      }
      const textContainer = document.querySelector<HTMLElement>("#viewSubtit .incont");
      if (textContainer) {
        textContainer.textContent = "실시간 자막입니다.";
      }
    }, 180);

    const pending = waitForSubtitleLayer({ timeoutMs: 1000, intervalMs: 60 });
    await vi.advanceTimersByTimeAsync(240);

    await expect(pending).resolves.toMatchObject({
      visible: true,
    });
    vi.useRealTimers();
  });

  it("does not treat visible-only empty layers as activation success", async () => {
    vi.useFakeTimers();
    mountLayer({ visible: true });

    const pending = waitForSubtitleLayer({ timeoutMs: 240, intervalMs: 60 });
    await vi.advanceTimersByTimeAsync(300);

    await expect(pending).resolves.toMatchObject({
      visible: true,
      hasText: false,
      controlActive: false,
    });
    vi.useRealTimers();
  });
});
