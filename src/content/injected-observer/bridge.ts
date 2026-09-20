import { OBSERVER_BRIDGE_SOURCE } from "../../shared/constants";
import { BRIDGE_KEY, CONTAINER_PRIORITY } from "./constants";
import { compactText, queryOne } from "./dom";
import {
  buildRowSignature,
  readSubtitleText,
  resolveSelectors,
  uniqueSelectors,
} from "./reading";
import {
  shouldAllowUnconfirmedContainerFallback,
  updateUnconfirmedFallbackBlockStreak,
} from "../unconfirmed-fallback";
import type { BridgeState } from "./types";

/** MutationObserver/폴링 브리지와 content script 전달 (단일 책임: 변경 감지·방출). */
export function emit(
  kind: "subtitle:update" | "subtitle:reset" | "subtitle:health",
  token: string,
  payload: Record<string, unknown>,
): void {
  // 동일 출처 페이지 월드 → content script. wildcard 대신 origin 고정.
  const targetOrigin =
    typeof window.location?.origin === "string" && window.location.origin
      ? window.location.origin
      : "*";
  window.postMessage(
    {
      source: OBSERVER_BRIDGE_SOURCE,
      token,
      kind,
      timestamp: Date.now(),
      sourceUrl: window.location.href,
      ...payload,
    },
    targetOrigin,
  );
}

export function selectTarget(selectors: string[]): { selector: string; element: HTMLElement | null } {
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

export function teardownBridge(state: BridgeState): void {
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

export function emitCurrentSubtitle(state: BridgeState, observerActive: boolean): void {
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

export function startPolling(state: BridgeState): void {
  state.pollingTimer = window.setInterval(() => {
    const { selector, element } = selectTarget(state.selectors);
    state.target = element;
    if (selector) {
      state.observerSelector = selector;
    }
    emitCurrentSubtitle(state, false);
  }, state.pollingIntervalMs);
}

export function installBridge(detail?: {
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
