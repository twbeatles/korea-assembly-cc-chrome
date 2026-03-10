import type { SessionRecord } from "../subtitle-models";

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
    entries: session.entries.map((entry) => ({
      ...entry,
      sourceFramePath: entry.sourceFramePath ? [...entry.sourceFramePath] : undefined,
    })),
  };
}

export function exportJson(session: SessionRecord): string {
  return JSON.stringify(buildJsonExport(session), null, 2);
}
