import type { SessionRecord } from "../../core/subtitle-models";
import type { SessionSearchHit } from "../types";

export function normalizeSearchQuery(query: string): string {
  return String(query || "").trim().toLocaleLowerCase();
}

export function buildSessionSearchSnippet(text: string, normalizedQuery: string): string {
  const normalizedText = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalizedText) {
    return "";
  }

  const snippetMaxLength = 88;
  const lowerText = normalizedText.toLocaleLowerCase();
  const matchIndex = lowerText.indexOf(normalizedQuery);
  if (matchIndex < 0 || normalizedText.length <= snippetMaxLength) {
    return normalizedText.slice(0, snippetMaxLength);
  }

  const padding = 18;
  const start = Math.max(0, matchIndex - padding);
  const end = Math.min(normalizedText.length, start + snippetMaxLength);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < normalizedText.length ? "..." : "";
  return `${prefix}${normalizedText.slice(start, end).trim()}${suffix}`;
}

export function buildSessionSearchHit(
  session: SessionRecord,
  normalizedQuery: string,
): SessionSearchHit | null {
  const matchedEntries = session.entries.filter((entry) =>
    entry.text.toLocaleLowerCase().includes(normalizedQuery),
  );
  if (!matchedEntries.length) {
    return null;
  }

  return {
    sessionId: session.id,
    title: session.title,
    committeeName: session.committeeName,
    sourceUrl: session.sourceUrl,
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
    subtitleCount: session.subtitleCount,
    charCount: session.charCount,
    status: session.status,
    starred: session.starred,
    hasNote: Boolean(session.note.trim()),
    matchedEntryIds: matchedEntries.map((entry) => entry.id),
    matchedCount: matchedEntries.length,
    firstSnippet: buildSessionSearchSnippet(matchedEntries[0]?.text ?? "", normalizedQuery),
  };
}
