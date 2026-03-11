import { PIPELINE_DEFAULTS } from "../shared/constants";
import type { DomProbeOptions, DomProbeResult } from "./dom-probe";
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
      const parentWin: Window = currentWindow.parent;
      const frameElement = currentWindow.frameElement as HTMLIFrameElement | HTMLFrameElement | null;
      if (!frameElement) {
        break;
      }

      const siblings = Array.from(
        parentWin.document.querySelectorAll<HTMLIFrameElement | HTMLFrameElement>(
          "iframe, frame",
        ),
      );
      const index = siblings.indexOf(frameElement);
      if (index < 0) {
        break;
      }

      path.unshift(index);
      currentWindow = parentWin;
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

function probeDocumentRoots(
  rootDocument: Document,
  selectors: string[],
  options?: DomProbeOptions,
): FrameProbeResult {
  const rootCandidates: ParentNode[] = [rootDocument];
  if (rootDocument.body) {
    rootCandidates.push(rootDocument.body);
  }
  if (rootDocument.documentElement && rootDocument.documentElement !== rootDocument.body) {
    rootCandidates.push(rootDocument.documentElement);
  }

  let best = emptyFrameProbe();
  for (const root of rootCandidates) {
    const result = readSubtitleTextBySelectors(root, selectors, options);
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
  options?: DomProbeOptions,
): void {
  if (
    depth > PIPELINE_DEFAULTS.frameProbeMaxDepth ||
    results.length >= PIPELINE_DEFAULTS.frameProbeMaxFrames
  ) {
    return;
  }

  const current = probeDocumentRoots(rootDocument, selectors, options);
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
      walkDocuments(childDocument, selectors, [...path, index], depth + 1, results, options);
    } catch {
      // Cross-origin frame access is intentionally ignored.
    }
  });
}

function getDocumentByFramePath(framePath: number[]): Document | null {
  let currentDocument: Document = document;

  for (const index of framePath) {
    const frames = Array.from(
      currentDocument.querySelectorAll<HTMLIFrameElement | HTMLFrameElement>("iframe, frame"),
    );
    const frame = frames[index];
    if (!frame) {
      return null;
    }

    try {
      if (!frame.contentDocument) {
        return null;
      }
      currentDocument = frame.contentDocument;
    } catch {
      return null;
    }
  }

  return currentDocument;
}

export function probeAccessibleFrames(
  primarySelector = "",
  options?: DomProbeOptions,
): FrameProbeResult[] {
  const selectors = getSubtitleSelectorCandidates(primarySelector);
  const results: FrameProbeResult[] = [];
  walkDocuments(document, selectors, [], 0, results, options);
  return results.sort((left, right) => scoreFrameResult(right, selectors) - scoreFrameResult(left, selectors));
}

export function probeTopDocument(primarySelector = "", options?: DomProbeOptions): FrameProbeResult {
  const selectors = getSubtitleSelectorCandidates(primarySelector);
  const direct = estimateRecentRaw(document, primarySelector, options);
  if (direct.found) {
    return {
      ...direct,
      framePath: [],
    };
  }

  return probeDocumentRoots(document, selectors, options);
}

export function probeFramePath(
  framePath: number[],
  primarySelector = "",
  options?: DomProbeOptions,
): FrameProbeResult {
  if (!framePath.length) {
    return probeTopDocument(primarySelector, options);
  }

  const targetDocument = getDocumentByFramePath(framePath);
  if (!targetDocument) {
    return emptyFrameProbe(framePath);
  }

  const selectors = getSubtitleSelectorCandidates(primarySelector);
  const result = probeDocumentRoots(targetDocument, selectors, options);
  if (!result.found) {
    return emptyFrameProbe(framePath);
  }

  return {
    ...result,
    framePath: [...framePath],
  };
}

export function probeBestAccessibleSubtitle(
  primarySelector = "",
  options?: DomProbeOptions,
): FrameProbeResult {
  const topResult = probeTopDocument(primarySelector, options);
  if (topResult.found) {
    return topResult;
  }

  const results = probeAccessibleFrames(primarySelector, options);
  return results[0] ?? emptyFrameProbe();
}
