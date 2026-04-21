import { PIPELINE_DEFAULTS } from "../shared/constants";

export interface UnconfirmedFallbackSignal {
  blockedByUnconfirmedFilter?: boolean;
  found?: boolean;
  text?: string | null;
}

export function shouldAllowUnconfirmedContainerFallback(
  blockStreak: number,
  threshold = PIPELINE_DEFAULTS.unconfirmedFallbackAllowStreak,
): boolean {
  return blockStreak >= threshold;
}

export function updateUnconfirmedFallbackBlockStreak(
  currentStreak: number,
  signal: UnconfirmedFallbackSignal,
): number {
  if (signal.blockedByUnconfirmedFilter) {
    return currentStreak + 1;
  }

  if (signal.found && typeof signal.text === "string" && signal.text.trim()) {
    return 0;
  }

  return currentStreak;
}
