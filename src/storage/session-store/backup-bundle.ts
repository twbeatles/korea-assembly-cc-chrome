import { cloneSessionRecord, type SessionRecord } from "../../core/subtitle-models";
import {
  assertSessionLibraryTransferSizeWithinLimit,
  SESSION_BACKUP_KIND,
  SESSION_BACKUP_VERSION,
} from "../session-backup";
import { getUtf8ByteLength } from "../../shared/byte-size";

interface SessionBackupPageResult {
  sessions: Array<Pick<SessionRecord, "id">>;
  totalCount: number;
}

interface StringifySessionBackupBundleIncrementallyOptions {
  exportedAt: string;
  pageSize: number;
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
  listSessionsPage: (options: {
    page: number;
    pageSize: number;
  }) => Promise<SessionBackupPageResult>;
  loadSessionsByIds: (ids: string[]) => Promise<SessionRecord[]>;
}

function createAbortError(message: string): Error {
  if (typeof DOMException !== "undefined") {
    return new DOMException(message, "AbortError");
  }

  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function throwIfBackupAborted(signal?: AbortSignal, message = "작업을 취소했습니다."): void {
  if (signal?.aborted) {
    throw createAbortError(message);
  }
}

function appendBackupChunk(
  chunks: string[],
  currentByteLength: number,
  chunk: string,
): number {
  const nextByteLength = currentByteLength + getUtf8ByteLength(chunk);
  assertSessionLibraryTransferSizeWithinLimit(nextByteLength, "전체 JSON 백업");
  chunks.push(chunk);
  return nextByteLength;
}

export async function stringifySessionBackupBundleIncrementally(
  options: StringifySessionBackupBundleIncrementallyOptions,
): Promise<{
  content: string;
  sessionCount: number;
}> {
  const {
    exportedAt,
    pageSize,
    signal,
    onProgress,
    listSessionsPage,
    loadSessionsByIds,
  } = options;
  let page = 1;
  let total = 0;
  let sessionCount = 0;
  let currentByteLength = 0;
  const chunks: string[] = [];
  const seenSessionIds = new Set<string>();

  currentByteLength = appendBackupChunk(
    chunks,
    currentByteLength,
    `{"kind":${JSON.stringify(SESSION_BACKUP_KIND)},"version":${JSON.stringify(
      SESSION_BACKUP_VERSION,
    )},"exportedAt":${JSON.stringify(exportedAt)},"sessions":[`,
  );

  while (true) {
    throwIfBackupAborted(signal, "전체 JSON 백업을 취소했습니다.");
    const pageResult = await listSessionsPage({
      page,
      pageSize,
    });
    throwIfBackupAborted(signal, "전체 JSON 백업을 취소했습니다.");

    total = pageResult.totalCount;
    const sessionIdsToLoad = [
      ...new Set(
        pageResult.sessions
          .map((session) => session.id)
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      ),
    ].filter((id) => !seenSessionIds.has(id));
    sessionIdsToLoad.forEach((id) => {
      seenSessionIds.add(id);
    });
    const pageSessions = sessionIdsToLoad.length
      ? await loadSessionsByIds(sessionIdsToLoad)
      : [];

    pageSessions.forEach((session) => {
      throwIfBackupAborted(signal, "전체 JSON 백업을 취소했습니다.");
      currentByteLength = appendBackupChunk(
        chunks,
        currentByteLength,
        `${sessionCount > 0 ? "," : ""}${JSON.stringify(cloneSessionRecord(session))}`,
      );
      sessionCount += 1;
      onProgress?.(sessionCount, total);
    });

    if (!pageResult.sessions.length || seenSessionIds.size >= total || sessionCount >= total) {
      break;
    }

    page += 1;
  }

  throwIfBackupAborted(signal, "전체 JSON 백업을 취소했습니다.");
  appendBackupChunk(chunks, currentByteLength, "]}");

  return {
    content: chunks.join(""),
    sessionCount,
  };
}
