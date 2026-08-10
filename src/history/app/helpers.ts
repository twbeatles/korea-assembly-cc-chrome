import {
  resolveSessionSegmentNumber,
  type ExportFormat,
  type SessionRecord,
  type SubtitleEntry,
} from "../../core/subtitle-models";
import { exportJson } from "../../core/exporters/json";
import { normalizeSessionForExport } from "../../core/exporters/normalize-session";
import { resolveSpeakerLabelForOutput } from "../../core/exporters/speaker-label";
import { exportSrt } from "../../core/exporters/srt";
import { exportTxt } from "../../core/exporters/txt";
import { exportVtt } from "../../core/exporters/vtt";
import { getUtf8ByteLength } from "../../shared/byte-size";
import { isSupportedAssemblyUrl } from "../../shared/constants";
import type {
  SessionImportSummary,
  SessionLibraryPreview,
  SessionLongTaskProgress,
} from "../../storage/types";

export const EXPORT_FORMATS: ExportFormat[] = [
  "txt",
  "srt",
  "vtt",
  "json",
  "md",
  "csv",
];
export const HISTORY_PAGE_SIZE = 200;
export const LARGE_LINEAGE_EXPORT_WARNING_BYTES = 8 * 1024 * 1024;

export type HistoryLongTaskState = SessionLongTaskProgress & {
  cancellable: boolean;
  cancelRequested: boolean;
};

export function parseTagInput(value: string): string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
        .map((tag) => tag.slice(0, 80)),
    ),
  ].slice(0, 50);
}

export function parseLabelInput(value: string): string[] {
  return parseTagInput(value).slice(0, 20);
}

export function formatTagInput(tags: string[] | undefined): string {
  return (tags ?? []).join(", ");
}

export function resolveSpeakerLabel(
  session: SessionRecord,
  entry: SubtitleEntry,
): string {
  return resolveSpeakerLabelForOutput(entry, session, {
    unknownLabel: "알 수 없음",
  });
}

export function computeSplitTime(
  startMs: number,
  endMs: number,
  index: number,
  total: number,
): string {
  const span = Math.max(1, endMs - startMs);
  return new Date(startMs + Math.floor((span * index) / total)).toISOString();
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function isSessionImportSummary(value: unknown): value is SessionImportSummary {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<SessionImportSummary>;
  return (
    typeof candidate.addedCount === "number" &&
    typeof candidate.updatedCount === "number" &&
    typeof candidate.keptCount === "number" &&
    typeof candidate.failedCount === "number"
  );
}

export function extractCancelledImportSummary(
  error: unknown,
): SessionImportSummary | null {
  if (!error || typeof error !== "object" || !("summary" in error)) {
    return null;
  }

  return isSessionImportSummary(error.summary) ? error.summary : null;
}

export function getLongTaskPhaseLabel(phase: string): string {
  switch (phase) {
    case "read":
      return "파일 읽기";
    case "parse":
      return "JSON 파싱";
    case "sanitize":
      return "기록 정리";
    case "compare":
      return "기존 기록 비교";
    case "write":
      return "기록 저장";
    case "prepare":
      return "준비";
    case "collect":
      return "기록 수집";
    case "package":
      return "백업 파일 생성";
    case "download":
      return "다운로드 준비";
    default:
      return phase;
  }
}

export function formatDate(value: string | null): string {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString("ko-KR");
}

export function getSessionSegmentLabel(
  session: Pick<SessionRecord, "segmentNumber">,
): string {
  return `세그먼트 ${resolveSessionSegmentNumber(session.segmentNumber)}`;
}

export function canReopenSourceUrl(sourceUrl: string | null | undefined): sourceUrl is string {
  return typeof sourceUrl === "string" && isSupportedAssemblyUrl(sourceUrl);
}

export function estimateSessionExportBytes(
  session: SessionRecord,
  txtExportTimestampsEnabled: boolean,
  txtExportSpeakerEnabled = false,
): number {
  const includeSpeaker = txtExportSpeakerEnabled === true;
  const normalized = normalizeSessionForExport(session, {
    stripSpeakerMetadata: !includeSpeaker,
  });
  return Math.max(
    getUtf8ByteLength(
      exportTxt(normalized, {
        includeTimestamps: txtExportTimestampsEnabled,
        includeSpeaker,
      }),
    ),
    getUtf8ByteLength(exportSrt(normalized, { includeSpeaker })),
    getUtf8ByteLength(exportVtt(normalized, { includeSpeaker })),
    // JSON 은 항상 발언자 메타를 포함하므로 원본 세션 기준
    getUtf8ByteLength(exportJson(normalizeSessionForExport(session, { stripSpeakerMetadata: false }))),
  );
}

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

  return window.confirm(
    `저장하지 않은 메모가 있습니다. ${actionLabel} 전에 변경 내용을 버릴까요?`,
  );
}
