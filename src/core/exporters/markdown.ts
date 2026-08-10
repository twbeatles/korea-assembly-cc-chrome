import type { SessionRecord } from "../subtitle-models";
import { formatClockTime } from "../timeline";
import { resolveSpeakerLabelForOutput } from "./speaker-label";

function escapeMarkdownInline(value: string): string {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

function escapeMarkdownBlock(value: string): string {
  return String(value ?? "")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .trim();
}

export function exportMarkdown(
  session: SessionRecord,
  options: { includeSpeaker?: boolean } = {},
): string {
  // 기본 off — 사용자가 옵션/패널 토글로 켠 경우만 발언자 열 포함
  const includeSpeaker = options.includeSpeaker === true;
  const lines = [
    `# ${escapeMarkdownInline(session.title || session.committeeName || "국회 자막 기록")}`,
    "",
    `- 위원회: ${escapeMarkdownInline(session.committeeName || "-")}`,
    `- 시작: ${session.startedAt}`,
    `- 종료: ${session.endedAt ?? "-"}`,
    `- 원본: ${escapeMarkdownInline(session.sourceUrl || "-")}`,
  ];

  if (session.category?.trim()) {
    lines.push(`- 카테고리: ${escapeMarkdownInline(session.category)}`);
  }
  if (session.tags?.length) {
    lines.push(`- 태그: ${session.tags.map((tag) => `#${escapeMarkdownInline(tag)}`).join(" ")}`);
  }
  if (session.note.trim()) {
    lines.push("", "## 메모", "", escapeMarkdownBlock(session.note));
  }

  if (includeSpeaker) {
    lines.push(
      "",
      "## 자막",
      "",
      "| 시간 | 발언자 | 내용 | 비고 |",
      "| --- | --- | --- | --- |",
    );
  } else {
    lines.push("", "## 자막", "", "| 시간 | 내용 | 비고 |", "| --- | --- | --- |");
  }

  session.entries.forEach((entry) => {
    const flags = [
      entry.highlighted ? "중요" : "",
      entry.entryNote?.trim() ? entry.entryNote.trim() : "",
      entry.labels?.length ? entry.labels.map((label) => `#${label}`).join(" ") : "",
    ].filter(Boolean);
    const time = formatClockTime(entry.startTime || entry.timestamp);
    const text = escapeMarkdownInline(entry.text);
    const note = escapeMarkdownInline(flags.join(" / "));
    if (includeSpeaker) {
      const speaker = escapeMarkdownInline(
        resolveSpeakerLabelForOutput(entry, session),
      );
      lines.push(`| ${time} | ${speaker} | ${text} | ${note} |`);
    } else {
      lines.push(`| ${time} | ${text} | ${note} |`);
    }
  });

  return `${lines.join("\n").trim()}\n`;
}
