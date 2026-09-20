import {
  buildObservedSubtitlePreview,
  countFilteredUnconfirmedSubtitleRows,
  hasUnconfirmedSubtitleBackground,
  readObservedSubtitleRows,
} from "../subtitle-rows";
import { CONTAINER_PRIORITY, DEFAULT_SELECTORS } from "./constants";
import { compactText, queryAll, queryOne, readContainerText } from "./dom";
import type { SubtitleReadResult } from "./types";

/** 셀렉터 우선순위 자막 읽기 (단일 책임: 텍스트/행 추출). */
export function shouldBlockContainerFallbackForUnconfirmed(
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

export function buildRowSignature(
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

export function uniqueSelectors(selectors: string[]): string[] {
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

export function resolveSelectors(selectors?: string[]): string[] {
  return uniqueSelectors([...(selectors || []), ...DEFAULT_SELECTORS]);
}

export function readSubtitleText(
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
