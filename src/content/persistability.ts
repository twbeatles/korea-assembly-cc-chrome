import type { PersistabilityState } from "../shared/message-types";

export interface PersistabilityDiagnostics {
  state: PersistabilityState;
  hint: string;
}

export function resolvePersistabilityHint(state: PersistabilityState): string {
  switch (state) {
    case "persistable":
      return "저장 가능한 확정 자막이 누적되고 있습니다.";
    case "preview_only":
      return "화면에는 자막이 보이지만 아직 저장 가능한 확정 자막은 없습니다.";
    case "unstable_only":
      return "현재 감지된 자막 행이 아직 확정되지 않아 저장하지 않고 있습니다.";
    case "filtered":
      return "현재 감지된 내용이 noise filter에 걸려 저장하지 않고 있습니다.";
    case "duplicate":
      return "현재 감지된 내용이 최근 자막과 중복되어 저장하지 않고 있습니다.";
    case "idle":
    default:
      return "화면 자막을 기다리고 있습니다.";
  }
}

export function buildPersistabilityDiagnostics(
  state: PersistabilityState,
): PersistabilityDiagnostics {
  return {
    state,
    hint: resolvePersistabilityHint(state),
  };
}

export function resolvePreviewPersistabilityState(reason?: string): PersistabilityState {
  if (reason?.includes("duplicate")) {
    return "duplicate";
  }

  if (reason?.includes("filtered")) {
    return "filtered";
  }

  return "preview_only";
}
