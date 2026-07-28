import { PIPELINE_DEFAULTS } from "../../shared/constants";
import type { ExtensionSettings } from "../../storage/types";
import type { SessionState, SubtitleEntry } from "../subtitle-models";
import { compactSubtitleText } from "../text-normalizer";

export function buildConfirmedCompactHistory(
  entries: SubtitleEntry[],
  maxLength: number = PIPELINE_DEFAULTS.confirmedCompactMaxLength,
): string {
  if (!entries.length) {
    return "";
  }

  const parts: string[] = [];
  let currentLength = 0;

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const compact = compactSubtitleText(entries[index].text);
    if (!compact) {
      continue;
    }

    parts.unshift(compact);
    currentLength += compact.length;
    if (currentLength >= maxLength) {
      break;
    }
  }

  return parts.join("").slice(-maxLength);
}

export function resolveConfirmedCompactMaxLength(
  settings?: Partial<ExtensionSettings>,
): number {
  const candidate = Number(settings?.maxBufferLength);
  if (Number.isFinite(candidate) && candidate >= 1000) {
    return Math.floor(candidate);
  }
  return PIPELINE_DEFAULTS.confirmedCompactMaxLength;
}

export function rebuildConfirmedHistory(
  state: SessionState,
  settings?: Partial<ExtensionSettings>,
): void {
  state.confirmedCompact = buildConfirmedCompactHistory(
    state.entries,
    resolveConfirmedCompactMaxLength(settings),
  );
  state.trailingSuffix = state.confirmedCompact.slice(-PIPELINE_DEFAULTS.suffixLength);
}

export function softResyncHistory(
  state: SessionState,
  settings?: Partial<ExtensionSettings>,
): void {
  const recentEntries = state.entries.slice(-PIPELINE_DEFAULTS.recentResyncEntries);
  state.confirmedCompact = buildConfirmedCompactHistory(
    recentEntries,
    resolveConfirmedCompactMaxLength(settings),
  );
  state.trailingSuffix = state.confirmedCompact.slice(-PIPELINE_DEFAULTS.suffixLength);
  state.previewDesyncCount = 0;
  state.previewAmbiguousSkipCount = 0;
}

export function resolveRecentHistoryCompactLength(
  settings?: Partial<ExtensionSettings>,
): number {
  const candidate = Number(settings?.maxBufferLength);
  if (!Number.isFinite(candidate) || candidate <= 0) {
    return PIPELINE_DEFAULTS.recentHistoryCompactLength;
  }
  return Math.max(
    1,
    Math.min(Math.floor(candidate), PIPELINE_DEFAULTS.recentHistoryCompactLength),
  );
}

export function resolveRecentDuplicateMinLength(
  settings?: Partial<ExtensionSettings>,
): number {
  const candidate = Number(settings?.recentDuplicateMinLength);
  if (Number.isInteger(candidate) && candidate >= 1) {
    return candidate;
  }
  return PIPELINE_DEFAULTS.recentDuplicateMinLength;
}

export function buildRecentCompactHistory(
  entries: SubtitleEntry[],
  settings?: Partial<ExtensionSettings>,
): string {
  return buildConfirmedCompactHistory(
    entries.slice(-PIPELINE_DEFAULTS.recentHistoryEntries),
    resolveRecentHistoryCompactLength(settings),
  );
}
