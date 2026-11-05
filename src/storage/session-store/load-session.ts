/**
 * 세션 단건/복수 로드 (하위 계층).
 * mutations-internal 과 public-api 배럴 사이의 순환을 끊기 위해
 * loadSession 을 mutations / queries 와 분리한다.
 */
import { type SessionRecord } from "../../core/subtitle-models";
import { loadFallbackRecord } from "./fallback/storage";
import type { IndexedDbSessionRecord } from "./globals";
import {
  tryIndexedDb,
  withRequest,
  withSessionStoresTransaction,
} from "./idb/database";
import { hydrateIndexedDbSessionRecord } from "./idb/records";
import { normalizeSessionRecord } from "./normalize";
import { selectLatestBackendRecord } from "./backend-reconciliation";

export async function loadSession(
  id: string,
): Promise<SessionRecord | undefined> {
  if (!id) {
    return undefined;
  }

  const [indexedDbResult, fallbackRecord] = await Promise.all([
    tryIndexedDb(async () =>
      withSessionStoresTransaction(
        "readonly",
        async ({ sessionStore, chunkStore }) => {
          const record = (await withRequest(sessionStore.get(id))) as
            IndexedDbSessionRecord | undefined;
          if (!record) {
            return undefined;
          }

          return hydrateIndexedDbSessionRecord(record, chunkStore);
        },
      ),
    ),
    loadFallbackRecord(id),
  ]);

  const latest = selectLatestBackendRecord(
    indexedDbResult.ok ? indexedDbResult.value : undefined,
    fallbackRecord,
  );
  return latest
    ? normalizeSessionRecord(latest, {
        preserveTimestamps: true,
        forceStatus: latest.status,
      })
    : undefined;
}

export async function loadSessionsByIds(
  ids: string[],
): Promise<SessionRecord[]> {
  const uniqueIds = [
    ...new Set(
      ids.filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
  const sessions = await Promise.all(uniqueIds.map((id) => loadSession(id)));
  return sessions.filter((session): session is SessionRecord =>
    Boolean(session),
  );
}
