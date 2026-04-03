import { extractTailLines, normalizeSubtitleText } from "../core/text-normalizer";
import { isAssemblyPlenaryUrl, SUBTITLE_SELECTOR_CANDIDATES } from "../shared/constants";

export type SubtitleSelectorProfileId = "default" | "committee" | "plenary";

export interface SubtitleSelectorProfile {
  id: SubtitleSelectorProfileId;
  orderedSelectors: readonly string[];
  containerSelectors: readonly string[];
  preserveFullContainerText: boolean;
}

const DEFAULT_CONTAINER_SELECTORS = [
  "#viewSubtit .incont",
  "#viewSubtit",
  ".subtitle_area",
  ".ai_subtitle",
  "[class*='subtitle']",
] as const;

const DEFAULT_PROFILE: SubtitleSelectorProfile = {
  id: "default",
  orderedSelectors: SUBTITLE_SELECTOR_CANDIDATES,
  containerSelectors: DEFAULT_CONTAINER_SELECTORS,
  preserveFullContainerText: false,
};

const COMMITTEE_PROFILE: SubtitleSelectorProfile = {
  id: "committee",
  orderedSelectors: SUBTITLE_SELECTOR_CANDIDATES,
  containerSelectors: DEFAULT_CONTAINER_SELECTORS,
  preserveFullContainerText: false,
};

const PLENARY_PROFILE: SubtitleSelectorProfile = {
  id: "plenary",
  orderedSelectors: SUBTITLE_SELECTOR_CANDIDATES,
  containerSelectors: DEFAULT_CONTAINER_SELECTORS,
  preserveFullContainerText: true,
};

const PROFILE_PRIORITY_MAP = new Map<SubtitleSelectorProfileId, Map<string, number>>([
  [
    "default",
    new Map(DEFAULT_PROFILE.orderedSelectors.map((selector, index) => [selector, index])),
  ],
  [
    "committee",
    new Map(COMMITTEE_PROFILE.orderedSelectors.map((selector, index) => [selector, index])),
  ],
  [
    "plenary",
    new Map(PLENARY_PROFILE.orderedSelectors.map((selector, index) => [selector, index])),
  ],
]);

function pushUnique(target: string[], selector: string): void {
  const normalized = selector.trim();
  if (!normalized || target.includes(normalized)) {
    return;
  }
  target.push(normalized);
}

function scoreSelector(
  selector: string,
  primarySelector: string,
  priorityMap: ReadonlyMap<string, number>,
): number {
  if (selector === primarySelector.trim()) {
    return -1;
  }

  if (priorityMap.has(selector)) {
    return priorityMap.get(selector) ?? 100;
  }

  return 50;
}

export function resolveSubtitleSelectorProfile(sourceUrl?: string): SubtitleSelectorProfile {
  if (!sourceUrl) {
    return DEFAULT_PROFILE;
  }

  return isAssemblyPlenaryUrl(sourceUrl) ? PLENARY_PROFILE : COMMITTEE_PROFILE;
}

export function getSubtitleContainerSelectors(sourceUrl?: string): string[] {
  return [...resolveSubtitleSelectorProfile(sourceUrl).containerSelectors];
}

export function getSubtitleSelectorCandidates(
  primarySelector = "",
  extras: string[] = [],
  sourceUrl?: string,
): string[] {
  const profile = resolveSubtitleSelectorProfile(sourceUrl);
  const priorityMap = PROFILE_PRIORITY_MAP.get(profile.id) ?? PROFILE_PRIORITY_MAP.get("default")!;
  const candidates: string[] = [];
  pushUnique(candidates, primarySelector);
  profile.orderedSelectors.forEach((selector) => pushUnique(candidates, selector));
  extras.forEach((selector) => pushUnique(candidates, selector));

  return [...candidates].sort(
    (left, right) =>
      scoreSelector(left, primarySelector, priorityMap) -
      scoreSelector(right, primarySelector, priorityMap),
  );
}

export function normalizeSubtitleContainerText(node: HTMLElement, sourceUrl?: string): string {
  const raw = node.innerText || node.textContent || "";
  const text = normalizeSubtitleText(raw);
  if (!text) {
    return "";
  }

  if (text.length <= 400 || resolveSubtitleSelectorProfile(sourceUrl).preserveFullContainerText) {
    return text;
  }

  return normalizeSubtitleText(extractTailLines(raw, 3));
}

export function isElementActuallyVisible(element: HTMLElement | null): boolean {
  if (!element || element.hidden) {
    return false;
  }

  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") {
    return false;
  }

  const opacity = Number.parseFloat(style.opacity || "1");
  if (Number.isFinite(opacity) && opacity <= 0) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}
