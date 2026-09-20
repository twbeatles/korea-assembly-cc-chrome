import { normalizeFallbackInternalRaw } from "../fallback-preview";
import { isElementVisible } from "../visibility";

/** 자막 DOM 조회·가시성·활성화 (단일 책임: 페이지 DOM 접근). */
export function compactText(text: string): string {
  return String(text || "").replace(/\s+/g, "").trim();
}

export function queryOne(selector: string): HTMLElement | null {
  try {
    return document.querySelector<HTMLElement>(selector);
  } catch {
    return null;
  }
}

export function queryAll(selector: string): HTMLElement[] {
  try {
    return Array.from(document.querySelectorAll<HTMLElement>(selector));
  } catch {
    return [];
  }
}

export function isSubtitleLayerVisible(): boolean {
  const layer = queryOne("#viewSubtit");
  return isElementVisible(layer);
}

export function isActivationControlActive(node: HTMLElement): boolean {
  const className = String(node.className || "");
  const title = String(node.getAttribute("title") || "");
  const ariaPressed = String(node.getAttribute("aria-pressed") || "");
  return /\bon\b/.test(className) || /(끄기|닫기)/.test(title) || ariaPressed === "true";
}

export function clickActivationControl(selector: string): boolean {
  const button = queryOne(selector);
  if (!button || !isElementVisible(button) || isActivationControlActive(button)) {
    return false;
  }

  button.click();
  return true;
}

export function invokeActivationFunction<T extends unknown[]>(
  candidate: unknown,
  ...args: T
): boolean {
  if (typeof candidate !== "function") {
    return false;
  }

  try {
    candidate(...args);
    return true;
  } catch {
    return false;
  }
}

export function ensureSubtitleLayerVisible(): boolean {
  if (isSubtitleLayerVisible()) {
    return true;
  }

  // Each activation primitive is only credited if the layer becomes visible
  // afterwards. The page's own functions/buttons may exist with the same
  // identifier but unrelated semantics, so a successful invocation alone is
  // not enough — we require an observable effect on `#viewSubtit`.
  invokeActivationFunction(
    (window as Window & { smi_mode_act?: (value: number) => void }).smi_mode_act,
    1,
  );
  if (isSubtitleLayerVisible()) {
    return true;
  }

  invokeActivationFunction((window as Window & { smi_on?: () => void }).smi_on);
  if (isSubtitleLayerVisible()) {
    return true;
  }

  invokeActivationFunction(
    (window as Window & { layerSubtit?: () => void }).layerSubtit,
  );
  if (isSubtitleLayerVisible()) {
    return true;
  }

  if (clickActivationControl(".btn_subtit_ai") || clickActivationControl(".btn_subtit_def")) {
    return isSubtitleLayerVisible();
  }

  if (clickActivationControl(".btn_subtit") || clickActivationControl("#smi_btn")) {
    return isSubtitleLayerVisible();
  }

  // We deliberately do not force `layer.style.display = "block"` here. The
  // top-frame content script falls back to a manual click notice when this
  // returns false; forcing inline style would otherwise conflict with the
  // page's own subtitle toggle logic.
  return false;
}

export function readContainerText(node: HTMLElement | null): string {
  if (!node) {
    return "";
  }

  const raw = node.innerText || node.textContent || "";
  const text = normalizeFallbackInternalRaw(raw, {
    sourceUrl: window.location.href,
  });
  if (!text) {
    return "";
  }
  return text;
}
