import type { SessionRecord } from "../../core/subtitle-models";

export const LEGACY_FALLBACK_STORAGE_KEY = "assembly-subtitle-session-fallback";
export const FALLBACK_INDEX_STORAGE_KEY = "assembly-subtitle-session-fallback:index";
export const FALLBACK_RECORD_PREFIX = "assembly-subtitle-session-fallback:record:";

export const sessionStoreState = {
  dbPromise: null as Promise<IDBDatabase> | null,
  indexedDbAvailable: true,
  memoryFallbackStore: new Map<string, SessionRecord>(),
  fallbackMutationQueue: Promise.resolve() as Promise<void>,
  legacyFallbackMigrationPromise: null as Promise<void> | null,
  legacyFallbackMigrationCompleted: false,
};

export function resetSessionStoreModuleState(): void {
  sessionStoreState.dbPromise = null;
  sessionStoreState.indexedDbAvailable = true;
  sessionStoreState.memoryFallbackStore.clear();
  sessionStoreState.fallbackMutationQueue = Promise.resolve();
  sessionStoreState.legacyFallbackMigrationPromise = null;
  sessionStoreState.legacyFallbackMigrationCompleted = false;
}
