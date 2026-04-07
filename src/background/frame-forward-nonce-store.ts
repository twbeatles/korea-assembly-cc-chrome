const FRAME_FORWARD_NONCE_STORAGE_PREFIX = "assembly-subtitle-frame-forward-nonce:";

export interface FrameForwardNonceStorage {
  get: (keys?: string | string[] | null) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
  remove: (keys: string | string[]) => Promise<void>;
}

function isValidNonce(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function getFrameForwardNonceStorageKey(tabId: number): string {
  return `${FRAME_FORWARD_NONCE_STORAGE_PREFIX}${tabId}`;
}

export async function readPersistedFrameForwardNonce(
  storage: FrameForwardNonceStorage,
  tabId: number,
): Promise<string | null> {
  const storageKey = getFrameForwardNonceStorageKey(tabId);
  const snapshot = await storage.get(storageKey);
  const nonce = snapshot[storageKey];
  return isValidNonce(nonce) ? nonce : null;
}

export async function getOrCreatePersistedFrameForwardNonce(options: {
  tabId: number;
  cache: Map<number, string>;
  storage: FrameForwardNonceStorage;
  createNonce: () => string;
}): Promise<string> {
  const cached = options.cache.get(options.tabId);
  if (cached) {
    return cached;
  }

  const persisted = await readPersistedFrameForwardNonce(options.storage, options.tabId);
  if (persisted) {
    options.cache.set(options.tabId, persisted);
    return persisted;
  }

  const next = options.createNonce();
  options.cache.set(options.tabId, next);
  await options.storage.set({
    [getFrameForwardNonceStorageKey(options.tabId)]: next,
  });
  return next;
}

export async function rotatePersistedFrameForwardNonce(options: {
  tabId: number;
  cache: Map<number, string>;
  storage: FrameForwardNonceStorage;
  createNonce: () => string;
}): Promise<string> {
  const next = options.createNonce();
  options.cache.set(options.tabId, next);
  await options.storage.set({
    [getFrameForwardNonceStorageKey(options.tabId)]: next,
  });
  return next;
}

export async function clearPersistedFrameForwardNonce(options: {
  tabId: number;
  cache: Map<number, string>;
  storage: FrameForwardNonceStorage;
}): Promise<void> {
  options.cache.delete(options.tabId);
  await options.storage.remove(getFrameForwardNonceStorageKey(options.tabId));
}
