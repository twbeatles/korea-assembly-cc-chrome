import {
  OBSERVER_ACTIVATE_EVENT,
  OBSERVER_CONFIG_EVENT,
  OBSERVER_STOP_EVENT,
} from "../../shared/constants";
import { installBridge, teardownBridge } from "./bridge";
import { BRIDGE_KEY, DEFAULT_SELECTORS } from "./constants";
import { ensureSubtitleLayerVisible } from "./dom";
import type { BridgeState } from "./types";

/** page world 부트스트랩 (단일 책임: import 시 1회 설치·이벤트 바인딩). */
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
