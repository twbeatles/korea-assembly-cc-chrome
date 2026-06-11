import {
  resolveSessionLineageId,
  resolveSessionSegmentNumber,
  type SessionQualityStats,
  type SessionRecord,
  type SpeakerLabels,
} from "../subtitle-models";

export interface JsonSessionExport {
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
  status: SessionRecord["status"];
  starred: boolean;
  pinnedAt: string | null;
  note: string;
  tags?: string[];
  category?: string;
  speakerLabels?: SpeakerLabels;
  qualityStats?: SessionQualityStats;
  lineageId: string;
  segmentNumber: number;
  entries: SessionRecord["entries"];
}

export function buildJsonExport(session: SessionRecord): JsonSessionExport {
  return {
    id: session.id,
    version: session.version,
    title: session.title,
    committeeName: session.committeeName,
    sourceUrl: session.sourceUrl,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    subtitleCount: session.subtitleCount,
    charCount: session.charCount,
    status: session.status,
    starred: session.starred,
    pinnedAt: session.pinnedAt,
    note: session.note,
    tags: session.tags ? [...session.tags] : undefined,
    category: session.category,
    speakerLabels: session.speakerLabels ? { ...session.speakerLabels } : undefined,
    qualityStats: session.qualityStats ? { ...session.qualityStats } : undefined,
    lineageId: resolveSessionLineageId(session.id, session.lineageId),
    segmentNumber: resolveSessionSegmentNumber(session.segmentNumber),
    entries: session.entries.map((entry) => ({
      ...entry,
      sourceFramePath: entry.sourceFramePath ? [...entry.sourceFramePath] : undefined,
      labels: entry.labels ? [...entry.labels] : undefined,
      sourceEntryIds: entry.sourceEntryIds ? [...entry.sourceEntryIds] : undefined,
    })),
  };
}

export function exportJson(session: SessionRecord): string {
  return JSON.stringify(buildJsonExport(session), null, 2);
}
