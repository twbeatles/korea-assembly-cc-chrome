import type { SessionRecord } from "../subtitle-models";
import { formatClockTime } from "../timeline";

export function exportTxt(
  session: SessionRecord,
  options: {
    includeTimestamps?: boolean;
  } = {},
): string {
  const includeTimestamps = options.includeTimestamps === true;
  return session.entries
    .map((entry) =>
      includeTimestamps
        ? `[${formatClockTime(entry.timestamp)}] ${entry.text}`
        : entry.text,
    )
    .join("\n");
}
