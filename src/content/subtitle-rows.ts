import type { SpeakerChannel } from "../core/subtitle-models";
import type { ObservedSubtitleRow } from "../shared/message-types";
import { compactSubtitleText, normalizeSubtitleText } from "../core/text-normalizer";
import { createRandomToken } from "../shared/random-token";

export const PRIMARY_SPEAKER_COLOR = "rgb(35, 124, 147)";
export const SECONDARY_SPEAKER_COLOR = "rgb(30, 30, 30)";
const SPEAKER_COLOR_CACHE_MAX_SIZE = 128;
const CONFIRMATION_DESCENDANT_SAMPLE_LIMIT = 48;
const CONTAINER_CONFIRMATION_SELECTORS = [
  "#viewSubtit .smi_word",
  "#viewSubtit .incont",
  "#viewSubtit",
  ".subtitle_area",
  ".ai_subtitle",
] as const;
const normalizedSpeakerColorCache = new Map<string, string>();

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

function extractClassNodeKey(node: HTMLElement): string {
  const classNames = String(node.className || "")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => token !== "smi_word");

  return classNames[0] ?? "";
}

function extractAttributeNodeKey(node: HTMLElement): string {
  const candidateKeys = [
    node.getAttribute("data-id"),
    node.getAttribute("data-key"),
    node.id,
  ];

  for (const candidate of candidateKeys) {
    const normalized = String(candidate || "").trim();
    if (normalized) {
      return normalized;
    }
  }

  return "";
}

function ensureGeneratedNodeKey(node: HTMLElement): string {
  if (!node.dataset.assemblyRowKey) {
    node.dataset.assemblyRowKey = `row_${createRandomToken()}`;
  }
  return node.dataset.assemblyRowKey;
}

export function normalizeSpeakerColor(color: string): string {
  const value = String(color || "").trim();
  if (!value || typeof document === "undefined") {
    return value;
  }

  const cached = normalizedSpeakerColorCache.get(value);
  if (cached) {
    return cached;
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

  if (normalizedSpeakerColorCache.size >= SPEAKER_COLOR_CACHE_MAX_SIZE) {
    normalizedSpeakerColorCache.clear();
  }
  normalizedSpeakerColorCache.set(value, normalized);
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

function hasOpaqueBackground(backgroundColor: string): boolean {
  const normalized = String(backgroundColor || "")
    .replace(/\s+/g, "")
    .toLowerCase();
  return Boolean(normalized) && normalized !== "transparent" && normalized !== "rgba(0,0,0,0)";
}

function hasHighlightBackgroundImage(backgroundImage: string): boolean {
  const normalized = String(backgroundImage || "").trim().toLowerCase();
  return Boolean(normalized) && normalized !== "none";
}

function hasVisibleBackgroundHighlight(style: CSSStyleDeclaration): boolean {
  return (
    hasOpaqueBackground(style.backgroundColor) ||
    hasHighlightBackgroundImage(style.backgroundImage)
  );
}

function hasMeaningfulNodeText(node: HTMLElement): boolean {
  return Boolean(compactSubtitleText(node.innerText || node.textContent || ""));
}

function collectConfirmationCheckTargets(node: HTMLElement): HTMLElement[] {
  const descendants = Array.from(node.querySelectorAll<HTMLElement>("*"));
  if (descendants.length <= CONFIRMATION_DESCENDANT_SAMPLE_LIMIT) {
    return descendants;
  }

  const sampled: HTMLElement[] = [];
  const sampledIndices = new Set<number>();
  const step = descendants.length / CONFIRMATION_DESCENDANT_SAMPLE_LIMIT;
  for (let index = 0; index < CONFIRMATION_DESCENDANT_SAMPLE_LIMIT; index += 1) {
    const sampledIndex = Math.min(
      descendants.length - 1,
      Math.floor(index * step),
    );
    if (sampledIndices.has(sampledIndex)) {
      continue;
    }
    sampledIndices.add(sampledIndex);
    sampled.push(descendants[sampledIndex]);
  }

  return sampled;
}

function isConfirmedSubtitleNode(node: HTMLElement): boolean {
  if (typeof window === "undefined" || !window.getComputedStyle) {
    return true;
  }

  const nodeStyle = window.getComputedStyle(node);
  if (hasVisibleBackgroundHighlight(nodeStyle)) {
    return false;
  }

  const children = collectConfirmationCheckTargets(node);
  for (const child of children) {
    if (hasVisibleBackgroundHighlight(window.getComputedStyle(child))) {
      return false;
    }
  }

  return true;
}

export function hasUnconfirmedSubtitleBackground(root: ParentNode): boolean {
  const seen = new Set<HTMLElement>();

  for (const selector of CONTAINER_CONFIRMATION_SELECTORS) {
    const nodes = queryAllSafe(root, selector);
    for (const node of nodes) {
      if (seen.has(node) || !hasMeaningfulNodeText(node)) {
        continue;
      }

      seen.add(node);
      if (!isConfirmedSubtitleNode(node)) {
        return true;
      }
    }
  }

  return false;
}

export function readObservedSubtitleRows(
  root: ParentNode,
  selector = "#viewSubtit .smi_word",
  options?: { filterUnconfirmedEnabled?: boolean }
): ObservedSubtitleRow[] {
  const rows: ObservedSubtitleRow[] = [];
  const nodes = getSmiWordNodes(root, selector);
  const classKeyCounts = new Map<string, number>();

  nodes.forEach((node) => {
    const classKey = extractClassNodeKey(node);
    if (!classKey) {
      return;
    }
    classKeyCounts.set(classKey, (classKeyCounts.get(classKey) ?? 0) + 1);
  });

  nodes.forEach((node) => {
    if (options?.filterUnconfirmedEnabled && !isConfirmedSubtitleNode(node)) {
      return;
    }

    const text = normalizeSubtitleText(node.innerText || node.textContent || "");
    const compact = compactSubtitleText(text);
    if (!compact) {
      return;
    }

    const classNodeKey = extractClassNodeKey(node);
    const attrNodeKey = extractAttributeNodeKey(node);
    const hasUniqueClassNodeKey =
      Boolean(classNodeKey) && classKeyCounts.get(classNodeKey) === 1;
    const nodeKey = hasUniqueClassNodeKey
      ? `class:${classNodeKey}`
      : attrNodeKey
        ? `attr:${attrNodeKey}`
        : ensureGeneratedNodeKey(node);
    const speakerColor = readSpeakerColor(node);
    const nextRow: ObservedSubtitleRow = {
      nodeKey,
      text,
      speakerColor,
      speakerChannel: classifySpeakerChannel(speakerColor),
      unstableKey: !hasUniqueClassNodeKey && !attrNodeKey,
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
