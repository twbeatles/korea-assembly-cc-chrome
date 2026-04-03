import type { SessionRecord } from "../../core/subtitle-models";
import type { SessionSearchHit } from "../../storage/types";

export const HISTORY_PAGE_SIZE = 200;

export type SessionListRow = SessionRecord | SessionSearchHit;

export function formatDate(value: string | null): string {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString("ko-KR");
}

export function isSessionSearchHit(item: SessionListRow): item is SessionSearchHit {
  return "sessionId" in item;
}

export function getSessionRowId(item: SessionListRow): string {
  return isSessionSearchHit(item) ? item.sessionId : item.id;
}

export function getSessionRowTitle(item: SessionListRow): string {
  return item.committeeName || item.title;
}

export function getSessionRowStartedAt(item: SessionListRow): string {
  return item.startedAt;
}

export function getSessionRowSubtitleCount(item: SessionListRow): number {
  return item.subtitleCount;
}

export function getSessionRowCharCount(item: SessionListRow): number {
  return item.charCount;
}

export function getSessionRowStatus(item: SessionListRow): SessionRecord["status"] {
  return item.status;
}

export function getSessionRowStarred(item: SessionListRow): boolean {
  return item.starred;
}

export function getSessionRowHasNote(item: SessionListRow): boolean {
  return isSessionSearchHit(item) ? item.hasNote : Boolean(item.note.trim());
}

export function buildTranscriptSearchMessage(query: string, totalCount: number): string {
  return `전체 기록 검색 "${query}" 결과 ${totalCount}건입니다.`;
}
