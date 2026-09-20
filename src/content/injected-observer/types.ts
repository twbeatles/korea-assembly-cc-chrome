/** 주입 옵저버 읽기 결과·브리지 상태 타입 (단일 책임: page world 데이터 형상). */
export type SubtitleReadResult = {
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

export type BridgeState = {
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
