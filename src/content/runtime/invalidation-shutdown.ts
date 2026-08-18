/**
 * 확장 컨텍스트 무효화 시 정리해야 할 타이머/하트비트 목록.
 * runtime-core 가 각 clearer 를 연결한다.
 */

export const INVALIDATION_CLEANUP_STEPS = [
  "localPolling",
  "topFallback",
  "fallbackCommit",
  "nonceRefresh",
  "urlPolling",
  "runningPersist",
  "ownershipHeartbeat",
  "pendingReset",
] as const;

export type InvalidationCleanupStep = (typeof INVALIDATION_CLEANUP_STEPS)[number];

export function runInvalidationTimerCleanup(
  clearers: Record<InvalidationCleanupStep, () => void>,
): InvalidationCleanupStep[] {
  const ran: InvalidationCleanupStep[] = [];
  for (const step of INVALIDATION_CLEANUP_STEPS) {
    clearers[step]();
    ran.push(step);
  }
  return ran;
}
