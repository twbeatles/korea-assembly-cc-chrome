import type { SessionRecord, SubtitleEntry } from "../subtitle-models";
import { formatClockTime } from "../timeline";

function escapeMarkdown(value: string): string {
  return String(value ?? "").replaceAll("|", "\\|").trim();
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

export function exportMarkdown(session: SessionRecord): string {
  const lines = [
    `# ${escapeMarkdown(session.title || session.committeeName || "국회 자막 기록")}`,
    "",
    `- 위원회: ${escapeMarkdown(session.committeeName || "-")}`,
    `- 시작: ${session.startedAt}`,
    `- 종료: ${session.endedAt ?? "-"}`,
    `- 원본: ${session.sourceUrl || "-"}`,
  ];

  if (session.category?.trim()) {
    lines.push(`- 카테고리: ${escapeMarkdown(session.category)}`);
  }
  if (session.tags?.length) {
    lines.push(`- 태그: ${session.tags.map((tag) => `#${escapeMarkdown(tag)}`).join(" ")}`);
  }
  if (session.note.trim()) {
    lines.push("", "## 메모", "", session.note.trim());
  }

  lines.push("", "## 자막", "", "| 시간 | 발언자 | 내용 | 비고 |", "| --- | --- | --- | --- |");
  session.entries.forEach((entry) => {
    const flags = [
      entry.highlighted ? "중요" : "",
      entry.entryNote?.trim() ? entry.entryNote.trim() : "",
      entry.labels?.length ? entry.labels.map((label) => `#${label}`).join(" ") : "",
    ].filter(Boolean);
    lines.push(
      `| ${formatClockTime(entry.startTime || entry.timestamp)} | ${escapeMarkdown(resolveSpeaker(session, entry))} | ${escapeMarkdown(entry.text)} | ${escapeMarkdown(flags.join(" / "))} |`,
    );
  });

  return `${lines.join("\n").trim()}\n`;
}
