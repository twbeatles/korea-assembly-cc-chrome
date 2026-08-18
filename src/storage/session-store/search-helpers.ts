/**
 * 세션 검색 매칭 헬퍼 (순수 함수)
 */
import { cloneSessionRecord, type SessionRecord } from "../../core/subtitle-models";
import type {
  SessionSearchHit,
  SessionSearchOptions,
  SessionSearchResult,
} from "../types";

export function normalizeSearchToken(value: string | undefined): string {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase();
}

export function includesSearchToken(value: string | undefined, token: string): boolean {
  return Boolean(token) && String(value ?? "").toLocaleLowerCase().includes(token);
}

export function buildSearchHits(session: SessionRecord, token: string): SessionSearchHit[] {
  if (!token) {
    return [];
  }

  const hits: SessionSearchHit[] = [];
  if (includesSearchToken(session.title, token)) {
    hits.push({ field: "title", text: session.title });
  }
  if (includesSearchToken(session.committeeName, token)) {
    hits.push({ field: "committeeName", text: session.committeeName });
  }
  if (includesSearchToken(session.note, token)) {
    hits.push({ field: "note", text: session.note });
  }
  if (includesSearchToken(session.category, token)) {
    hits.push({ field: "category", text: session.category ?? "" });
  }
  (session.tags ?? []).forEach((tag) => {
    if (includesSearchToken(tag, token)) {
      hits.push({ field: "tag", text: tag });
    }
  });
  session.entries.forEach((entry) => {
    if (includesSearchToken(entry.text, token)) {
      hits.push({ field: "entry", entryId: entry.id, text: entry.text });
    }
    if (includesSearchToken(entry.entryNote, token)) {
      hits.push({ field: "entry", entryId: entry.id, text: entry.entryNote ?? "" });
    }
  });
  return hits;
}

/** tag/category/starred 만 검사. entry hydrate 없이 후보를 줄일 때 사용. */
export function sessionMatchesMetadataFilters(
  session: Pick<SessionRecord, "starred" | "tags" | "category">,
  options: SessionSearchOptions,
): boolean {
  if (options.starredOnly && !session.starred) {
    return false;
  }

  const tag = normalizeSearchToken(options.tag);
  if (tag && !(session.tags ?? []).some((item) => normalizeSearchToken(item) === tag)) {
    return false;
  }

  const category = normalizeSearchToken(options.category);
  if (category && normalizeSearchToken(session.category) !== category) {
    return false;
  }

  return true;
}

export function searchRequiresEntryHydration(
  options: Pick<SessionSearchOptions, "highlightedOnly">,
  token: string,
): boolean {
  return Boolean(token) || Boolean(options.highlightedOnly);
}

export function sessionMatchesSearchFilters(
  session: SessionRecord,
  options: SessionSearchOptions,
  token: string,
): SessionSearchResult | null {
  if (options.starredOnly && !session.starred) {
    return null;
  }

  const tag = normalizeSearchToken(options.tag);
  if (tag && !(session.tags ?? []).some((item) => normalizeSearchToken(item) === tag)) {
    return null;
  }

  const category = normalizeSearchToken(options.category);
  if (category && normalizeSearchToken(session.category) !== category) {
    return null;
  }

  if (options.highlightedOnly && !session.entries.some((entry) => entry.highlighted)) {
    return null;
  }

  const hits = buildSearchHits(session, token);
  if (token && hits.length === 0) {
    return null;
  }

  return {
    session: cloneSessionRecord(session),
    matchCount: token ? hits.length : 1,
    firstHit: hits[0] ?? null,
  };
}
