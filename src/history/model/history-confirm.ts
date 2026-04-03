import type { SessionRecord } from "../../core/subtitle-models";
import type { SessionLibraryPreview } from "../../storage/types";

export function confirmDeleteSession(target: SessionRecord): boolean {
  if (typeof window === "undefined" || typeof window.confirm !== "function") {
    return true;
  }

  const title = target.committeeName || target.title;
  return window.confirm(`선택한 기록을 삭제할까요?\n${title}`);
}

export function confirmDeleteSessions(
  targets: SessionRecord[],
  scopeLabel: string,
  extraNotice?: string,
): boolean {
  if (!targets.length) {
    return false;
  }

  if (typeof window === "undefined" || typeof window.confirm !== "function") {
    return true;
  }

  const previewTitles = targets
    .slice(0, 3)
    .map((target) => `- ${target.committeeName || target.title}`)
    .join("\n");
  const moreLabel = targets.length > 3 ? `\n외 ${targets.length - 3}건` : "";

  return window.confirm(
    `${scopeLabel} 기록 ${targets.length}건을 삭제할까요?\n\n${previewTitles}${moreLabel}${extraNotice ? `\n\n${extraNotice}` : ""}`,
  );
}

export function confirmDeleteSessionLibrary(
  overview: {
    totalCount: number;
    previewSessions: SessionLibraryPreview[];
  },
  extraNotice?: string,
): boolean {
  if (!overview.totalCount) {
    return false;
  }

  if (typeof window === "undefined" || typeof window.confirm !== "function") {
    return true;
  }

  const previewTitles = overview.previewSessions
    .map((target) => `- ${target.committeeName || target.title}`)
    .join("\n");
  const moreLabel =
    overview.totalCount > overview.previewSessions.length
      ? `\n외 ${overview.totalCount - overview.previewSessions.length}건`
      : "";

  return window.confirm(
    `전체 기록 ${overview.totalCount}건을 삭제할까요?\n\n${previewTitles}${moreLabel}${extraNotice ? `\n\n${extraNotice}` : ""}`,
  );
}

export function confirmDiscardUnsavedNote(actionLabel: string): boolean {
  if (typeof window === "undefined" || typeof window.confirm !== "function") {
    return true;
  }

  return window.confirm(`저장하지 않은 메모가 있습니다. ${actionLabel} 전에 변경 내용을 버릴까요?`);
}
