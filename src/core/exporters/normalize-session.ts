import { normalizeEntriesForOutput } from "../output-normalizer";
import { getSessionCharCount, type SessionRecord } from "../subtitle-models";

export function normalizeSessionForExport(session: SessionRecord): SessionRecord {
  const entries = normalizeEntriesForOutput(session.entries, {
    stripSpeakerMetadata: true,
  });

  return {
    ...session,
    entries,
    subtitleCount: entries.length,
    charCount: getSessionCharCount(entries),
  };
}
