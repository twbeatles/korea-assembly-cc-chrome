import type { SessionRecord } from "../core/subtitle-models";

export interface FailedStoppedSessionGuard {
  record: SessionRecord | null;
  errorMessage: string | null;
}

export interface ResolveFailedStoppedSessionGuardOptions {
  actionLabel: string;
  guard: FailedStoppedSessionGuard;
  persistRecord: (record: SessionRecord) => Promise<SessionRecord>;
  confirmDiscard: (message: string) => boolean;
}

export interface ResolveFailedStoppedSessionGuardResult {
  proceed: boolean;
  guard: FailedStoppedSessionGuard;
  persistedRecord?: SessionRecord;
  notice?: string;
}

function cloneSessionRecord(record: SessionRecord): SessionRecord {
  return {
    ...record,
    entries: record.entries.map((entry) => ({
      ...entry,
      sourceFramePath: entry.sourceFramePath ? [...entry.sourceFramePath] : undefined,
    })),
  };
}

function errorMessageOf(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  return "알 수 없는 오류";
}

function buildDiscardConfirmMessage(actionLabel: string, errorMessage: string): string {
  return [
    "이전 세션 저장이 실패한 상태입니다.",
    "다시 저장을 시도했지만 실패했습니다.",
    "",
    `계속하면 저장되지 않은 자막이 버려지고 ${actionLabel}를 진행합니다.`,
    "",
    `마지막 오류: ${errorMessage}`,
    "",
    "계속할까요?",
  ].join("\n");
}

export function createEmptyFailedStoppedSessionGuard(): FailedStoppedSessionGuard {
  return {
    record: null,
    errorMessage: null,
  };
}

export function rememberFailedStoppedSession(
  record: SessionRecord,
  error?: unknown,
): FailedStoppedSessionGuard {
  return {
    record: cloneSessionRecord(record),
    errorMessage: errorMessageOf(error),
  };
}

export function clearFailedStoppedSessionGuard(): FailedStoppedSessionGuard {
  return createEmptyFailedStoppedSessionGuard();
}

export async function resolveFailedStoppedSessionGuard(
  options: ResolveFailedStoppedSessionGuardOptions,
): Promise<ResolveFailedStoppedSessionGuardResult> {
  if (!options.guard.record) {
    return {
      proceed: true,
      guard: options.guard,
    };
  }

  const failedRecord = cloneSessionRecord(options.guard.record);

  try {
    const persistedRecord = await options.persistRecord(failedRecord);
    return {
      proceed: true,
      guard: clearFailedStoppedSessionGuard(),
      persistedRecord: cloneSessionRecord(persistedRecord),
      notice: "이전 저장 실패 세션을 다시 저장했습니다.",
    };
  } catch (error) {
    const retryErrorMessage = errorMessageOf(error);
    const discardConfirmed = options.confirmDiscard(
      buildDiscardConfirmMessage(options.actionLabel, retryErrorMessage),
    );

    if (!discardConfirmed) {
      return {
        proceed: false,
        guard: rememberFailedStoppedSession(failedRecord, retryErrorMessage),
        notice: "저장 실패한 이전 세션을 유지했습니다.",
      };
    }

    return {
      proceed: true,
      guard: clearFailedStoppedSessionGuard(),
      notice: "저장 실패한 이전 세션을 버리고 계속합니다.",
    };
  }
}
