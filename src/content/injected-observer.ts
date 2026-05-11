import {
  OBSERVER_ACTIVATE_EVENT,
  OBSERVER_BRIDGE_SOURCE,
  OBSERVER_CONFIG_EVENT,
  OBSERVER_STOP_EVENT,
} from "../shared/constants";
import {
  buildObservedSubtitlePreview,
  countFilteredUnconfirmedSubtitleRows,
  hasUnconfirmedSubtitleBackground,
  readObservedSubtitleRows,
} from "./subtitle-rows";
import { isElementVisible } from "./visibility";
import { normalizeFallbackInternalRaw } from "./fallback-preview";
import {
  shouldAllowUnconfirmedContainerFallback,
  updateUnconfirmedFallbackBlockStreak,
} from "./unconfirmed-fallback";
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
    nodeKeySource?: "attribute" | "class" | "generated";
  }[];
  blockedByUnconfirmedFilter: boolean;
  filteredUnconfirmedCount: number;
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
  filterUnconfirmedEnabled: boolean;
  unconfirmedFallbackBlockStreak: number;
  token: string;
};

function compactText(text: string): string {
  return String(text || "").replace(/\s+/g, "").trim();
}

function queryOne(selector: string): HTMLElement | null {
  try {
    return document.querySelector<HTMLElement>(selector);
  } catch {
    return null;
  }
}

function queryAll(selector: string): HTMLElement[] {
  try {
    return Array.from(document.querySelectorAll<HTMLElement>(selector));
  } catch {
    return [];
  }
}

function isSubtitleLayerVisible(): boolean {
  const layer = queryOne("#viewSubtit");
  return isElementVisible(layer);
}

function isActivationControlActive(node: HTMLElement): boolean {
  const className = String(node.className || "");
  const title = String(node.getAttribute("title") || "");
  const ariaPressed = String(node.getAttribute("aria-pressed") || "");
  return /\bon\b/.test(className) || /(끄기|닫기)/.test(title) || ariaPressed === "true";
}

