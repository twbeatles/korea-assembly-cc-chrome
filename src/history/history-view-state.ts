import type { SessionRecord } from "../core/subtitle-models";
import { sanitizeSettings } from "../storage/settings-store";
import type { ExtensionSettings } from "../storage/types";

export interface HistoryViewSettings {
  recentCopyLineCount: number;
  filenamePattern: string;
}

export function buildHistoryRefreshMessage(sessionCount: number): string {
  return sessionCount ? "최신 기록부터 보여주고 있습니다." : "저장된 기록이 없습니다.";
}

export function buildSelectedDeleteMessage(
  requestedCount: number,
  deletedCount: number,
  failedCount: number,
): string {
  if (failedCount <= 0) {
    return `선택한 기록 ${deletedCount}건을 삭제했습니다.`;
  }

  if (deletedCount <= 0) {
    return `선택한 기록 ${requestedCount}건을 삭제하지 못했습니다.`;
  }

  return `선택한 기록 ${deletedCount}건을 삭제했고 ${failedCount}건은 삭제하지 못했습니다.`;
}

export function buildDeleteAllSuccessMessage(totalCount: number): string {
  return `저장된 기록 ${totalCount}건을 모두 삭제했습니다.`;
}

export function buildDeleteAllFailureMessage(detail?: string): string {
  const base = "저장된 기록 전체 삭제를 완료하지 못했습니다. 남은 기록을 다시 확인해주세요.";
  return detail ? `${base} ${detail}` : base;
}

export function selectHistoryViewSettings(
  settings: Pick<ExtensionSettings, "recentCopyLineCount" | "filenamePattern">,
): HistoryViewSettings {
  return {
    recentCopyLineCount: settings.recentCopyLineCount,
    filenamePattern: settings.filenamePattern,
  };
}

export function extractHistoryViewSettings(storedValue: unknown): HistoryViewSettings {
  const sanitized = sanitizeSettings(
    (storedValue && typeof storedValue === "object"
      ? storedValue
      : {}) as Partial<ExtensionSettings>,
  );
  return selectHistoryViewSettings(sanitized);
}

export function resolveSelectedSessionId(
  currentSelectedId: string,
  sessions: Array<Pick<SessionRecord, "id">>,
): string {
  if (sessions.some((session) => session.id === currentSelectedId)) {
    return currentSelectedId;
  }

  return sessions[0]?.id ?? "";
}

export function resolveSelectedSessionIds(
  currentSelectedIds: string[],
  sessions: Array<Pick<SessionRecord, "id">>,
): string[] {
  const availableIds = new Set(sessions.map((session) => session.id));
  return currentSelectedIds.filter((id) => availableIds.has(id));
}

export function toggleSelectedSessionId(
  currentSelectedIds: string[],
  sessionId: string,
): string[] {
  const next = new Set(currentSelectedIds);
  if (next.has(sessionId)) {
    next.delete(sessionId);
  } else {
    next.add(sessionId);
  }
  return [...next];
}

export function selectAllSessionIds(
  sessions: Array<Pick<SessionRecord, "id">>,
): string[] {
  return sessions.map((session) => session.id);
}
