import type { ExportFormat, SessionRecord, SubtitleEntry } from "./subtitle-models";

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

export function toDate(value: string | number | Date): Date {
  if (value instanceof Date) {
    return value;
  }
  return new Date(value);
}

export function toIsoString(value: string | number | Date): string {
  return toDate(value).toISOString();
}

export function formatClockTime(value: string | number | Date): string {
  const date = toDate(value);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatDurationMs(value: number, separator: "," | "."): string {
  const safeValue = Math.max(0, Math.floor(value));
  const hours = Math.floor(safeValue / 3_600_000);
  const minutes = Math.floor((safeValue % 3_600_000) / 60_000);
  const seconds = Math.floor((safeValue % 60_000) / 1000);
  const milliseconds = safeValue % 1000;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}${separator}${pad(milliseconds, 3)}`;
}

function formatCueTime(value: string | number | Date, separator: "," | "."): string {
  const date = toDate(value);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${separator}${pad(date.getMilliseconds(), 3)}`;
}

export function formatSrtTime(value: string | number | Date): string {
  return formatCueTime(value, ",");
}

export function formatVttTime(value: string | number | Date): string {
  return formatCueTime(value, ".");
}

export function formatSrtDuration(valueMs: number): string {
  return formatDurationMs(valueMs, ",");
}

export function formatVttDuration(valueMs: number): string {
  return formatDurationMs(valueMs, ".");
}

export function resolveEntryRange(entry: SubtitleEntry, fallbackDurationMs = 1000): [Date, Date] {
  const start = toDate(entry.startTime || entry.timestamp);
  const end = entry.endTime ? toDate(entry.endTime) : new Date(start.getTime() + fallbackDurationMs);
  if (end.getTime() <= start.getTime()) {
    return [start, new Date(start.getTime() + fallbackDurationMs)];
  }
  return [start, end];
}

export function differenceSeconds(start: string | number | Date, end: string | number | Date): number {
  return Math.max(0, (toDate(end).getTime() - toDate(start).getTime()) / 1000);
}

export function bucketBySeconds(value: string | number | Date, bucketSeconds: number): number {
  return Math.floor(toDate(value).getTime() / 1000 / bucketSeconds);
}

export function sanitizeFilenamePart(value: string): string {
  const normalized = String(value ?? "")
    .replace(/[\\/*?:"<>|]/g, "")
    .trim();
  return normalized || "assembly_subtitles";
}

export function buildExportFilename(
  session: SessionRecord,
  format: ExportFormat,
  filenamePattern = "{date}_{committee}_{time}",
): string {
  const baseDate = toDate(session.startedAt || session.createdAt || new Date());
  const date = `${baseDate.getFullYear()}${pad(baseDate.getMonth() + 1)}${pad(baseDate.getDate())}`;
  const time = `${pad(baseDate.getHours())}${pad(baseDate.getMinutes())}${pad(baseDate.getSeconds())}`;
  const committee = sanitizeFilenamePart(
    session.committeeName || session.title || "assembly_subtitles",
  );
  const basename = (filenamePattern || "{date}_{committee}_{time}")
    .replaceAll("{date}", date)
    .replaceAll("{time}", time)
    .replaceAll("{committee}", committee)
    .trim();

  return `${basename || `${date}_${committee}_${time}`}.${format}`;
}
