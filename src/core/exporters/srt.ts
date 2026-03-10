import type { SessionRecord } from "../subtitle-models";
import { formatSrtDuration, resolveEntryRange, toDate } from "../timeline";

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

export function exportSrt(session: SessionRecord): string {
  if (!session.entries.length) {
    return "";
  }

  const baseTime = resolveCueBaseTime(session);

  return session.entries
    .map((entry, index) => {
      const [start, end] = resolveEntryRange(entry);
      const startOffset = Math.max(0, start.getTime() - baseTime);
      const endOffset = Math.max(startOffset + 1, end.getTime() - baseTime);
      return `${index + 1}\n${formatSrtDuration(startOffset)} --> ${formatSrtDuration(endOffset)}\n${normalizeCueText(entry.text)}`;
    })
    .join("\n\n");
}
