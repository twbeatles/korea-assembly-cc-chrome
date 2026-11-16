/**
 * container/unstable fallback 텍스트의 안정 관측 commit 게이트 (순수 함수).
 *
 * 데스크톱(korea-assembly-cc) `core/fallback_commit.py` 와 같은 규칙이며
 * `parity/pipeline-vectors.json` 의 `fallbackCommitGate` 벡터로 양쪽을 함께 검증한다.
 *
 * - 같은 raw 가 observationThreshold 회 관측되거나 stableMs 이상 유지되면 commit.
 * - raw 가 계속 바뀌어도 첫 미확정 관측(pendingSince)부터 maxWaitMs 가 지나면 commit 한다.
 *   연속 발언 중 commit·타임스탬프가 무기한 밀리지 않게 하는 상한이다.
 * - 후보가 다른 raw 로 바뀌어도 pendingSince 는 유지된다. commit 뒤 다음 관측은
 *   새 창에서 시작한다(호출 측이 후보를 비운다).
 */

export interface FallbackGateSettings {
  observationThreshold: number;
  stableMs: number;
  maxWaitMs: number;
}

export interface FallbackGateCandidate {
  raw: string;
  firstSeenAt: number;
  pendingSince: number;
  observationCount: number;
}

export interface FallbackGateDecision {
  candidate: FallbackGateCandidate;
  commitNow: boolean;
  delayMs: number;
  replaced: boolean;
  maxWaitReached: boolean;
}

export function decideFallbackCommit(
  previous: FallbackGateCandidate | null | undefined,
  raw: string,
  now: number,
  settings: FallbackGateSettings,
): FallbackGateDecision {
  const normalized = raw.trim();
  let candidate: FallbackGateCandidate;
  let replaced = false;
  if (previous && previous.raw === normalized) {
    candidate = {
      ...previous,
      observationCount: previous.observationCount + 1,
    };
  } else {
    candidate = {
      raw: normalized,
      firstSeenAt: now,
      pendingSince: previous ? previous.pendingSince : now,
      observationCount: 1,
    };
    replaced = Boolean(previous);
  }

  const stableElapsed = now - candidate.firstSeenAt;
  const pendingElapsed = now - candidate.pendingSince;
  const maxWaitReached = pendingElapsed >= settings.maxWaitMs;
  const commitNow =
    candidate.observationCount >= settings.observationThreshold ||
    stableElapsed >= settings.stableMs ||
    maxWaitReached;
  const delayMs = commitNow
    ? 0
    : Math.max(
        0,
        Math.trunc(
          Math.min(
            settings.stableMs - stableElapsed,
            settings.maxWaitMs - pendingElapsed,
          ),
        ),
      );
  return {
    candidate,
    commitNow,
    delayMs,
    replaced,
    maxWaitReached: maxWaitReached && commitNow,
  };
}
