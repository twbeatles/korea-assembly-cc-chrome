import { SESSION_SCHEMA_VERSION } from "../shared/constants";

export type ExportFormat = "txt" | "srt" | "vtt" | "json";
export type CaptureStatus = "idle" | "running" | "stopped" | "error";
export type PersistedSessionStatus = "running" | "stopped" | "saved";

export interface SubtitleEntry {
  id: string;
  text: string;
  timestamp: string;
  startTime: string;
  endTime: string;
  sourceSelector?: string;
  sourceFramePath?: number[];
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
  entries: SubtitleEntry[];
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
    version: SESSION_SCHEMA_VERSION,
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
    entries,
  };
}
