import { OBSERVER_ACTIVATE_EVENT } from "../shared/constants";
import { buildObservedSubtitlePreview, readObservedSubtitleRows } from "./subtitle-rows";

const OBSERVER_CONFIG_EVENT = "assembly-subtitle-observer:config";
const OBSERVER_STOP_EVENT = "assembly-subtitle-observer:stop";
const OBSERVER_BRIDGE_SOURCE = "assembly-subtitle-observer";
const DEFAULT_SELECTORS = [
  "#viewSubtit .smi_word:last-child",
  "#viewSubtit .smi_word",
  "#viewSubtit .incont",
  "#viewSubtit",
  "#viewSubtit span",
  ".subtitle_area",
  ".ai_subtitle",
  "[class*='subtitle']",
];
const CONTAINER_PRIORITY = [
  "#viewSubtit .incont",
  "#viewSubtit",
  ".subtitle_area",
  ".ai_subtitle",
  "[class*='subtitle']",
];
const BRIDGE_KEY = "__assemblySubtitleObserverBridge";

type SubtitleReadResult = {
  text: string;
  selector: string;
  rows: {
    nodeKey: string;
    text: string;
    speakerColor: string;
    speakerChannel: "primary" | "secondary" | "unknown";
    unstableKey: boolean;
  }[];
};

type BridgeState = {
  observer: MutationObserver | null;
  pollingTimer: number | null;
  healthTimer: number | null;
  selectors: string[];
  lastText: string;
  lastCompact: string;
  lastRowSignature: string;
  target: HTMLElement | null;
  observerSelector: string;
  observerActive: boolean;
  pollingIntervalMs: number;
};

