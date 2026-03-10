import type { SessionRecord } from "../subtitle-models";
import { formatClockTime } from "../timeline";

export function exportTxt(session: SessionRecord): string {
  return session.entries
    .map((entry) => `[${formatClockTime(entry.timestamp)}] ${entry.text}`)
    .join("\n");
}
