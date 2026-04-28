import type { CaptureMode } from "../core/live-capture";
import type {
  CaptureDiagnostics,
  FallbackCommitState,
  PersistabilityState,
  RowKeySource,
} from "./message-types";

export function resolveCaptureSourceLabel(
  captureMode: CaptureMode,
  observerActive: boolean,
): string {
  if (!observerActive) {
    return captureMode === "idle" ? "대기 중" : "polling";
  }

  if (captureMode === "structured") {
    return "structured";
  }

  if (captureMode === "fallback") {
    return "fallback";
  }

  return "대기 중";
}

export function formatCaptureDiagnosticsFramePath(framePath: number[]): string {
  return framePath.length ? framePath.join(" > ") : "top";
}

export function buildCaptureDiagnostics(input: {
  captureMode: CaptureMode;
  observerActive: boolean;
  currentSelector: string;
  currentFramePath: number[];
  persistabilityState?: PersistabilityState;
  persistabilityHint?: string;
  stableRowCount?: number;
  unstableRowCount?: number;
  filteredUnconfirmedCount?: number;
  rowKeySources?: Partial<Record<RowKeySource, number>>;
  fallbackCommitState?: FallbackCommitState;
  segment?: CaptureDiagnostics["segment"];
  exportEstimates?: CaptureDiagnostics["exportEstimates"];
}): CaptureDiagnostics {
  return {
    captureMode: input.captureMode,
    observerActive: input.observerActive,
    currentSelector: input.currentSelector,
    currentFramePath: [...input.currentFramePath],
    sourceLabel: resolveCaptureSourceLabel(input.captureMode, input.observerActive),
    persistabilityState: input.persistabilityState ?? "idle",
    persistabilityHint: input.persistabilityHint ?? "",
    stableRowCount: input.stableRowCount ?? 0,
    unstableRowCount: input.unstableRowCount ?? 0,
    filteredUnconfirmedCount: input.filteredUnconfirmedCount ?? 0,
    rowKeySources: {
      ...(input.rowKeySources ?? {}),
    },
    fallbackCommitState: input.fallbackCommitState ?? "idle",
    ...(input.segment
      ? {
          segment: {
            ...input.segment,
          },
        }
      : {}),
    ...(input.exportEstimates
      ? {
          exportEstimates: {
            ...input.exportEstimates,
          },
        }
      : {}),
  };
}
