import type { SessionRecord } from "../subtitle-models";
import { resolveSpeakerLabelForOutput } from "./speaker-label";

const DANGEROUS_SPREADSHEET_PREFIX = /^[\t\r]*[=+\-@]/;

function escapeCsv(value: string | boolean): string {
  const raw = neutralizeSpreadsheetFormula(String(value ?? ""));
  if (/[",\r\n]/.test(raw)) {
    return `"${raw.replaceAll('"', '""')}"`;
  }
  return raw;
}

function neutralizeSpreadsheetFormula(value: string): string {
  return DANGEROUS_SPREADSHEET_PREFIX.test(value.trimStart()) ? `'${value}` : value;
}

/**
 * UTF-8 BOM (EF BB BF). Excel on Korean Windows opens BOM-less CSV as CP949/ANSI,
 * which mojibakes Hangul. Other apps ignore or strip a leading BOM safely.
 */
const UTF8_BOM = "\uFEFF";

export function exportCsv(
  session: SessionRecord,
  options: { includeSpeaker?: boolean } = {},
): string {
  // 기본 off — 옵션/패널 토글 on 일 때만 speaker 열 포함
  const includeSpeaker = options.includeSpeaker === true;
  const header = includeSpeaker
    ? ["startTime", "endTime", "speaker", "text", "highlighted", "note", "labels"]
    : ["startTime", "endTime", "text", "highlighted", "note", "labels"];
  const rows = [
    header,
    ...session.entries.map((entry) => {
      const base = [
        entry.startTime,
        entry.endTime,
        entry.text,
        entry.highlighted ? "true" : "false",
        entry.entryNote ?? "",
        entry.labels?.join("; ") ?? "",
      ];
      if (!includeSpeaker) {
        return base;
      }
      return [
        entry.startTime,
        entry.endTime,
        resolveSpeakerLabelForOutput(entry, session),
        entry.text,
        entry.highlighted ? "true" : "false",
        entry.entryNote ?? "",
        entry.labels?.join("; ") ?? "",
      ];
    }),
  ];

  // RFC 4180 prefers CRLF; Excel also handles CRLF more reliably than LF-only.
  const body = `${rows.map((row) => row.map(escapeCsv).join(",")).join("\r\n")}\r\n`;
  return `${UTF8_BOM}${body}`;
}

