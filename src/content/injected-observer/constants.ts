/** 주입 옵저버 셀렉터·브리지 키 상수 (단일 책임: 탐색 계약). */
export const DEFAULT_SELECTORS = [
  "#viewSubtit .smi_word:last-child",
  "#viewSubtit .smi_word",
  "#viewSubtit .incont",
  "#viewSubtit",
  "#viewSubtit span",
  ".subtitle_area",
  ".ai_subtitle",
  "[class*='subtitle']",
];

export const CONTAINER_PRIORITY = [
  "#viewSubtit .incont",
  "#viewSubtit",
  ".subtitle_area",
  ".ai_subtitle",
  "[class*='subtitle']",
];

export const BRIDGE_KEY = "__assemblySubtitleObserverBridge";
