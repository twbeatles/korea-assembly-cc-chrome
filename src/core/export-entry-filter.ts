import type { SubtitleEntry } from "./subtitle-models";

export interface ExportTimeRange {
  from?: string;
  to?: string;
}

function entryTimestampMs(entry: SubtitleEntry): number {
  const parsed = Date.parse(entry.startTime || entry.timestamp || "");
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/**
 * 세션 시작 시각 기준이 아닌 entry 절대 시각(startTime)으로 from/to 필터.
 * from/to 는 ISO 문자열. 파싱 실패 필드는 무시한다.
 */
export function filterEntriesByTimeRange(
  entries: SubtitleEntry[],
  timeRange?: ExportTimeRange | null,
): SubtitleEntry[] {
  if (!Array.isArray(entries) || !entries.length) {
    return [];
  }
  if (!timeRange) {
    return entries;
  }

  const fromRaw = typeof timeRange.from === "string" ? timeRange.from.trim() : "";
  const toRaw = typeof timeRange.to === "string" ? timeRange.to.trim() : "";
  if (!fromRaw && !toRaw) {
    return entries;
  }

  const fromMs = fromRaw ? Date.parse(fromRaw) : Number.NEGATIVE_INFINITY;
  const toMs = toRaw ? Date.parse(toRaw) : Number.POSITIVE_INFINITY;
  const hasFrom = Number.isFinite(fromMs);
  const hasTo = Number.isFinite(toMs);
  if (!hasFrom && !hasTo) {
    return entries;
  }

  const lower = hasFrom ? fromMs : Number.NEGATIVE_INFINITY;
  const upper = hasTo ? toMs : Number.POSITIVE_INFINITY;

  return entries.filter((entry) => {
    const ms = entryTimestampMs(entry);
    if (!Number.isFinite(ms)) {
      return false;
    }
    return ms >= lower && ms <= upper;
  });
}
