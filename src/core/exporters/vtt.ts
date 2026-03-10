import type { SessionRecord } from "../subtitle-models";
import { formatVttDuration, resolveEntryRange, toDate } from "../timeline";

function resolveCueBaseTime(session: SessionRecord): number {
  if (session.startedAt) {
    return toDate(session.startedAt).getTime();
  }

  const firstEntry = session.entries[0];
  if (firstEntry) {
    return toDate(firstEntry.startTime || firstEntry.timestamp).getTime();
  }

  return 0;
}

function normalizeCueText(text: string): string {
  return String(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
}

export function exportVtt(session: SessionRecord): string {
  if (!session.entries.length) {
    return "WEBVTT\n";
  }

  const baseTime = resolveCueBaseTime(session);
  const body = session.entries
    .map((entry) => {
      const [start, end] = resolveEntryRange(entry);
      const startOffset = Math.max(0, start.getTime() - baseTime);
      const endOffset = Math.max(startOffset + 1, end.getTime() - baseTime);
      return `${formatVttDuration(startOffset)} --> ${formatVttDuration(endOffset)}\n${normalizeCueText(entry.text)}`;
    })
    .join("\n\n");

  return `WEBVTT\n\n${body}`;
}
