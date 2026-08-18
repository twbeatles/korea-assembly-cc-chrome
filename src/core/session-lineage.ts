import {
  cloneEntry,
  cloneSessionRecord,
  createEmptySessionState,
  getSessionCharCount,
  resolveSessionLineageId,
  resolveSessionSegmentNumber,
  type SessionRecord,
  type SessionState,
  type SubtitleEntry,
} from "./subtitle-models";

type SessionLineageLike = Pick<
  SessionRecord,
  "id" | "startedAt" | "updatedAt" | "lineageId" | "segmentNumber"
>;

export function compareSessionSegments(
  left: SessionLineageLike,
  right: SessionLineageLike,
): number {
  const segmentNumberDelta =
    resolveSessionSegmentNumber(left.segmentNumber) -
    resolveSessionSegmentNumber(right.segmentNumber);
  if (segmentNumberDelta !== 0) {
    return segmentNumberDelta;
  }

  const startedAtDelta = left.startedAt.localeCompare(right.startedAt);
  if (startedAtDelta !== 0) {
    return startedAtDelta;
  }

  const updatedAtDelta = left.updatedAt.localeCompare(right.updatedAt);
  if (updatedAtDelta !== 0) {
    return updatedAtDelta;
  }

  return left.id.localeCompare(right.id);
}

export function sortSessionSegments<T extends SessionLineageLike>(sessions: T[]): T[] {
  return [...sessions].sort(compareSessionSegments);
}

export function mergeSessionSegmentEntries(
  sessions: Array<SessionLineageLike & { entries: SubtitleEntry[] }>,
): SubtitleEntry[] {
  return sortSessionSegments(sessions).flatMap((session) =>
    session.entries.map(cloneEntry),
  );
}

function resolvePreferredString(
  candidates: Array<string | null | undefined>,
  fallback = "",
): string {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }

  return fallback;
}

/** 공통 메모면 유지하고, 다르면 가장 앞 세그먼트 메모를 쓴다. */
export function resolveMergedSessionNote(sessions: Array<Pick<SessionRecord, "note">>): string {
  const notes = sessions.map((session) =>
    typeof session.note === "string" ? session.note : "",
  );
  const nonEmpty = notes.filter((note) => note.trim().length > 0);
  if (!nonEmpty.length) {
    return "";
  }
  if (new Set(nonEmpty).size === 1) {
    return nonEmpty[0] ?? "";
  }
  return nonEmpty[0] ?? "";
}

export function mergeSessionSegments(sessions: SessionRecord[]): SessionRecord {
  const sorted = sortSessionSegments(sessions);
  if (!sorted.length) {
    throw new Error("병합할 세그먼트가 없습니다.");
  }

  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const entries = mergeSessionSegmentEntries(sorted);
  const lineageId = resolveSessionLineageId(first.id, first.lineageId);

  return {
    ...cloneSessionRecord(last),
    id: lineageId,
    title: resolvePreferredString([last.title, first.title], "국회 자막 세션"),
    committeeName: resolvePreferredString([last.committeeName, first.committeeName]),
    sourceUrl: resolvePreferredString([last.sourceUrl, first.sourceUrl]),
    startedAt: first.startedAt,
    endedAt: last.endedAt ?? last.updatedAt,
    createdAt: first.createdAt,
    updatedAt: last.updatedAt,
    subtitleCount: entries.length,
    charCount: getSessionCharCount(entries),
    status: last.status,
    starred: sorted.some((session) => session.starred),
    pinnedAt: last.pinnedAt,
    note: resolveMergedSessionNote(sorted),
    lineageId,
    segmentNumber: 1,
    entries,
  };
}

export function createContinuedSessionState(
  currentState: SessionState,
  sourceUrl: string,
  title: string,
  committeeName: string,
  nowIso = new Date().toISOString(),
): SessionState {
  const nextState = createEmptySessionState(sourceUrl, title, committeeName);
  nextState.lineageId = resolveSessionLineageId(
    currentState.sessionId,
    currentState.lineageId,
  );
  nextState.segmentNumber = resolveSessionSegmentNumber(currentState.segmentNumber) + 1;
  nextState.status = "running";
  nextState.createdAt = nowIso;
  nextState.startedAt = nowIso;
  nextState.updatedAt = nowIso;
  nextState.title = title;
  nextState.committeeName = committeeName;
  return nextState;
}

export function isSegmentedSessionRecord(
  session: Pick<SessionRecord, "id" | "lineageId" | "segmentNumber">,
): boolean {
  return (
    resolveSessionLineageId(session.id, session.lineageId) !== session.id ||
    resolveSessionSegmentNumber(session.segmentNumber) > 1
  );
}
