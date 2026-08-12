/**
 * 탭 가시성에 따른 폴링 간격 조정.
 * hidden 이면 base 를 늘려 CPU/배터리 부담을 줄인다.
 */

export const HIDDEN_TAB_POLLING_MULTIPLIER = 4;

export function resolvePollingIntervalMs(
  baseIntervalMs: number,
  visibilityState?: DocumentVisibilityState | null,
  hiddenMultiplier: number = HIDDEN_TAB_POLLING_MULTIPLIER,
): number {
  const base = Math.max(50, Math.floor(Number(baseIntervalMs) || 0) || 50);
  if (visibilityState === "hidden") {
    const multiplier = Math.max(1, Math.floor(hiddenMultiplier));
    return base * multiplier;
  }
  return base;
}

export function readDocumentVisibilityState(
  doc: Pick<Document, "visibilityState"> | null | undefined = typeof document !== "undefined"
    ? document
    : null,
): DocumentVisibilityState | undefined {
  if (!doc || typeof doc.visibilityState !== "string") {
    return undefined;
  }
  return doc.visibilityState;
}
