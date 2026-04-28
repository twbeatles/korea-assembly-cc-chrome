import {
  DEFAULT_EXTENSION_SETTINGS,
  EXTENSION_STORAGE_KEY,
  SESSION_SEGMENT_PRESETS,
} from "../shared/constants";
import {
  sanitizeFilenamePattern,
  validateFilenamePattern,
} from "../shared/filename-pattern";
import type { ExtensionSettings } from "./types";
import type { SegmentPreset } from "./types";

let memorySettings: ExtensionSettings = { ...DEFAULT_EXTENSION_SETTINGS };

type StoredSettings = Partial<ExtensionSettings> & {
  noiseMinLength?: number;
};

function getChromeLocalStorage(): typeof chrome.storage.local | null {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    return null;
  }
  return chrome.storage.local;
}

function sanitizeInteger(value: unknown, fallback: number, minimum: number): number {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed >= minimum) {
    return parsed;
  }
  return fallback;
}

function isSegmentPreset(value: unknown): value is SegmentPreset {
  return (
    value === "stability" ||
    value === "balanced" ||
    value === "capacity" ||
    value === "custom"
  );
}

function resolveSegmentPreset(settings: StoredSettings): SegmentPreset {
  if (isSegmentPreset(settings.segmentPreset)) {
    return settings.segmentPreset;
  }

  if (
    settings.maxEntriesPerSegment !== undefined ||
    settings.maxCharsPerSegment !== undefined ||
    settings.maxSegmentDurationMinutes !== undefined
  ) {
    return "custom";
  }

  return DEFAULT_EXTENSION_SETTINGS.segmentPreset;
}

function resolveSegmentThresholds(settings: StoredSettings): Pick<
  ExtensionSettings,
  "maxEntriesPerSegment" | "maxCharsPerSegment" | "maxSegmentDurationMinutes"
> {
  const segmentPreset = resolveSegmentPreset(settings);
  if (segmentPreset !== "custom") {
    return SESSION_SEGMENT_PRESETS[segmentPreset];
  }

  return {
    maxEntriesPerSegment: sanitizeInteger(
      settings.maxEntriesPerSegment,
      DEFAULT_EXTENSION_SETTINGS.maxEntriesPerSegment,
      100,
    ),
    maxCharsPerSegment: sanitizeInteger(
      settings.maxCharsPerSegment,
      DEFAULT_EXTENSION_SETTINGS.maxCharsPerSegment,
      5000,
    ),
    maxSegmentDurationMinutes: sanitizeInteger(
      settings.maxSegmentDurationMinutes,
      DEFAULT_EXTENSION_SETTINGS.maxSegmentDurationMinutes,
      10,
    ),
  };
}

function sanitizeSettings(settings: StoredSettings): ExtensionSettings {
  const legacyRecentDuplicateMinLength =
    settings.recentDuplicateMinLength ?? settings.noiseMinLength;
  const segmentPreset = resolveSegmentPreset(settings);
  const segmentThresholds = resolveSegmentThresholds(settings);
  return {
    autoScroll:
      typeof settings.autoScroll === "boolean"
        ? settings.autoScroll
        : DEFAULT_EXTENSION_SETTINGS.autoScroll,
    segmentPreset,
    keepaliveIntervalMs: sanitizeInteger(
      settings.keepaliveIntervalMs,
      DEFAULT_EXTENSION_SETTINGS.keepaliveIntervalMs,
      250,
    ),
    pollingFallbackIntervalMs: sanitizeInteger(
      settings.pollingFallbackIntervalMs,
      DEFAULT_EXTENSION_SETTINGS.pollingFallbackIntervalMs,
      100,
    ),
    maxBufferLength: sanitizeInteger(
      settings.maxBufferLength,
      DEFAULT_EXTENSION_SETTINGS.maxBufferLength,
      1000,
    ),
    maxEntriesPerSegment: segmentThresholds.maxEntriesPerSegment,
    maxCharsPerSegment: segmentThresholds.maxCharsPerSegment,
    maxSegmentDurationMinutes: segmentThresholds.maxSegmentDurationMinutes,
    noiseFilterEnabled:
      typeof settings.noiseFilterEnabled === "boolean"
        ? settings.noiseFilterEnabled
        : DEFAULT_EXTENSION_SETTINGS.noiseFilterEnabled,
    recentDuplicateMinLength: sanitizeInteger(
      legacyRecentDuplicateMinLength,
      DEFAULT_EXTENSION_SETTINGS.recentDuplicateMinLength,
      1,
    ),
    filenamePattern: sanitizeFilenamePattern(settings.filenamePattern),
    txtExportTimestampsEnabled:
      typeof settings.txtExportTimestampsEnabled === "boolean"
        ? settings.txtExportTimestampsEnabled
        : DEFAULT_EXTENSION_SETTINGS.txtExportTimestampsEnabled,
    runningAutoSaveEnabled:
      typeof settings.runningAutoSaveEnabled === "boolean"
        ? settings.runningAutoSaveEnabled
        : DEFAULT_EXTENSION_SETTINGS.runningAutoSaveEnabled,
    runningAutoSaveDebounceMs: sanitizeInteger(
      settings.runningAutoSaveDebounceMs,
      DEFAULT_EXTENSION_SETTINGS.runningAutoSaveDebounceMs,
      250,
    ),
    recentCopyLineCount: sanitizeInteger(
      settings.recentCopyLineCount,
      DEFAULT_EXTENSION_SETTINGS.recentCopyLineCount,
      1,
    ),
    debugLogging:
      typeof settings.debugLogging === "boolean"
        ? settings.debugLogging
        : DEFAULT_EXTENSION_SETTINGS.debugLogging,
    autoStartEnabled:
      typeof settings.autoStartEnabled === "boolean"
        ? settings.autoStartEnabled
        : DEFAULT_EXTENSION_SETTINGS.autoStartEnabled,
    filterUnconfirmedEnabled:
      typeof settings.filterUnconfirmedEnabled === "boolean"
        ? settings.filterUnconfirmedEnabled
        : DEFAULT_EXTENSION_SETTINGS.filterUnconfirmedEnabled,
  };
}

export async function getSettings(): Promise<ExtensionSettings> {
  const localStorage = getChromeLocalStorage();
  if (!localStorage) {
    return memorySettings;
  }

  const data = await localStorage.get(EXTENSION_STORAGE_KEY);
  const merged = sanitizeSettings({
    ...DEFAULT_EXTENSION_SETTINGS,
    ...(data[EXTENSION_STORAGE_KEY] as StoredSettings | undefined),
  });
  memorySettings = merged;
  return merged;
}

export { sanitizeSettings };

export async function saveSettings(
  partial: Partial<ExtensionSettings>,
): Promise<ExtensionSettings> {
  const filenamePatternError =
    typeof partial.filenamePattern === "string"
      ? validateFilenamePattern(partial.filenamePattern)
      : undefined;
  if (filenamePatternError) {
    throw new Error(filenamePatternError);
  }

  const next = sanitizeSettings({
    ...(await getSettings()),
    ...partial,
  });
  memorySettings = next;

  const localStorage = getChromeLocalStorage();
  if (localStorage) {
    await localStorage.set({
      [EXTENSION_STORAGE_KEY]: next,
    });
  }

  return next;
}

export async function resetSettings(): Promise<ExtensionSettings> {
  memorySettings = { ...DEFAULT_EXTENSION_SETTINGS };

  const localStorage = getChromeLocalStorage();
  if (localStorage) {
    await localStorage.set({
      [EXTENSION_STORAGE_KEY]: memorySettings,
    });
  }

  return memorySettings;
}
