import type { SessionState } from "../../core/subtitle-models";
import type { RuntimeSessionSegmentationReason } from "./segmentation-policy";
import { createContinuedSessionState } from "../session-lifecycle";

interface BuildRolledOverRunningSessionStateOptions {
  sourceUrl: string;
  title: string;
  committeeName: string;
  nowIso: string;
}

export function buildSegmentRolloverNotice(
  nextSegmentNumber: number,
  reason: RuntimeSessionSegmentationReason,
): string {
  switch (reason) {
    case "entry_limit":
      return `자막 수가 누적되어 세그먼트 ${nextSegmentNumber}로 이어서 수집합니다.`;
    case "char_limit":
      return `자막 분량이 커져 세그먼트 ${nextSegmentNumber}로 이어서 수집합니다.`;
    case "duration_limit":
      return `장시간 수집 안정성을 위해 세그먼트 ${nextSegmentNumber}로 이어서 수집합니다.`;
    default:
      return `세그먼트 ${nextSegmentNumber}로 이어서 수집합니다.`;
  }
}

export function buildRolledOverRunningSessionState(
  currentState: SessionState,
  options: BuildRolledOverRunningSessionStateOptions,
): SessionState {
  const nextState = createContinuedSessionState(
    currentState,
    options.sourceUrl,
    options.title,
    options.committeeName,
    options.nowIso,
  );

  nextState.observerActive = currentState.observerActive;
  nextState.currentSelector = currentState.currentSelector;
  nextState.currentFramePath = [...currentState.currentFramePath];
  nextState.lastObserverEventAt = currentState.lastObserverEventAt;
  nextState.confirmedCompact = currentState.confirmedCompact;
  nextState.trailingSuffix = currentState.trailingSuffix;
  nextState.lastObservedRaw = currentState.lastObservedRaw;
  nextState.lastProcessedRaw = currentState.lastProcessedRaw;

  return nextState;
}
