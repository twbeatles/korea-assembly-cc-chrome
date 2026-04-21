import { SUBTITLE_SELECTOR_CANDIDATES } from "../shared/constants";
import type { ObservedSubtitleRow } from "../shared/message-types";
import {
  buildObservedSubtitlePreview,
  hasUnconfirmedSubtitleBackground,
  readObservedSubtitleRows,
} from "./subtitle-rows";
import { normalizeFallbackInternalRaw } from "./fallback-preview";

export interface DomProbeResult {
  text: string;
  matchedSelector: string;
  found: boolean;
  rows?: ObservedSubtitleRow[];
  sourceMode?: "smi-window" | "container";
  blockedByUnconfirmedFilter?: boolean;
}

export interface DomProbeOptions {
  filterUnconfirmedEnabled?: boolean;
  allowUnconfirmedContainerFallback?: boolean;
  sourceUrl?: string;
}

const PRIMARY_SELECTOR_PRIORITY = new Map<string, number>([
  ["#viewSubtit .smi_word:last-child", 0],
  ["#viewSubtit .smi_word", 1],
  ["#viewSubtit .incont", 2],
  ["#viewSubtit", 3],
  ["#viewSubtit span", 4],
  [".subtitle_area", 5],
  [".ai_subtitle", 6],
  ["[class*='subtitle']", 7],
]);

function pushUnique(target: string[], selector: string): void {
  const normalized = selector.trim();
  if (!normalized || target.includes(normalized)) {
    return;
  }
  target.push(normalized);
}

function scoreSelector(selector: string, primarySelector: string): number {
  if (PRIMARY_SELECTOR_PRIORITY.has(selector)) {
    return PRIMARY_SELECTOR_PRIORITY.get(selector) ?? 100;
  }

  if (selector === primarySelector.trim()) {
    return 10;
  }

  return 50;
}

export function getSubtitleSelectorCandidates(
  primarySelector = "",
  extras: string[] = [],
): string[] {
  const candidates: string[] = [];
  pushUnique(candidates, primarySelector);
  SUBTITLE_SELECTOR_CANDIDATES.forEach((selector) => pushUnique(candidates, selector));
  extras.forEach((selector) => pushUnique(candidates, selector));

  return [...candidates].sort(
    (left, right) =>
      scoreSelector(left, primarySelector) - scoreSelector(right, primarySelector),
  );
}

function queryOneSafe(root: ParentNode, selector: string): HTMLElement | null {
  try {
    return root.querySelector<HTMLElement>(selector);
  } catch {
    return null;
  }
}

function queryAllSafe(root: ParentNode, selector: string): HTMLElement[] {
  try {
    return Array.from(root.querySelectorAll<HTMLElement>(selector));
  } catch {
    return [];
  }
}

function normalizeContainerText(node: HTMLElement, sourceUrl?: string): string {
  void sourceUrl;
  const raw = node.innerText || node.textContent || "";
  const text = normalizeFallbackInternalRaw(raw);
  if (!text) {
    return "";
  }
  return text;
}

function readSmiWordWindow(
  root: ParentNode,
  selector: string,
  options?: DomProbeOptions,
): { text: string; rows: ObservedSubtitleRow[] } {
  const rows = readObservedSubtitleRows(root, selector, {
    filterUnconfirmedEnabled: options?.filterUnconfirmedEnabled,
  });
  return {
    text: buildObservedSubtitlePreview(rows),
    rows,
  };
}

function shouldBlockContainerFallbackForUnconfirmed(
  root: ParentNode,
  options?: DomProbeOptions,
): boolean {
  if (options?.allowUnconfirmedContainerFallback) {
    return false;
  }

  if (!options?.filterUnconfirmedEnabled) {
    return false;
  }

  const smiNodes = queryAllSafe(root, "#viewSubtit .smi_word");
  if (!smiNodes.length) {
    return hasUnconfirmedSubtitleBackground(root);
  }

  const confirmedRows = readObservedSubtitleRows(root, "#viewSubtit .smi_word", {
    filterUnconfirmedEnabled: true,
  });
  if (confirmedRows.length === 0) {
    return true;
  }

  return hasUnconfirmedSubtitleBackground(root);
}

function readContainerFallback(
  root: ParentNode,
  blockContainerFallback = false,
  sourceUrl?: string,
): DomProbeResult {
  if (blockContainerFallback) {
    return {
      text: "",
      matchedSelector: "",
      found: false,
      blockedByUnconfirmedFilter: true,
    };
  }

  const fallbackSelectors = [
    "#viewSubtit .incont",
    "#viewSubtit",
    ".subtitle_area",
    ".ai_subtitle",
    "[class*='subtitle']",
  ];

  for (const selector of fallbackSelectors) {
    const node = queryOneSafe(root, selector);
    if (!node) {
      continue;
    }

    const text = normalizeContainerText(node, sourceUrl);
    if (text) {
      return {
        text,
        matchedSelector: selector,
        found: true,
        sourceMode: "container",
        blockedByUnconfirmedFilter: false,
      };
    }
  }

  return {
    text: "",
    matchedSelector: "",
    found: false,
    blockedByUnconfirmedFilter: false,
  };
}

export function readSubtitleTextBySelectors(
  root: ParentNode,
  selectors: string[],
  options?: DomProbeOptions,
): DomProbeResult {
  const blockContainerFallback = shouldBlockContainerFallbackForUnconfirmed(root, options);
  const sourceUrl =
    options?.sourceUrl ?? (typeof window !== "undefined" ? window.location.href : undefined);

  for (const selector of selectors) {
    if (selector.includes(".smi_word")) {
      const smiText = readSmiWordWindow(root, selector, options);
      if (smiText.text) {
        return {
          text: smiText.text,
          matchedSelector: selector,
          found: true,
          rows: smiText.rows,
          sourceMode: "smi-window",
          blockedByUnconfirmedFilter: false,
        };
      }

      // `.smi_word`는 row 기반 읽기 전용으로 사용한다.
      // 필터링 결과가 비어 있으면 같은 selector를 container fallback으로 재해석하지 않는다.
      continue;
    }

    if (blockContainerFallback) {
      continue;
    }

    const node = queryOneSafe(root, selector);
    if (!node) {
      continue;
    }

    const text = normalizeContainerText(node, sourceUrl);
    if (!text) {
      continue;
    }

    return {
      text,
      matchedSelector: selector,
      found: true,
      sourceMode: "container",
      blockedByUnconfirmedFilter: false,
    };
  }

  return readContainerFallback(root, blockContainerFallback, sourceUrl);
}

export function estimateRecentRaw(
  root: ParentNode,
  primarySelector = "",
  options?: DomProbeOptions,
): DomProbeResult {
  const selectors = getSubtitleSelectorCandidates(primarySelector);
  return readSubtitleTextBySelectors(root, selectors, options);
}
