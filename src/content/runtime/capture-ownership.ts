/**
 * 다중 탭에서 동시에 수집 중일 수 있음을 감지하기 위한 soft ownership.
 * 강제 차단이 아니라 경고 notice 용도이다.
 */

export const CAPTURE_OWNERSHIP_STORAGE_KEY = "assembly-subtitle-capture-owner";
/** 이 시간 안에 갱신된 소유권이 있으면 "다른 탭 수집 중"으로 본다. */
export const CAPTURE_OWNERSHIP_STALE_MS = 20_000;

export interface CaptureOwnershipSnapshot {
  ownerId: string;
  updatedAt: number;
  committeeName?: string;
}

export interface CaptureOwnershipStorage {
  get: (keys?: string | string[] | null) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
  remove: (keys: string | string[]) => Promise<void>;
}

function isOwnershipSnapshot(value: unknown): value is CaptureOwnershipSnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Partial<CaptureOwnershipSnapshot>;
  return (
    typeof record.ownerId === "string" &&
    record.ownerId.length > 0 &&
    typeof record.updatedAt === "number" &&
    Number.isFinite(record.updatedAt)
  );
}

export function isForeignActiveOwnership(
  snapshot: CaptureOwnershipSnapshot | null,
  ownerId: string,
  now = Date.now(),
  staleMs = CAPTURE_OWNERSHIP_STALE_MS,
): boolean {
  if (!snapshot || snapshot.ownerId === ownerId) {
    return false;
  }
  return now - snapshot.updatedAt <= staleMs;
}

export async function readCaptureOwnership(
  storage: CaptureOwnershipStorage | null | undefined,
): Promise<CaptureOwnershipSnapshot | null> {
  if (!storage) {
    return null;
  }
  try {
    const result = await storage.get(CAPTURE_OWNERSHIP_STORAGE_KEY);
    const value = result[CAPTURE_OWNERSHIP_STORAGE_KEY];
    return isOwnershipSnapshot(value) ? value : null;
  } catch {
    return null;
  }
}

export async function claimCaptureOwnership(options: {
  storage: CaptureOwnershipStorage | null | undefined;
  ownerId: string;
  committeeName?: string;
  now?: number;
}): Promise<{ foreignActive: boolean; previous: CaptureOwnershipSnapshot | null }> {
  const now = options.now ?? Date.now();
  const previous = await readCaptureOwnership(options.storage);
  const foreignActive = isForeignActiveOwnership(previous, options.ownerId, now);

  if (!options.storage) {
    return { foreignActive, previous };
  }

  const next: CaptureOwnershipSnapshot = {
    ownerId: options.ownerId,
    updatedAt: now,
    committeeName: options.committeeName?.trim() || previous?.committeeName,
  };

  try {
    await options.storage.set({
      [CAPTURE_OWNERSHIP_STORAGE_KEY]: next,
    });
  } catch {
    // 소유권은 soft 신호 — 저장 실패해도 수집은 계속
  }

  return { foreignActive, previous };
}

export async function heartbeatCaptureOwnership(options: {
  storage: CaptureOwnershipStorage | null | undefined;
  ownerId: string;
  committeeName?: string;
  now?: number;
}): Promise<void> {
  if (!options.storage) {
    return;
  }
  const now = options.now ?? Date.now();
  try {
    const previous = await readCaptureOwnership(options.storage);
    if (previous && previous.ownerId !== options.ownerId) {
      // 다른 탭이 소유권을 가져간 경우 heartbeat 로 덮어쓰지 않는다.
      return;
    }
    await options.storage.set({
      [CAPTURE_OWNERSHIP_STORAGE_KEY]: {
        ownerId: options.ownerId,
        updatedAt: now,
        committeeName: options.committeeName?.trim() || previous?.committeeName,
      } satisfies CaptureOwnershipSnapshot,
    });
  } catch {
    // ignore
  }
}

export async function releaseCaptureOwnership(options: {
  storage: CaptureOwnershipStorage | null | undefined;
  ownerId: string;
}): Promise<void> {
  if (!options.storage) {
    return;
  }
  try {
    const previous = await readCaptureOwnership(options.storage);
    if (previous && previous.ownerId !== options.ownerId) {
      return;
    }
    await options.storage.remove(CAPTURE_OWNERSHIP_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function getChromeLocalOwnershipStorage(): CaptureOwnershipStorage | null {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    return null;
  }
  return {
    get: (keys) => chrome.storage.local.get(keys),
    set: (items) => chrome.storage.local.set(items),
    remove: (keys) => chrome.storage.local.remove(keys),
  };
}
