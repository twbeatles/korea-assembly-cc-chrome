import {
  cloneEntry,
  getSessionCharCount,
  type SessionRecord,
  type SubtitleEntry,
} from "../../core/subtitle-models";

export const SESSION_ENTRY_CHUNK_STORE_NAME = "session-entry-chunks";
export const SESSION_ENTRY_CHUNK_INDEX_NAME = "sessionIdChunkIndex";
export const SESSION_ENTRY_CHUNK_SIZE = 250;

export interface SessionEntryChunkRecord {
  id: string;
  sessionId: string;
  chunkIndex: number;
  digest: string;
  entries: SubtitleEntry[];
}

export interface ChunkedSessionMetadataRecord extends Omit<SessionRecord, "entries"> {
  entries: [];
  entryChunkCount?: number;
  entryChunkSize?: number;
  entryChunkDigests?: string[];
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function buildChunkDigest(entries: SubtitleEntry[]): string {
  return hashText(
    entries
      .map((entry) =>
        [
          entry.id,
          entry.text,
          entry.timestamp,
          entry.startTime,
          entry.endTime,
          entry.sourceSelector ?? "",
          (entry.sourceFramePath ?? []).join("."),
          entry.sourceNodeKey ?? "",
          entry.speakerColor ?? "",
          entry.speakerChannel ?? "",
          entry.speakerChanged ? "1" : "0",
        ].join("|"),
      )
      .join("\n"),
  );
}

export function buildSessionEntryChunkKey(sessionId: string, chunkIndex: number): string {
  return `${sessionId}::chunk::${String(chunkIndex).padStart(6, "0")}`;
}

export function buildSessionEntryChunks(
  sessionId: string,
  entries: SubtitleEntry[],
  chunkSize = SESSION_ENTRY_CHUNK_SIZE,
): SessionEntryChunkRecord[] {
  const safeChunkSize = Math.max(1, Math.floor(chunkSize));
  const chunks: SessionEntryChunkRecord[] = [];

  for (let index = 0; index < entries.length; index += safeChunkSize) {
    const chunkIndex = Math.floor(index / safeChunkSize);
    const chunkEntries = entries.slice(index, index + safeChunkSize).map(cloneEntry);
    chunks.push({
      id: buildSessionEntryChunkKey(sessionId, chunkIndex),
      sessionId,
      chunkIndex,
      digest: buildChunkDigest(chunkEntries),
      entries: chunkEntries,
    });
  }

  return chunks;
}

export function stripSessionEntries(
  record: SessionRecord,
  chunks = buildSessionEntryChunks(record.id, record.entries),
): ChunkedSessionMetadataRecord {
  return {
    ...record,
    entries: [],
    entryChunkCount: chunks.length,
    entryChunkSize: SESSION_ENTRY_CHUNK_SIZE,
    entryChunkDigests: chunks.map((chunk) => chunk.digest),
  };
}

export function hasChunkedSessionEntries(
  record: Partial<ChunkedSessionMetadataRecord>,
): boolean {
  return typeof record.entryChunkCount === "number" && record.entryChunkCount >= 0;
}

export function getChunkDigests(
  record: Partial<ChunkedSessionMetadataRecord>,
): string[] {
  if (!Array.isArray(record.entryChunkDigests)) {
    return [];
  }

  return record.entryChunkDigests.filter(
    (digest): digest is string => typeof digest === "string" && digest.length > 0,
  );
}

export function toEntrylessSessionRecord(
  record: SessionRecord | ChunkedSessionMetadataRecord,
): SessionRecord {
  return {
    ...record,
    entries: [],
  };
}

export function hydrateChunkedSessionRecord(
  record: SessionRecord | ChunkedSessionMetadataRecord,
  chunks: SessionEntryChunkRecord[],
): SessionRecord {
  const entries = chunks
    .slice()
    .sort((left, right) => left.chunkIndex - right.chunkIndex)
    .flatMap((chunk) => chunk.entries.map(cloneEntry));

  return {
    ...record,
    entries,
    subtitleCount: entries.length,
    charCount: getSessionCharCount(entries),
  };
}
