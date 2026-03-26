import type { SessionRecord } from "../subtitle-models";
import { formatClockTime } from "../timeline";

export interface ExportTxtOptions {
  includeTimestamp?: boolean;
}

export function exportTxt(session: SessionRecord, options: ExportTxtOptions = {}): string {
  const includeTimestamp = options.includeTimestamp !== false;
  return session.entries
    .map((entry) =>
      includeTimestamp
        ? `[${formatClockTime(entry.timestamp)}] ${entry.text}`
        : entry.text,
    )
    .join("\n");
}
