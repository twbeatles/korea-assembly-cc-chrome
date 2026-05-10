import type { SessionRecord, SubtitleEntry } from "../subtitle-models";
import { formatClockTime } from "../timeline";

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
      const prefix = [
        includeTimestamps ? `[${formatClockTime(entry.timestamp)}]` : "",
        includeSpeaker ? resolveSpeaker(session, entry) : "",
      ].filter(Boolean);
      const body = prefix.length ? `${prefix.join(" ")} ${entry.text}` : entry.text;
      const notes = includeEntryNotes
        ? [entry.highlighted ? "중요" : "", entry.entryNote ?? "", entry.labels?.join(", ") ?? ""]
            .filter((part) => part.trim())
            .join(" / ")
        : "";
      return notes ? `${body}\n  - ${notes}` : body;
    })
    .join("\n");
}
