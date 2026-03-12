import { SESSION_RECORD_VERSION } from "../shared/constants";

export type ExportFormat = "txt" | "srt" | "vtt" | "json";
export type CaptureStatus = "idle" | "running" | "stopped" | "error";
export type PersistedSessionStatus = "running" | "stopped" | "saved";
export type SpeakerChannel = "primary" | "secondary" | "unknown";

export interface SubtitleEntry {
  id: string;
  text: string;
  timestamp: string;
  startTime: string;
  endTime: string;
  sourceSelector?: string;
  sourceFramePath?: number[];
  sourceNodeKey?: string;
  speakerColor?: string;
  speakerChannel?: SpeakerChannel;
  speakerChanged?: boolean;
}

export interface SessionRecord {
  id: string;
  version: string;
  title: string;
  committeeName: string;
  sourceUrl: string;
  startedAt: string;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
  subtitleCount: number;
  charCount: number;
  status: PersistedSessionStatus;
  starred: boolean;
  pinnedAt: string | null;
  note: string;
  entries: SubtitleEntry[];
}

export type StoredSessionRecord = Omit<SessionRecord, "starred" | "pinnedAt" | "note"> &
  Partial<Pick<SessionRecord, "starred" | "pinnedAt" | "note">>;

export interface SessionBackupBundle {
  kind: string;
  version: string;
  exportedAt: string;
  sessions: SessionRecord[];
}

export interface SessionState {
  sessionId: string;
  status: CaptureStatus;
  title: string;
  committeeName: string;
  sourceUrl: string;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  entries: SubtitleEntry[];
  previewText: string;
  pendingPreviews: string[];
  confirmedCompact: string;
  trailingSuffix: string;
  lastObservedRaw: string;
  lastProcessedRaw: string;
  previewDesyncCount: number;
  previewAmbiguousSkipCount: number;
  currentSelector: string;
  currentFramePath: number[];
  observerActive: boolean;
  lastObserverEventAt: number | null;
  lastKeepaliveAt: number | null;
  lastPersistedAt: string | null;
  lastCommittedResetAt: number | null;
}

export function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID()}`;
  }

  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function cloneEntry(entry: SubtitleEntry): SubtitleEntry {
  return {
    ...entry,
    sourceFramePath: entry.sourceFramePath ? [...entry.sourceFramePath] : undefined,
  };
}

export function cloneSessionRecord(record: SessionRecord): SessionRecord {
  return {
    ...record,
    pinnedAt: record.pinnedAt,
    note: record.note,
    entries: record.entries.map(cloneEntry),
  };
}

export function cloneState(state: SessionState): SessionState {
  return {
    ...state,
    entries: state.entries.map(cloneEntry),
    pendingPreviews: [...state.pendingPreviews],
    currentFramePath: [...state.currentFramePath],
  };
}

export function getSessionCharCount(entries: SubtitleEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.text.length, 0);
}

export function withSessionEntries(
  session: SessionRecord,
  entries: SubtitleEntry[],
): SessionRecord {
  const nextEntries = entries.map(cloneEntry);
  return {
    ...cloneSessionRecord(session),
    entries: nextEntries,
    subtitleCount: nextEntries.length,
    charCount: getSessionCharCount(nextEntries),
  };
}

export function createEmptySessionState(
  sourceUrl: string,
  title = "",
  committeeName = "",
): SessionState {
  return {
    sessionId: createId("session"),
    status: "idle",
    title,
    committeeName,
    sourceUrl,
    startedAt: null,
    endedAt: null,
    createdAt: null,
    updatedAt: null,
    entries: [],
    previewText: "",
    pendingPreviews: [],
    confirmedCompact: "",
    trailingSuffix: "",
    lastObservedRaw: "",
    lastProcessedRaw: "",
    previewDesyncCount: 0,
    previewAmbiguousSkipCount: 0,
    currentSelector: "",
    currentFramePath: [],
    observerActive: false,
    lastObserverEventAt: null,
    lastKeepaliveAt: null,
    lastPersistedAt: null,
    lastCommittedResetAt: null,
  };
}

export function toSessionRecord(
  state: SessionState,
  persistedStatus: PersistedSessionStatus,
): SessionRecord {
  const createdAt = state.createdAt ?? state.startedAt ?? new Date().toISOString();
  const startedAt = state.startedAt ?? createdAt;
  const updatedAt = state.updatedAt ?? new Date().toISOString();
  const endedAt = state.endedAt ?? (persistedStatus === "running" ? null : updatedAt);
  const entries = state.entries.map(cloneEntry);

  return {
    id: state.sessionId,
    version: SESSION_RECORD_VERSION,
    title: state.title || "국회 자막 세션",
    committeeName: state.committeeName,
    sourceUrl: state.sourceUrl,
    startedAt,
    endedAt,
    createdAt,
    updatedAt,
    subtitleCount: entries.length,
    charCount: getSessionCharCount(entries),
    status: persistedStatus,
    starred: false,
    pinnedAt: null,
    note: "",
    entries,
  };
}
