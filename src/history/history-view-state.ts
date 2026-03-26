import type { SessionRecord, SubtitleEntry } from "../core/subtitle-models";
import { sanitizeSettings } from "../storage/settings-store";
import type { ExtensionSettings } from "../storage/types";

export interface HistoryViewSettings {
  recentCopyLineCount: number;
  filenamePattern: string;
  exportTxtWithoutTimestamps: boolean;
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

export function buildSessionImportMessage(input: {
  addedCount: number;
  updatedCount: number;
  keptCount: number;
  failedCount: number;
  invalidCount: number;
}): string {
  const parts = [
    `추가 ${input.addedCount}건`,
    `갱신 ${input.updatedCount}건`,
    `유지 ${input.keptCount}건`,
    `실패 ${input.failedCount}건`,
    `무효 ${input.invalidCount}건`,
  ];
  return `JSON 가져오기를 완료했습니다. ${parts.join(" / ")}`;
}

export function selectHistoryViewSettings(
  settings: Pick<
    ExtensionSettings,
    "recentCopyLineCount" | "filenamePattern" | "exportTxtWithoutTimestamps"
  >,
): HistoryViewSettings {
  return {
    recentCopyLineCount: settings.recentCopyLineCount,
    filenamePattern: settings.filenamePattern,
    exportTxtWithoutTimestamps: settings.exportTxtWithoutTimestamps,
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

export function resolveSelectedEntryIds(
  currentSelectedIds: string[],
  entries: Array<Pick<SubtitleEntry, "id">>,
): string[] {
  const availableIds = new Set(entries.map((entry) => entry.id));
  return currentSelectedIds.filter((id) => availableIds.has(id));
}

export function toggleSelectedEntryId(
  currentSelectedIds: string[],
  entryId: string,
): string[] {
  const next = new Set(currentSelectedIds);
  if (next.has(entryId)) {
    next.delete(entryId);
  } else {
    next.add(entryId);
  }
  return [...next];
}

export function selectAllEntryIds(
  entries: Array<Pick<SubtitleEntry, "id">>,
): string[] {
  return entries.map((entry) => entry.id);
}
