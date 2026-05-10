import type { SessionRecord, SubtitleEntry } from "../subtitle-models";

function escapeCsv(value: string | boolean): string {
  const raw = String(value ?? "");
  if (/[",\r\n]/.test(raw)) {
    return `"${raw.replaceAll('"', '""')}"`;
  }
  return raw;
}

function resolveSpeaker(session: SessionRecord, entry: SubtitleEntry): string {
  if (entry.speakerLabel?.trim()) {
    return entry.speakerLabel.trim();
  }
  const channel = entry.speakerChannel ?? "unknown";
  const label = session.speakerLabels?.[channel]?.trim();
  if (label) {
    return label;
  }
  switch (channel) {
    case "primary":
      return "발언자 A";
    case "secondary":
      return "발언자 B";
    default:
      return "";
  }
}

export function exportCsv(session: SessionRecord): string {
  const rows = [
    ["startTime", "endTime", "speaker", "text", "highlighted", "note", "labels"],
    ...session.entries.map((entry) => [
      entry.startTime,
      entry.endTime,
      resolveSpeaker(session, entry),
      entry.text,
      entry.highlighted ? "true" : "false",
      entry.entryNote ?? "",
      entry.labels?.join("; ") ?? "",
    ]),
  ];

  return `${rows.map((row) => row.map(escapeCsv).join(",")).join("\n")}\n`;
}

