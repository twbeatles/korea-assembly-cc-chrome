import type { DomProbeOptions } from "./dom-probe";
import { probeBestAccessibleSubtitle, probeFramePath, type FrameProbeResult } from "./frame-probe";

interface AccessibleDocument {
  key: string;
  framePath: number[];
  root: Document;
}

interface CaptureCoordinatorUpdate {
  probe: FrameProbeResult;
  now: number;
  observerActive: boolean;
}

interface CaptureCoordinatorReset {
  now: number;
  observerActive: boolean;
}

interface CaptureCoordinatorOptions {
  getPrimarySelector: () => string;
  getPollingIntervalMs: () => number;
  getProbeOptions: () => DomProbeOptions;
  onUpdate: (update: CaptureCoordinatorUpdate) => void;
  onReset: (reset: CaptureCoordinatorReset) => void;
  onMiss?: () => void;
  onError: (error: unknown) => void;
}

interface ObservedTarget {
  observer: MutationObserver;
  target: Node;
}

export interface CaptureCoordinator {
  start: () => void;
  stop: () => void;
  refresh: () => void;
  scheduleTick: (delayMs?: number) => void;
  getObserverActive: () => boolean;
}

function buildFramePathKey(framePath: number[]): string {
  return framePath.length ? framePath.join(".") : "top";
}

function collectAccessibleDocuments(
  root: Document,
  framePath: number[] = [],
  depth = 0,
  maxDepth = 3,
  results: AccessibleDocument[] = [],
): AccessibleDocument[] {
  results.push({
    key: buildFramePathKey(framePath),
    framePath: [...framePath],
    root,
  });

  if (depth >= maxDepth) {
    return results;
  }

  const frames = Array.from(
    root.querySelectorAll<HTMLIFrameElement | HTMLFrameElement>("iframe, frame"),
  );

  frames.forEach((frameElement, index) => {
    try {
      const childDocument = frameElement.contentDocument;
      if (!childDocument) {
        return;
      }

      collectAccessibleDocuments(
        childDocument,
        [...framePath, index],
        depth + 1,
        maxDepth,
        results,
      );
    } catch {
      // Cross-origin frame access is intentionally ignored.
    }
  });

  return results;
}

function resolveObserverTarget(root: Document): Node | null {
  const subtitleTarget = root.querySelector("#viewSubtit");

  return (
    subtitleTarget?.parentNode ??
    subtitleTarget ??
    root.body ??
    root.documentElement ??
    null
  );
}

export function createCaptureCoordinator(
  options: CaptureCoordinatorOptions,
): CaptureCoordinator {
  const observedTargets = new Map<string, ObservedTarget>();
  let running = false;
  let hadVisibleSubtitle = false;
  let lastSuccessfulFramePath: number[] | null = null;
  let pollTimer: number | null = null;
  let scheduledTick: number | null = null;

  function clearPollTimer(): void {
    if (pollTimer !== null) {
      window.clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  function clearScheduledTick(): void {
    if (scheduledTick !== null) {
      window.clearTimeout(scheduledTick);
      scheduledTick = null;
    }
  }

  function schedulePoll(): void {
    clearPollTimer();
    if (!running) {
      return;
    }

    pollTimer = window.setTimeout(() => {
      pollTimer = null;
      runTick();
    }, Math.max(100, options.getPollingIntervalMs()));
  }

  function getObserverActive(): boolean {
    return observedTargets.size > 0;
  }

  function refresh(): void {
    const nextDocuments = collectAccessibleDocuments(document);
    const nextKeys = new Set(nextDocuments.map((item) => item.key));

    observedTargets.forEach((observed, key) => {
      if (nextKeys.has(key)) {
        return;
      }
      observed.observer.disconnect();
      observedTargets.delete(key);
    });

    nextDocuments.forEach((item) => {
      const target = resolveObserverTarget(item.root);
      if (!target) {
        const stale = observedTargets.get(item.key);
        if (stale) {
          stale.observer.disconnect();
          observedTargets.delete(item.key);
        }
        return;
      }

      const current = observedTargets.get(item.key);
      if (current?.target === target) {
        return;
      }

      if (current) {
        current.observer.disconnect();
        observedTargets.delete(item.key);
      }

      const observer = new MutationObserver(() => {
        scheduleTick(0);
      });
      observer.observe(target, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["style", "class"],
      });
      observedTargets.set(item.key, { observer, target });
    });
  }

  function runTick(): void {
    clearScheduledTick();
    if (!running) {
      return;
    }

    refresh();

    try {
      const probeOptions = options.getProbeOptions();
      const primarySelector = options.getPrimarySelector();
      const cachedProbe =
        lastSuccessfulFramePath && lastSuccessfulFramePath.length > 0
          ? probeFramePath(lastSuccessfulFramePath, primarySelector, probeOptions)
          : null;
      const probe =
        cachedProbe && cachedProbe.found && cachedProbe.text
          ? cachedProbe
          : probeBestAccessibleSubtitle(primarySelector, probeOptions);
      const now = Date.now();
      const observerActive = getObserverActive();

      if (!probe.found || !probe.text) {
        lastSuccessfulFramePath = null;
        if (hadVisibleSubtitle) {
          hadVisibleSubtitle = false;
          options.onReset({ now, observerActive });
        }
        options.onMiss?.();
      } else {
        hadVisibleSubtitle = true;
        lastSuccessfulFramePath = [...probe.framePath];
        options.onUpdate({ probe, now, observerActive });
      }
    } catch (error) {
      options.onError(error);
    }

    schedulePoll();
  }

  function scheduleTick(delayMs = 0): void {
    clearScheduledTick();
    if (!running) {
      return;
    }

    scheduledTick = window.setTimeout(() => {
      scheduledTick = null;
      runTick();
    }, Math.max(0, delayMs));
  }

  function stop(): void {
    running = false;
    hadVisibleSubtitle = false;
    lastSuccessfulFramePath = null;
    clearPollTimer();
    clearScheduledTick();
    observedTargets.forEach((observed) => {
      observed.observer.disconnect();
    });
    observedTargets.clear();
  }

  function start(): void {
    stop();
    running = true;
    refresh();
    scheduleTick(0);
  }

  return {
    start,
    stop,
    refresh,
    scheduleTick,
    getObserverActive,
  };
}
