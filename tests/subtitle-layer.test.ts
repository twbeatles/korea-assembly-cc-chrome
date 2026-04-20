import { describe, expect, it, vi } from "vitest";

import {
  readSubtitleLayerState,
  tryDomSubtitleActivation,
  waitForSubtitleLayer,
} from "../src/content/subtitle-layer";

function mockVisibleRects(element: HTMLElement): void {
  Object.defineProperty(element, "getClientRects", {
    configurable: true,
    value: () => [
      {
        width: 120,
        height: 24,
        top: 0,
        left: 0,
        right: 120,
        bottom: 24,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      },
    ],
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
    mockVisibleRects(layer);
  }
}

function mountFrameDocument(): Document {
  const frame = document.createElement("iframe");
  const frameDoc = document.implementation.createHTMLDocument("frame");
  Object.defineProperty(frame, "contentDocument", {
    configurable: true,
    value: frameDoc,
  });
  document.body.append(frame);
  return frameDoc;
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
    mockVisibleRects(button);
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
    mockVisibleRects(button);
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

  it("treats opacity zero layers as hidden even when layout rects exist", () => {
    mountLayer({ visible: true, text: "숨겨진 자막" });
    const layer = document.querySelector<HTMLElement>("#viewSubtit");
    expect(layer).not.toBeNull();
    layer!.style.opacity = "0";

    expect(readSubtitleLayerState()).toMatchObject({
      found: true,
      visible: false,
      hasText: true,
    });
  });

  it("aggregates visible subtitle layers that exist only inside an accessible iframe", () => {
    document.body.innerHTML = "";
    const frameDoc = mountFrameDocument();
    frameDoc.body.innerHTML = `
      <div id="viewSubtit" style="display:block">
        <div class="incont">iframe 안 자막</div>
      </div>
    `;
    const layer = frameDoc.querySelector<HTMLElement>("#viewSubtit");
    expect(layer).not.toBeNull();
    mockVisibleRects(layer!);

    expect(readSubtitleLayerState()).toEqual({
      found: true,
      visible: true,
      hasText: true,
      controlActive: false,
      text: "iframe 안 자막",
    });
  });

  it("clicks a top-frame activation control even when the subtitle layer lives in a child iframe", () => {
    document.body.innerHTML = "";
    const frameDoc = mountFrameDocument();
    frameDoc.body.innerHTML = `
      <div id="viewSubtit" style="display:none">
        <div class="incont">child frame subtitle</div>
      </div>
    `;
    const childLayer = frameDoc.querySelector<HTMLElement>("#viewSubtit");
    expect(childLayer).not.toBeNull();
    mockVisibleRects(childLayer!);

    const button = document.createElement("button");
    button.className = "btn_subtit_ai";
    button.textContent = "AI 자막보기";
    mockVisibleRects(button);
    button.addEventListener("click", () => {
      childLayer!.style.display = "block";
    });
    document.body.append(button);

    const result = tryDomSubtitleActivation();

    expect(result).toEqual({
      attempted: true,
      method: "button-click",
      controlSelector: ".btn_subtit_ai",
    });
    expect(readSubtitleLayerState()).toMatchObject({
      visible: true,
      hasText: true,
      text: "child frame subtitle",
    });
  });

  it("waits for a subtitle layer that becomes visible inside a frame just before timeout", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    const frameDoc = mountFrameDocument();
    frameDoc.body.innerHTML = `
      <div id="viewSubtit" style="display:none">
        <div class="incont"></div>
      </div>
    `;
    const layer = frameDoc.querySelector<HTMLElement>("#viewSubtit");
    const textContainer = frameDoc.querySelector<HTMLElement>("#viewSubtit .incont");
    expect(layer).not.toBeNull();
    mockVisibleRects(layer!);

    window.setTimeout(() => {
      layer!.style.display = "block";
      textContainer!.textContent = "timeout 직전 자막";
    }, 180);

    const pending = waitForSubtitleLayer({ timeoutMs: 240, intervalMs: 60 });
    await vi.advanceTimersByTimeAsync(240);

    await expect(pending).resolves.toMatchObject({
      visible: true,
      hasText: true,
      text: "timeout 직전 자막",
    });
    vi.useRealTimers();
  });
});
