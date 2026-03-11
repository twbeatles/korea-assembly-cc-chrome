const SUBTITLE_LAYER_SELECTOR = "#viewSubtit";
const SUBTITLE_TEXT_SELECTOR = "#viewSubtit .smi_word, #viewSubtit .incont";
const ACTIVATION_CONTROL_SELECTORS = [
  ".btn_subtit_ai",
  ".btn_subtit_def",
  ".btn_subtit",
  "#smi_btn",
  ".Subtitle",
] as const;

export interface SubtitleLayerState {
  found: boolean;
  visible: boolean;
  hasText: boolean;
  text: string;
}

export interface SubtitleActivationResult {
  attempted: boolean;
  method: "already-visible" | "button-click" | "layer-style" | "none";
  controlSelector?: string;
}

function isHTMLElement(node: Element | null): node is HTMLElement {
  return Boolean(node) && node instanceof HTMLElement;
}

function isVisible(element: HTMLElement | null): boolean {
  if (!element) {
    return false;
  }

  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

function readText(root: ParentNode): string {
  const raw = Array.from(root.querySelectorAll<HTMLElement>(SUBTITLE_TEXT_SELECTOR))
    .map((node) => node.innerText || node.textContent || "")
    .join(" ");
  return raw.replace(/\s+/g, " ").trim();
}

function isActivationControlActive(element: HTMLElement): boolean {
  const className = element.className || "";
  const title = element.getAttribute("title") || "";
  const ariaPressed = element.getAttribute("aria-pressed") || "";
  return /\bon\b/.test(className) || /(끄기|닫기)/.test(title) || ariaPressed === "true";
}

function findActivationControl(root: ParentNode): { selector: string; element: HTMLElement } | null {
  for (const selector of ACTIVATION_CONTROL_SELECTORS) {
    const control = root.querySelector(selector);
    if (!isHTMLElement(control) || !isVisible(control) || isActivationControlActive(control)) {
      continue;
    }

    return {
      selector,
      element: control,
    };
  }

  return null;
}

export function readSubtitleLayerState(root: ParentNode = document): SubtitleLayerState {
  const layer = root.querySelector(SUBTITLE_LAYER_SELECTOR);
  if (!isHTMLElement(layer)) {
    return {
      found: false,
      visible: false,
      hasText: false,
      text: "",
    };
  }

  const text = readText(root);
  return {
    found: true,
    visible: isVisible(layer),
    hasText: Boolean(text),
    text,
  };
}

export function tryDomSubtitleActivation(root: ParentNode = document): SubtitleActivationResult {
  const current = readSubtitleLayerState(root);
  if (current.visible) {
    return {
      attempted: false,
      method: "already-visible",
    };
  }

  const control = findActivationControl(root);
  if (control) {
    control.element.click();
    return {
      attempted: true,
      method: "button-click",
      controlSelector: control.selector,
    };
  }

  const layer = root.querySelector(SUBTITLE_LAYER_SELECTOR);
  if (isHTMLElement(layer)) {
    layer.style.display = "block";
    return {
      attempted: true,
      method: "layer-style",
    };
  }

  return {
    attempted: false,
    method: "none",
  };
}

export async function waitForSubtitleLayer(
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<SubtitleLayerState> {
  const timeoutMs = Math.max(200, options.timeoutMs ?? 2500);
  const intervalMs = Math.max(50, options.intervalMs ?? 120);
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    const state = readSubtitleLayerState();
    if (state.visible) {
      return state;
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, intervalMs));
  }

  return readSubtitleLayerState();
}
