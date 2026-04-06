import { PIPELINE_DEFAULTS } from "../../shared/constants";
import type { ExtensionSettings } from "../../storage/types";

export const DEFAULT_IN_PAGE_NOTICE = "페이지 오른쪽에서 수집된 자막을 바로 보고 있습니다.";
export const SUBTITLE_RESET_GRACE_MS = 1000;
export const INVALIDATED_CONTEXT_NOTICE = "Extension was updated. Please refresh the page (F5).";
export const INTERNAL_CACHE_COMPACT_INTERVAL_MS = 30_000;
export const INTERNAL_CACHE_MAX_STATE_ENTRIES = 1200;
export const INTERNAL_CACHE_TARGET_STATE_ENTRIES = 400;
export const INTERNAL_CACHE_MAX_PENDING_PREVIEWS = 32;
export const INTERNAL_LEDGER_METADATA_STALE_MS = 60_000;

export function createDefaultSettings(): ExtensionSettings {
  return {
    autoScroll: true,
    keepaliveIntervalMs: PIPELINE_DEFAULTS.keepaliveIntervalMs,
    pollingFallbackIntervalMs: 200,
    maxBufferLength: PIPELINE_DEFAULTS.confirmedCompactMaxLength,
    noiseFilterEnabled: true,
    recentDuplicateMinLength: PIPELINE_DEFAULTS.recentDuplicateMinLength,
    filenamePattern: "{date}_{committee}_{time}",
    runningAutoSaveEnabled: true,
    runningAutoSaveDebounceMs: 800,
    recentCopyLineCount: 5,
    exportTxtWithoutTimestamps: true,
    debugLogging: false,
    autoStartEnabled: true,
    filterUnconfirmedEnabled: true,
  };
}