function clickActivationControl(selector: string): boolean {
  const button = queryOne(selector);
  if (!button || !isElementVisible(button) || isActivationControlActive(button)) {
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

function readContainerText(node: HTMLElement | null): string {
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

function shouldBlockContainerFallbackForUnconfirmed(
  filterUnconfirmedEnabled: boolean,
  allowUnconfirmedContainerFallback: boolean,
): boolean {
  if (allowUnconfirmedContainerFallback) {
    return false;
  }

  if (!filterUnconfirmedEnabled) {
    return false;
  }

  const smiNodes = queryAll("#viewSubtit .smi_word");
  if (!smiNodes.length) {
    return hasUnconfirmedSubtitleBackground(document);
  }

  const confirmedRows = readObservedSubtitleRows(document, "#viewSubtit .smi_word", {
    filterUnconfirmedEnabled: true,
  });
  if (confirmedRows.length === 0) {
    return true;
  }

  return hasUnconfirmedSubtitleBackground(document);
}

function buildRowSignature(
  rows: {
    nodeKey: string;
    text: string;
    speakerColor: string;
    speakerChannel: "primary" | "secondary" | "unknown";
    unstableKey: boolean;
    nodeKeySource?: "attribute" | "class" | "generated";
  }[],
): string {
  return rows
    .map(
      (row) =>
        `${row.nodeKey}|${compactText(row.text)}|${row.speakerColor}|${row.speakerChannel}|${row.unstableKey}|${row.nodeKeySource ?? ""}`,
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

function readSubtitleText(
  selectors: string[],
  preferredSelector = "",
  filterUnconfirmedEnabled = true,
  allowUnconfirmedContainerFallback = false,
): SubtitleReadResult {
  const orderedSelectors = uniqueSelectors([preferredSelector, ...selectors]);
  const blockContainerFallback = shouldBlockContainerFallbackForUnconfirmed(
    filterUnconfirmedEnabled,
    allowUnconfirmedContainerFallback,
  );
  const filteredUnconfirmedCount = filterUnconfirmedEnabled
    ? countFilteredUnconfirmedSubtitleRows(document, "#viewSubtit .smi_word")
    : 0;

  for (const selector of orderedSelectors) {
    if (selector.includes(".smi_word")) {
      const rows = readObservedSubtitleRows(document, selector, { filterUnconfirmedEnabled });
      const smiText = buildObservedSubtitlePreview(rows);
      if (smiText) {
        return {
          text: smiText,
          selector,
          rows,
          blockedByUnconfirmedFilter: false,
          filteredUnconfirmedCount,
        };
      }

      // `.smi_word`는 row 기반 읽기 전용으로 취급한다.
      // 필터링 결과가 비어 있으면 같은 selector를 container fallback으로 재사용하지 않는다.
      continue;
    }

    if (blockContainerFallback) {
      continue;
    }

    const node = queryOne(selector);
    const text = readContainerText(node);
    if (text) {
      return {
        text,
        selector,
        rows: [],
        blockedByUnconfirmedFilter: false,
        filteredUnconfirmedCount,
      };
    }
  }

  for (const fallbackSelector of CONTAINER_PRIORITY) {
    if (blockContainerFallback) {
      break;
    }
    const node = queryOne(fallbackSelector);
    const text = readContainerText(node);
    if (text) {
      return {
        text,
        selector: fallbackSelector,
        rows: [],
        blockedByUnconfirmedFilter: false,
        filteredUnconfirmedCount,
      };
    }
  }

  return {
    text: "",
    selector: preferredSelector,
    rows: [],
    blockedByUnconfirmedFilter: blockContainerFallback,
    filteredUnconfirmedCount,
  };
}

function emit(
  kind: "subtitle:update" | "subtitle:reset" | "subtitle:health",
  token: string,
  payload: Record<string, unknown>,
): void {
  window.postMessage(
    {
      source: OBSERVER_BRIDGE_SOURCE,
      token,
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
  const allowUnconfirmedContainerFallback = shouldAllowUnconfirmedContainerFallback(
    state.unconfirmedFallbackBlockStreak,
  );
  const current = readSubtitleText(
    state.selectors,
    state.observerSelector,
    state.filterUnconfirmedEnabled,
    allowUnconfirmedContainerFallback,
  );
  if (current.selector) {
    state.observerSelector = current.selector;
  }

  state.unconfirmedFallbackBlockStreak = updateUnconfirmedFallbackBlockStreak(
    state.unconfirmedFallbackBlockStreak,
    {
      blockedByUnconfirmedFilter: current.blockedByUnconfirmedFilter,
      found: Boolean(current.text),
      text: current.text,
    },
  );

  const compact = compactText(current.text);
  if (!compact) {
    if (state.lastCompact) {
      state.lastText = "";
      state.lastCompact = "";
      state.lastRowSignature = "";
      emit("subtitle:reset", state.token, {
        selector: state.observerSelector,
        observerActive,
      });
    }
    return;
  }

  if (current.rows.length > 0) {
    const rowSignature = buildRowSignature(current.rows);
    if (compact === state.lastCompact && rowSignature === state.lastRowSignature) {
      return;
    }

    state.lastText = current.text;
    state.lastCompact = compact;
    state.lastRowSignature = rowSignature;
    emit("subtitle:update", state.token, {
      raw: current.text,
      rows: current.rows,
      selector: state.observerSelector,
      observerActive,
      filteredUnconfirmedCount: current.filteredUnconfirmedCount,
    });
    return;
  }

  // fallback: rows가 없는 경우 (container text) - 기존 방식 유지
  const rowSignature = buildRowSignature(current.rows);
  if (compact === state.lastCompact && rowSignature === state.lastRowSignature) {
    return;
  }

  state.lastText = current.text;
  state.lastCompact = compact;
  state.lastRowSignature = rowSignature;
  emit("subtitle:update", state.token, {
    raw: current.text,
    rows: current.rows,
    selector: state.observerSelector,
    observerActive,
    filteredUnconfirmedCount: current.filteredUnconfirmedCount,
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

function installBridge(detail?: {
  selectors?: string[];
  pollingIntervalMs?: number;
  filterUnconfirmedEnabled?: boolean;
  token?: string;
}): void {
  const state = (window as Window & { [BRIDGE_KEY]?: BridgeState })[BRIDGE_KEY];
  if (!state) {
    return;
  }

  teardownBridge(state);
  state.selectors = resolveSelectors(detail?.selectors);
  state.pollingIntervalMs = Math.max(100, detail?.pollingIntervalMs ?? 180);
  state.filterUnconfirmedEnabled =
    detail?.filterUnconfirmedEnabled ?? state.filterUnconfirmedEnabled;
  if (typeof detail?.token === "string" && detail.token) {
    state.token = detail.token;
  }

  const { selector, element } = selectTarget(state.selectors);
  state.target = element;
  state.observerSelector = selector;

  if (element) {
    state.observer = new MutationObserver(() => {
      if (!state.target || !state.target.isConnected) {
        installBridge({
          selectors: state.selectors,
          pollingIntervalMs: state.pollingIntervalMs,
          filterUnconfirmedEnabled: state.filterUnconfirmedEnabled,
          token: state.token,
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
        filterUnconfirmedEnabled: state.filterUnconfirmedEnabled,
        token: state.token,
      });
      return;
    }

    emit("subtitle:health", state.token, {
      selector: state.observerSelector,
      observerActive: state.observerActive,
    });
  }, 2000);

  emit("subtitle:health", state.token, {
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
    filterUnconfirmedEnabled: true,
    unconfirmedFallbackBlockStreak: 0,
    token: "",
  };

  window.addEventListener(OBSERVER_CONFIG_EVENT, (event) => {
    const customEvent = event as CustomEvent<{
      selectors?: string[];
      pollingIntervalMs?: number;
      filterUnconfirmedEnabled?: boolean;
      token?: string;
    }>;
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
        filterUnconfirmedEnabled: state.filterUnconfirmedEnabled,
        token: state.token,
      });
    }
  });
}
