import type { CaptureMode } from "../core/live-capture";
import type { CaptureDiagnostics, CaptureHealth, PersistabilityState } from "./message-types";

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
  entryCount?: number;
  charCount?: number;
  estimatedBytes?: number;
}): CaptureDiagnostics {
  const health = resolveCaptureHealth({
    persistabilityState: input.persistabilityState ?? "idle",
    captureMode: input.captureMode,
    observerActive: input.observerActive,
    entryCount: input.entryCount ?? 0,
    estimatedBytes: input.estimatedBytes ?? 0,
  });
  const sizeWarning = resolveCaptureSizeWarning(input.estimatedBytes ?? 0);
  return {
    captureMode: input.captureMode,
    observerActive: input.observerActive,
    currentSelector: input.currentSelector,
    currentFramePath: [...input.currentFramePath],
    sourceLabel: resolveCaptureSourceLabel(input.captureMode, input.observerActive),
    persistabilityState: input.persistabilityState ?? "idle",
    persistabilityHint: input.persistabilityHint ?? "",
    health,
    healthLabel: getCaptureHealthLabel(health),
    healthHint: getCaptureHealthHint(health),
    estimatedBytes: input.estimatedBytes ?? 0,
    sizeWarning,
  };
}

export function getPersistabilityUserMessage(state?: PersistabilityState, hint = ""): string {
  switch (state) {
    case "persistable":
      return "저장 가능한 확정 자막이 있습니다.";
    case "preview_only":
      return hint || "현재 보이는 자막은 아직 확정 전이라 저장되지 않습니다.";
    case "unstable_only":
      return hint || "인식 중인 자막만 있어 확정될 때까지 기다리고 있습니다.";
    case "filtered":
      return hint || "필터가 현재 자막을 제외했습니다. 필요하면 환경 설정에서 필터를 조정하세요.";
    case "duplicate":
      return hint || "최근 자막과 중복으로 판단되어 새 기록으로 저장하지 않았습니다.";
    default:
      return hint || "아직 저장할 확정 자막이 없습니다.";
  }
}

export function resolveCaptureSizeWarning(estimatedBytes: number): string {
  if (estimatedBytes >= 8 * 1024 * 1024) {
    return "세션이 커져 단일 파일 저장이 실패할 수 있습니다. 중간 저장 후 새 세션 시작을 권장합니다.";
  }
  if (estimatedBytes >= 4 * 1024 * 1024) {
    return "세션 크기가 커지고 있습니다. 장시간 회의라면 중간 저장을 고려하세요.";
  }
  return "";
}

export function resolveCaptureHealth(input: {
  persistabilityState: PersistabilityState;
  captureMode: CaptureMode;
  observerActive: boolean;
  entryCount: number;
  estimatedBytes: number;
}): CaptureHealth {
  if (input.estimatedBytes >= 8 * 1024 * 1024) {
    return "unstable";
  }
  if (input.persistabilityState === "filtered" || input.persistabilityState === "duplicate") {
    return input.entryCount > 0 ? "warning" : "unstable";
  }
  if (input.persistabilityState === "preview_only" || input.persistabilityState === "unstable_only") {
    return input.entryCount > 0 ? "warning" : "unstable";
  }
  if (input.captureMode === "fallback" || !input.observerActive || input.estimatedBytes >= 4 * 1024 * 1024) {
    return "warning";
  }
  return "good";
}

export function getCaptureHealthLabel(health: CaptureHealth): string {
  switch (health) {
    case "good":
      return "좋음";
    case "warning":
      return "주의";
    case "unstable":
      return "불안정";
  }
}

export function getCaptureHealthHint(health: CaptureHealth): string {
  switch (health) {
    case "good":
      return "자막이 안정적으로 수집되고 있습니다.";
    case "warning":
      return "수집은 가능하지만 fallback 또는 큰 세션 등 주의할 신호가 있습니다.";
    case "unstable":
      return "저장 가능한 자막이 없거나 수집/저장 안정성이 낮습니다.";
  }
}
