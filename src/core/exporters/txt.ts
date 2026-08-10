import type { SessionRecord } from "../subtitle-models";
import { formatClockTime } from "../timeline";
import {
  formatSpeakerPrefix,
  resolveSpeakerLabelForOutput,
} from "./speaker-label";

export function exportTxt(
  session: SessionRecord,
  options: {
    includeTimestamps?: boolean;
    includeSpeaker?: boolean;
    includeEntryNotes?: boolean;
  } = {},
): string {
  const includeTimestamps = options.includeTimestamps === true;
  const includeSpeaker = options.includeSpeaker === true;
  const includeEntryNotes = options.includeEntryNotes === true;
  return session.entries
    .map((entry) => {
      const speakerPrefix = includeSpeaker
        ? formatSpeakerPrefix(resolveSpeakerLabelForOutput(entry, session))
        : "";
      const timePrefix = includeTimestamps
        ? `[${formatClockTime(entry.timestamp)}] `
        : "";
      const body = `${timePrefix}${speakerPrefix}${entry.text}`;
      const notes = includeEntryNotes
        ? [entry.highlighted ? "중요" : "", entry.entryNote ?? "", entry.labels?.join(", ") ?? ""]
            .filter((part) => part.trim())
            .join(" / ")
        : "";
      return notes ? `${body}\n  - ${notes}` : body;
    })
    .join("\n");
}
