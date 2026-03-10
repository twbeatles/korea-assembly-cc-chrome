import { PIPELINE_DEFAULTS } from "../shared/constants";
import type { DomProbeResult } from "./dom-probe";
import {
  estimateRecentRaw,
  getSubtitleSelectorCandidates,
  readSubtitleTextBySelectors,
} from "./dom-probe";

export interface FrameProbeResult extends DomProbeResult {
  framePath: number[];
}

function emptyFrameProbe(framePath: number[] = []): FrameProbeResult {
  return {
    text: "",
    matchedSelector: "",
    found: false,
    framePath,
  };
}

export function computeCurrentFramePath(win: Window = window): number[] {
  const path: number[] = [];
  let currentWindow: Window | null = win;

  while (currentWindow && currentWindow !== currentWindow.top) {
    try {
      const parentWindow = currentWindow.parent;
      const frameElement = currentWindow.frameElement as HTMLIFrameElement | HTMLFrameElement | null;
      if (!frameElement) {
        break;
      }

      const siblings = Array.from(
        parentWindow.document.querySelectorAll<HTMLIFrameElement | HTMLFrameElement>(
          "iframe, frame",
        ),
      );
      const index = siblings.indexOf(frameElement);
      if (index < 0) {
        break;
      }

      path.unshift(index);
      currentWindow = parentWindow;
    } catch {
      break;
    }
  }

  return path;
}

function scoreFrameResult(result: FrameProbeResult, selectors: string[]): number {
  if (!result.found || !result.text) {
    return -1;
  }

  const selectorIndex = selectors.indexOf(result.matchedSelector);
  const selectorScore =
    selectorIndex >= 0 && selectors.length
      ? Math.max(0, selectors.length - selectorIndex)
      : 0;
  const modeScore = result.sourceMode === "smi-window" ? 15 : 8;
  const pathPenalty = result.framePath.length * 2;
  const textScore = Math.min(120, result.text.length);
  return selectorScore * 20 + modeScore + textScore - pathPenalty;
}

function chooseBetterResult(
  current: FrameProbeResult,
  candidate: FrameProbeResult,
  selectors: string[],
): FrameProbeResult {
  return scoreFrameResult(candidate, selectors) > scoreFrameResult(current, selectors)
    ? candidate
    : current;
}

function probeDocumentRoots(rootDocument: Document, selectors: string[]): FrameProbeResult {
  const rootCandidates: ParentNode[] = [rootDocument];
  if (rootDocument.body) {
    rootCandidates.push(rootDocument.body);
  }
  if (rootDocument.documentElement && rootDocument.documentElement !== rootDocument.body) {
    rootCandidates.push(rootDocument.documentElement);
  }

  let best = emptyFrameProbe();
  for (const root of rootCandidates) {
    const result = readSubtitleTextBySelectors(root, selectors);
    if (!result.found) {
      continue;
    }
    best = chooseBetterResult(best, { ...result, framePath: [] }, selectors);
    if (result.sourceMode === "smi-window") {
      return best;
    }
  }

  return best;
}

function walkDocuments(
  rootDocument: Document,
  selectors: string[],
  path: number[],
  depth: number,
  results: FrameProbeResult[],
): void {
  if (
    depth > PIPELINE_DEFAULTS.frameProbeMaxDepth ||
    results.length >= PIPELINE_DEFAULTS.frameProbeMaxFrames
  ) {
    return;
  }

  const current = probeDocumentRoots(rootDocument, selectors);
  if (current.found) {
    results.push({
      ...current,
      framePath: [...path],
    });
  }

  const frames = Array.from(
    rootDocument.querySelectorAll<HTMLIFrameElement | HTMLFrameElement>("iframe, frame"),
  );

  frames.forEach((frameElement, index) => {
    if (results.length >= PIPELINE_DEFAULTS.frameProbeMaxFrames) {
      return;
    }

    try {
      const childDocument = frameElement.contentDocument;
      if (!childDocument) {
        return;
      }
      walkDocuments(childDocument, selectors, [...path, index], depth + 1, results);
    } catch {
      // Cross-origin frame access is intentionally ignored.
    }
  });
}

export function probeAccessibleFrames(primarySelector = ""): FrameProbeResult[] {
  const selectors = getSubtitleSelectorCandidates(primarySelector);
  const results: FrameProbeResult[] = [];
  walkDocuments(document, selectors, [], 0, results);
  return results.sort((left, right) => scoreFrameResult(right, selectors) - scoreFrameResult(left, selectors));
}

export function probeTopDocument(primarySelector = ""): FrameProbeResult {
  const selectors = getSubtitleSelectorCandidates(primarySelector);
  const direct = estimateRecentRaw(document, primarySelector);
  if (direct.found) {
    return {
      ...direct,
      framePath: [],
    };
  }

  return probeDocumentRoots(document, selectors);
}

export function probeBestAccessibleSubtitle(primarySelector = ""): FrameProbeResult {
  const topResult = probeTopDocument(primarySelector);
  if (topResult.found) {
    return topResult;
  }

  const results = probeAccessibleFrames(primarySelector);
  return results[0] ?? emptyFrameProbe();
}