function normalizeText(text: string): string {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function compactText(text: string): string {
  return String(text || "").replace(/\s+/g, "").trim();
}

function extractTailLines(text: string, maxLines = 3): string {
  const lines = String(text || "")
    .split("\n")
    .map((line) => normalizeText(line))
    .filter(Boolean);

  return lines.slice(-maxLines).join(" ");
}

function queryOne(selector: string): HTMLElement | null {
  try {
    return document.querySelector<HTMLElement>(selector);
  } catch {
    return null;
  }
}

function isVisible(node: HTMLElement | null): boolean {
  if (!node) {
    return false;
  }

  const style = window.getComputedStyle(node);
  return style.display !== "none" && style.visibility !== "hidden";
}

function isSubtitleLayerVisible(): boolean {
  const layer = queryOne("#viewSubtit");
  return isVisible(layer);
}

function isActivationControlActive(node: HTMLElement): boolean {
  const className = String(node.className || "");
  const title = String(node.getAttribute("title") || "");
  const ariaPressed = String(node.getAttribute("aria-pressed") || "");
  return /\bon\b/.test(className) || /(끄기|닫기)/.test(title) || ariaPressed === "true";
}

function clickActivationControl(selector: string): boolean {
  const button = queryOne(selector);
  if (!button || !isVisible(button) || isActivationControlActive(button)) {
    return false;
  }

  button.click();
  return true;
}

function invokeActivationFunction<T extends unknown[]>(
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

function ensureSubtitleLayerVisible(): boolean {
  if (isSubtitleLayerVisible()) {
    return true;
  }

  if (invokeActivationFunction((window as Window & { smi_mode_act?: (value: number) => void }).smi_mode_act, 1)) {
    return true;
  }

  if (invokeActivationFunction((window as Window & { smi_on?: () => void }).smi_on)) {
    return true;
  }

  if (
    invokeActivationFunction(
      (window as Window & { layerSubtit?: () => void }).layerSubtit,
    )
  ) {
    return true;
  }

  if (clickActivationControl(".btn_subtit_ai") || clickActivationControl(".btn_subtit_def")) {
    return true;
  }

  if (clickActivationControl(".btn_subtit") || clickActivationControl("#smi_btn")) {
    return true;
  }

  const layer = queryOne("#viewSubtit");
  if (layer) {
    layer.style.display = "block";
    return isSubtitleLayerVisible();
  }

  return false;
}

function readContainerText(node: HTMLElement | null): string {
  if (!node) {
    return "";
  }

  const raw = node.innerText || node.textContent || "";
  const text = normalizeText(raw);
  if (!text) {
    return "";
  }
  if (text.length <= 400) {
    return text;
  }
  return normalizeText(extractTailLines(raw, 3));
}

function buildRowSignature(
  rows: {
    nodeKey: string;
    text: string;
    speakerColor: string;
    speakerChannel: "primary" | "secondary" | "unknown";
    unstableKey: boolean;
  }[],
): string {
  return rows
    .map(
      (row) =>
        `${row.nodeKey}|${compactText(row.text)}|${row.speakerColor}|${row.speakerChannel}|${row.unstableKey}`,
    )
    .join("||");
}

function uniqueSelectors(selectors: string[]): string[] {
  const result: string[] = [];
  for (const selector of selectors) {
    const normalized = String(selector || "").trim();
    if (!normalized || result.includes(normalized)) {
      continue;
    }
    result.push(normalized);
  }
  return result;
}

function resolveSelectors(selectors?: string[]): string[] {
  return uniqueSelectors([...(selectors || []), ...DEFAULT_SELECTORS]);
}

function readSubtitleText(selectors: string[], preferredSelector = ""): SubtitleReadResult {
  const orderedSelectors = uniqueSelectors([preferredSelector, ...selectors]);

  for (const selector of orderedSelectors) {
    if (selector.includes(".smi_word")) {
      const rows = readObservedSubtitleRows(document, selector);
      const smiText = buildObservedSubtitlePreview(rows);
      if (smiText) {
        return {
          text: smiText,
          selector,
          rows,
        };
      }
    }

    const node = queryOne(selector);
    const text = readContainerText(node);
    if (text) {
      return {
        text,
        selector,
        rows: [],
      };
    }
  }

  for (const fallbackSelector of CONTAINER_PRIORITY) {
    const node = queryOne(fallbackSelector);
    const text = readContainerText(node);
    if (text) {
      return {
        text,
        selector: fallbackSelector,
        rows: [],
      };
    }
  }

  return {
    text: "",
    selector: preferredSelector,
    rows: [],
  };
}

function emit(
  kind: "subtitle:update" | "subtitle:reset" | "subtitle:health",
  payload: Record<string, unknown>,
): void {
  window.postMessage(
    {
      source: OBSERVER_BRIDGE_SOURCE,
      kind,
      timestamp: Date.now(),
      sourceUrl: window.location.href,
      ...payload,
    },
    "*",
  );
}

function selectTarget(selectors: string[]): { selector: string; element: HTMLElement | null } {
  const queue = uniqueSelectors([...CONTAINER_PRIORITY, ...selectors]);
  for (const selector of queue) {
    const element = queryOne(selector);
    if (element) {
      return { selector, element };
    }
  }

  return {
    selector: "",
    element: null,
  };
}

function teardownBridge(state: BridgeState): void {
  if (state.observer) {
    state.observer.disconnect();
    state.observer = null;
  }
  if (state.pollingTimer) {
    window.clearInterval(state.pollingTimer);
    state.pollingTimer = null;
  }
  if (state.healthTimer) {
    window.clearInterval(state.healthTimer);
    state.healthTimer = null;
  }
  state.observerActive = false;
}

function emitCurrentSubtitle(state: BridgeState, observerActive: boolean): void {
  const current = readSubtitleText(state.selectors, state.observerSelector);
  if (current.selector) {
    state.observerSelector = current.selector;
  }

  const compact = compactText(current.text);
  const rowSignature = buildRowSignature(current.rows);
  if (!compact) {
    if (state.lastCompact) {
      state.lastText = "";
      state.lastCompact = "";
      state.lastRowSignature = "";
      emit("subtitle:reset", {
        selector: state.observerSelector,
        observerActive,
      });
    }
    return;
  }

  if (compact === state.lastCompact && rowSignature === state.lastRowSignature) {
    return;
  }

  state.lastText = current.text;
  state.lastCompact = compact;
  state.lastRowSignature = rowSignature;
  emit("subtitle:update", {
    raw: current.text,
    rows: current.rows,
    selector: state.observerSelector,
    observerActive,
  });
}

function startPolling(state: BridgeState): void {
  state.pollingTimer = window.setInterval(() => {
    const { selector, element } = selectTarget(state.selectors);
    state.target = element;
    if (selector) {
      state.observerSelector = selector;
    }
    emitCurrentSubtitle(state, false);
  }, state.pollingIntervalMs);
}

function installBridge(detail?: { selectors?: string[]; pollingIntervalMs?: number }): void {
  const state = (window as Window & { [BRIDGE_KEY]?: BridgeState })[BRIDGE_KEY];
  if (!state) {
    return;
  }

  teardownBridge(state);
  state.selectors = resolveSelectors(detail?.selectors);
  state.pollingIntervalMs = Math.max(100, detail?.pollingIntervalMs ?? 180);

  const { selector, element } = selectTarget(state.selectors);
  state.target = element;
  state.observerSelector = selector;

  if (element) {
    state.observer = new MutationObserver(() => {
      if (!state.target || !state.target.isConnected) {
        installBridge({
          selectors: state.selectors,
          pollingIntervalMs: state.pollingIntervalMs,
        });
        return;
      }

      emitCurrentSubtitle(state, true);
    });

    state.observer.observe(element, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
    });
    state.observerActive = true;
  } else {
    startPolling(state);
  }

  state.healthTimer = window.setInterval(() => {
    if (state.observerActive && (!state.target || !state.target.isConnected)) {
      installBridge({
        selectors: state.selectors,
        pollingIntervalMs: state.pollingIntervalMs,
      });
      return;
    }

    emit("subtitle:health", {
      selector: state.observerSelector,
      observerActive: state.observerActive,
    });
  }, 2000);

  emit("subtitle:health", {
    selector: state.observerSelector,
    observerActive: state.observerActive,
  });
  emitCurrentSubtitle(state, state.observerActive);
}

if (!(window as Window & { [BRIDGE_KEY]?: BridgeState })[BRIDGE_KEY]) {
  (window as Window & { [BRIDGE_KEY]?: BridgeState })[BRIDGE_KEY] = {
    observer: null,
    pollingTimer: null,
    healthTimer: null,
    selectors: [...DEFAULT_SELECTORS],
    lastText: "",
    lastCompact: "",
    lastRowSignature: "",
    target: null,
    observerSelector: "",
    observerActive: false,
    pollingIntervalMs: 180,
  };

  window.addEventListener(OBSERVER_CONFIG_EVENT, (event) => {
    const customEvent = event as CustomEvent<{ selectors?: string[]; pollingIntervalMs?: number }>;
    installBridge(customEvent.detail);
  });

  window.addEventListener(OBSERVER_STOP_EVENT, () => {
    const state = (window as Window & { [BRIDGE_KEY]?: BridgeState })[BRIDGE_KEY];
    if (state) {
      teardownBridge(state);
    }
  });

  window.addEventListener(OBSERVER_ACTIVATE_EVENT, () => {
    const state = (window as Window & { [BRIDGE_KEY]?: BridgeState })[BRIDGE_KEY];
    const activated = ensureSubtitleLayerVisible();
    if (state && activated) {
      installBridge({
        selectors: state.selectors,
        pollingIntervalMs: state.pollingIntervalMs,
      });
    }
  });
}

installBridge();
