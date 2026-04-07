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
  controlActive: boolean;
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

function findVisibleActivationControl(
  root: ParentNode,
): { selector: string; element: HTMLElement; active: boolean } | null {
  for (const selector of ACTIVATION_CONTROL_SELECTORS) {
    const control = root.querySelector(selector);
    if (!isHTMLElement(control) || !isVisible(control)) {
      continue;
    }

    return {
      selector,
      element: control,
      active: isActivationControlActive(control),
    };
  }

  return null;
}

function findActivationControl(root: ParentNode): { selector: string; element: HTMLElement } | null {
  const control = findVisibleActivationControl(root);
  if (!control || control.active) {
    return null;
  }

  return {
    selector: control.selector,
    element: control.element,
  };
}

function walkFramesForControl(
  rootDocument: Document,
  depth: number = 0,
  maxDepth: number = 3,
): { selector: string; element: HTMLElement } | null {
  if (depth > maxDepth) {
    return null;
  }

  const direct = findActivationControl(rootDocument);
  if (direct) {
    return direct;
  }

  const frames = Array.from(
    rootDocument.querySelectorAll<HTMLIFrameElement | HTMLFrameElement>("iframe, frame"),
  );

  for (const frame of frames) {
    try {
      const childDoc = frame.contentDocument;
      if (!childDoc) continue;

      const found = walkFramesForControl(childDoc, depth + 1, maxDepth);
      if (found) {
        return found;
      }
    } catch {
      // Cross-origin access ignored
    }
  }

  return null;
}

function walkFramesForVisibleControl(
  rootDocument: Document,
  depth: number = 0,
  maxDepth: number = 3,
): { selector: string; element: HTMLElement; active: boolean } | null {
  if (depth > maxDepth) {
    return null;
  }

  const direct = findVisibleActivationControl(rootDocument);
  if (direct) {
    return direct;
  }

  const frames = Array.from(
    rootDocument.querySelectorAll<HTMLIFrameElement | HTMLFrameElement>("iframe, frame"),
  );

  for (const frame of frames) {
    try {
      const childDoc = frame.contentDocument;
      if (!childDoc) continue;

      const found = walkFramesForVisibleControl(childDoc, depth + 1, maxDepth);
      if (found) {
        return found;
      }
    } catch {
      // Cross-origin access ignored
    }
  }

  return null;
}

export function readSubtitleLayerState(root: ParentNode = document): SubtitleLayerState {
  const isDoc = root.nodeType === Node.DOCUMENT_NODE;
  const control = isDoc
    ? walkFramesForVisibleControl(root as Document)
    : findVisibleActivationControl(root);
  const layer = root.querySelector(SUBTITLE_LAYER_SELECTOR);
  if (!isHTMLElement(layer)) {
    return {
      found: false,
      visible: false,
      hasText: false,
      controlActive: Boolean(control?.active),
      text: "",
    };
  }

  const text = readText(root);
  return {
    found: true,
    visible: isVisible(layer),
    hasText: Boolean(text),
    controlActive: Boolean(control?.active),
    text,
  };
}

export function tryDomSubtitleActivation(root: ParentNode = document): SubtitleActivationResult {
  const current = readSubtitleLayerState(root);
  if (current.visible && (current.hasText || current.controlActive)) {
    return {
      attempted: false,
      method: "already-visible",
    };
  }

  const isDoc = root.nodeType === Node.DOCUMENT_NODE;
  const control = isDoc ? walkFramesForControl(root as Document) : findActivationControl(root);
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
    if (state.visible && (state.hasText || state.controlActive)) {
      return state;
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, intervalMs));
  }

  return readSubtitleLayerState();
}
