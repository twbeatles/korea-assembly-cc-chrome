import { SESSION_RECORD_VERSION } from "../shared/constants";
import { createPrefixedRandomToken } from "../shared/random-token";

export type ExportFormat = "txt" | "srt" | "vtt" | "json" | "md" | "csv";
export type CaptureStatus = "idle" | "running" | "stopped" | "error";
export type PersistedSessionStatus = "running" | "stopped" | "saved";
export type SpeakerChannel = "primary" | "secondary" | "unknown";
export type SubtitleCaptureMode = "structured" | "fallback";

export interface SessionQualityStats {
  health: "good" | "warning" | "unstable";
  entryCount: number;
  charCount: number;
  estimatedBytes: number;
  fallbackOnly?: boolean;
  lastComputedAt: string;
}

export type SpeakerLabels = Partial<Record<SpeakerChannel, string>>;

export interface SubtitleEntry {
  id: string;
  text: string;
  timestamp: string;
  startTime: string;
  endTime: string;
  sourceSelector?: string;
  sourceFramePath?: number[];
  sourceNodeKey?: string;
  sourceCaptureMode?: SubtitleCaptureMode;
  speakerColor?: string;
  speakerChannel?: SpeakerChannel;
  speakerChanged?: boolean;
  originalText?: string;
  highlighted?: boolean;
  entryNote?: string;
  labels?: string[];
  speakerLabel?: string;
  sourceEntryIds?: string[];
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
  tags?: string[];
  category?: string;
  speakerLabels?: SpeakerLabels;
  qualityStats?: SessionQualityStats;
  lineageId?: string;
  segmentNumber?: number;
  entries: SubtitleEntry[];
}

export type StoredSessionRecord = Omit<
  SessionRecord,
  "starred" | "pinnedAt" | "note" | "tags" | "category" | "speakerLabels" | "qualityStats"
> &
  Partial<
    Pick<
      SessionRecord,
      "starred" | "pinnedAt" | "note" | "tags" | "category" | "speakerLabels" | "qualityStats"
    >
  >;

export interface SessionBackupBundle {
  kind: string;
  version: string;
  exportedAt: string;
  sessions: SessionRecord[];
}

export interface SessionState {
  sessionId: string;
  lineageId: string;
  segmentNumber: number;
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
  return createPrefixedRandomToken(prefix);
}

export function resolveSessionLineageId(
  sessionId: string,
  lineageId?: string | null,
): string {
  return typeof lineageId === "string" && lineageId.trim().length > 0
    ? lineageId
    : sessionId;
}

export function resolveSessionSegmentNumber(
  segmentNumber?: number | null,
): number {
  return typeof segmentNumber === "number" &&
    Number.isFinite(segmentNumber) &&
    segmentNumber >= 1
    ? Math.floor(segmentNumber)
    : 1;
}

export function cloneEntry(entry: SubtitleEntry): SubtitleEntry {
  return {
    ...entry,
    sourceFramePath: entry.sourceFramePath ? [...entry.sourceFramePath] : undefined,
    labels: entry.labels ? [...entry.labels] : undefined,
    sourceEntryIds: entry.sourceEntryIds ? [...entry.sourceEntryIds] : undefined,
  };
}

export function cloneSessionRecord(record: SessionRecord): SessionRecord {
  return {
    ...record,
    pinnedAt: record.pinnedAt,
    note: record.note,
    tags: record.tags ? [...record.tags] : undefined,
    speakerLabels: record.speakerLabels ? { ...record.speakerLabels } : undefined,
    qualityStats: record.qualityStats ? { ...record.qualityStats } : undefined,
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
  const sessionId = createId("session");
  return {
    sessionId,
    lineageId: sessionId,
    segmentNumber: 1,
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
    tags: [],
    category: "",
    speakerLabels: {},
    lineageId: resolveSessionLineageId(state.sessionId, state.lineageId),
    segmentNumber: resolveSessionSegmentNumber(state.segmentNumber),
    entries,
  };
}
