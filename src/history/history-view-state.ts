import type { SessionRecord } from "../core/subtitle-models";
import { sanitizeSettings } from "../storage/settings-store";
import type { ExtensionSettings } from "../storage/types";

export interface HistoryViewSettings {
  recentCopyLineCount: number;
  filenamePattern: string;
}

export function selectHistoryViewSettings(
  settings: Pick<ExtensionSettings, "recentCopyLineCount" | "filenamePattern">,
): HistoryViewSettings {
  return {
    recentCopyLineCount: settings.recentCopyLineCount,
    filenamePattern: settings.filenamePattern,
  };
}

export function extractHistoryViewSettings(storedValue: unknown): HistoryViewSettings {
  const sanitized = sanitizeSettings(
    (storedValue && typeof storedValue === "object"
      ? storedValue
      : {}) as Partial<ExtensionSettings>,
  );
  return selectHistoryViewSettings(sanitized);
}

export function resolveSelectedSessionId(
  currentSelectedId: string,
  sessions: Array<Pick<SessionRecord, "id">>,
): string {
  if (sessions.some((session) => session.id === currentSelectedId)) {
    return currentSelectedId;
  }

  return sessions[0]?.id ?? "";
}
