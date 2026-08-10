import type { SessionRecord } from "../subtitle-models";
import { formatSrtDuration, resolveEntryRange, toDate } from "../timeline";
import {
  formatSpeakerPrefix,
  resolveSpeakerLabelForOutput,
} from "./speaker-label";

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

export function exportSrt(
  session: SessionRecord,
  options: { includeSpeaker?: boolean } = {},
): string {
  if (!session.entries.length) {
    return "";
  }

  const baseTime = resolveCueBaseTime(session);
  const includeSpeaker = options.includeSpeaker === true;

  return session.entries
    .map((entry, index) => {
      const [start, end] = resolveEntryRange(entry);
      const startOffset = Math.max(0, start.getTime() - baseTime);
      const endOffset = Math.max(startOffset + 1, end.getTime() - baseTime);
      const speakerPrefix = includeSpeaker
        ? formatSpeakerPrefix(resolveSpeakerLabelForOutput(entry, session))
        : "";
      return `${index + 1}\n${formatSrtDuration(startOffset)} --> ${formatSrtDuration(endOffset)}\n${speakerPrefix}${normalizeCueText(entry.text)}`;
    })
    .join("\n\n");
}
