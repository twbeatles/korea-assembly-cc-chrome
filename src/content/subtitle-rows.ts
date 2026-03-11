import type { SpeakerChannel } from "../core/subtitle-models";
import type { ObservedSubtitleRow } from "../shared/message-types";
import { compactSubtitleText, normalizeSubtitleText } from "../core/text-normalizer";

export const PRIMARY_SPEAKER_COLOR = "rgb(35, 124, 147)";
export const SECONDARY_SPEAKER_COLOR = "rgb(30, 30, 30)";

function queryAllSafe(root: ParentNode, selector: string): HTMLElement[] {
  try {
    return Array.from(root.querySelectorAll<HTMLElement>(selector));
  } catch {
    return [];
  }
}

function normalizeRowQuery(selector: string): string {
  return String(selector || "")
    .replace(/:last-child/g, "")
    .replace(/:last-of-type/g, "")
    .trim();
}

function getSmiWordNodes(root: ParentNode, selector: string): HTMLElement[] {
  const query = normalizeRowQuery(selector) || "#viewSubtit .smi_word";
  const nodes = queryAllSafe(root, query);
  return nodes.length ? nodes : queryAllSafe(root, "#viewSubtit .smi_word");
}

function extractStableNodeKey(node: HTMLElement): string {
  const classNames = String(node.className || "")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => token !== "smi_word");

  if (classNames[0]) {
    return classNames[0];
  }

  // 클래스로 식별불가 시 data-smi-id 고유 발급 및 캐싱
  if (!node.dataset.smiId) {
    node.dataset.smiId = `smi_${Math.random().toString(36).slice(2, 9)}_${Date.now()}`;
  }
  return node.dataset.smiId;
}

export function normalizeSpeakerColor(color: string): string {
  const value = String(color || "").trim();
  if (!value || typeof document === "undefined") {
    return value;
  }

  const host = document.body || document.documentElement;
  if (!host) {
    return value;
  }

  const probe = document.createElement("span");
  probe.style.color = value;
  host.appendChild(probe);
  const normalized = window.getComputedStyle(probe).color;
  probe.remove();
  return normalized;
}

export function classifySpeakerChannel(color: string): SpeakerChannel {
  const normalized = normalizeSpeakerColor(color);
  if (normalized === PRIMARY_SPEAKER_COLOR) {
    return "primary";
  }
  if (normalized === SECONDARY_SPEAKER_COLOR) {
    return "secondary";
  }
  return "unknown";
}

export function readSpeakerColor(node: HTMLElement): string {
  const speakerNode =
    node.querySelector<HTMLElement>("span") ??
    node.querySelector<HTMLElement>("[style*='color']") ??
    node;
  return normalizeSpeakerColor(window.getComputedStyle(speakerNode).color);
}

function isConfirmedSubtitleNode(node: HTMLElement): boolean {
  if (typeof window === "undefined" || !window.getComputedStyle) {
    return true;
  }

  const bg = window.getComputedStyle(node).backgroundColor;
  if (bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)") {
    return false;
  }

  const children = Array.from(node.querySelectorAll<HTMLElement>("*"));
  for (const child of children) {
    const childBg = window.getComputedStyle(child).backgroundColor;
    if (childBg && childBg !== "transparent" && childBg !== "rgba(0, 0, 0, 0)") {
      return false;
    }
  }

  return true;
}

export function readObservedSubtitleRows(
  root: ParentNode,
  selector = "#viewSubtit .smi_word",
  options?: { filterUnconfirmedEnabled?: boolean }
): ObservedSubtitleRow[] {
  const rows: ObservedSubtitleRow[] = [];
  const nodes = getSmiWordNodes(root, selector);

  nodes.forEach((node, index) => {
    if (options?.filterUnconfirmedEnabled && !isConfirmedSubtitleNode(node)) {
      return;
    }

    const text = normalizeSubtitleText(node.innerText || node.textContent || "");
    const compact = compactSubtitleText(text);
    if (!compact) {
      return;
    }

    const stableNodeKey = extractStableNodeKey(node);
    const speakerColor = readSpeakerColor(node);
    const nextRow: ObservedSubtitleRow = {
      nodeKey: stableNodeKey || `unstable:${index}:${compact.slice(0, 80)}`,
      text,
      speakerColor,
      speakerChannel: classifySpeakerChannel(speakerColor),
      unstableKey: !stableNodeKey,
    };

    const previousRow = rows.at(-1);
    if (
      previousRow &&
      compactSubtitleText(previousRow.text) === compact &&
      (previousRow.nodeKey === nextRow.nodeKey ||
        (previousRow.unstableKey && nextRow.unstableKey))
    ) {
      rows[rows.length - 1] = nextRow;
      return;
    }

    rows.push(nextRow);
  });

  return rows;
}

export function buildObservedSubtitlePreview(
  rows: ObservedSubtitleRow[],
  maxRows = 3,
): string {
  return rows
    .slice(-maxRows)
    .map((row) => row.text)
    .filter(Boolean)
    .join(" ")
    .trim();
}

export function hasStableObservedSubtitleRows(rows: ObservedSubtitleRow[]): boolean {
  return rows.some((row) => !row.unstableKey);
}
