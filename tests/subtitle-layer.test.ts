import { describe, expect, it, vi } from "vitest";

import {
  readSubtitleLayerState,
  tryDomSubtitleActivation,
  waitForSubtitleLayer,
} from "../src/content/subtitle-layer";

function mountLayer(options: { visible?: boolean; text?: string } = {}): void {
  document.body.innerHTML = `
    <div id="viewSubtit" style="display:${options.visible ? "block" : "none"}">
      <div class="incont">${options.text ?? ""}</div>
    </div>
  `;
}

describe("subtitle layer helpers", () => {
  it("reads the current subtitle layer state", () => {
    mountLayer({ visible: true, text: "실시간 자막입니다." });

    expect(readSubtitleLayerState()).toEqual({
      found: true,
      visible: true,
      hasText: true,
      text: "실시간 자막입니다.",
    });
  });

  it("clicks the visible subtitle activation control", () => {
    mountLayer();
    const button = document.createElement("button");
    button.className = "btn_subtit_ai";
    button.textContent = "AI 자막보기";
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

  it("waits until the subtitle layer becomes visible", async () => {
    vi.useFakeTimers();
    mountLayer();

    window.setTimeout(() => {
      const layer = document.querySelector<HTMLElement>("#viewSubtit");
      if (layer) {
        layer.style.display = "block";
      }
    }, 180);

    const pending = waitForSubtitleLayer({ timeoutMs: 1000, intervalMs: 60 });
    await vi.advanceTimersByTimeAsync(240);

    await expect(pending).resolves.toMatchObject({
      visible: true,
    });
    vi.useRealTimers();
  });
});
