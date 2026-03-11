import { DEFAULT_EXTENSION_SETTINGS, EXTENSION_STORAGE_KEY } from "../shared/constants";
import type { ExtensionSettings } from "./types";

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

function sanitizeNumber(value: unknown, fallback: number, minimum: number): number {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= minimum) {
    return parsed;
  }
  return fallback;
}

function sanitizeSettings(settings: StoredSettings): ExtensionSettings {
  const legacyRecentDuplicateMinLength =
    settings.recentDuplicateMinLength ?? settings.noiseMinLength;
  return {
    autoScroll:
      typeof settings.autoScroll === "boolean"
        ? settings.autoScroll
        : DEFAULT_EXTENSION_SETTINGS.autoScroll,
    keepaliveIntervalMs: sanitizeNumber(
      settings.keepaliveIntervalMs,
      DEFAULT_EXTENSION_SETTINGS.keepaliveIntervalMs,
      250,
    ),
    pollingFallbackIntervalMs: sanitizeNumber(
      settings.pollingFallbackIntervalMs,
      DEFAULT_EXTENSION_SETTINGS.pollingFallbackIntervalMs,
      100,
    ),
    maxBufferLength: sanitizeNumber(
      settings.maxBufferLength,
      DEFAULT_EXTENSION_SETTINGS.maxBufferLength,
      1000,
    ),
    noiseFilterEnabled:
      typeof settings.noiseFilterEnabled === "boolean"
        ? settings.noiseFilterEnabled
        : DEFAULT_EXTENSION_SETTINGS.noiseFilterEnabled,
    recentDuplicateMinLength: sanitizeNumber(
      legacyRecentDuplicateMinLength,
      DEFAULT_EXTENSION_SETTINGS.recentDuplicateMinLength,
      1,
    ),
    filenamePattern:
      typeof settings.filenamePattern === "string" && settings.filenamePattern.trim()
        ? settings.filenamePattern.trim()
        : DEFAULT_EXTENSION_SETTINGS.filenamePattern,
    runningAutoSaveEnabled:
      typeof settings.runningAutoSaveEnabled === "boolean"
        ? settings.runningAutoSaveEnabled
        : DEFAULT_EXTENSION_SETTINGS.runningAutoSaveEnabled,
    runningAutoSaveDebounceMs: sanitizeNumber(
      settings.runningAutoSaveDebounceMs,
      DEFAULT_EXTENSION_SETTINGS.runningAutoSaveDebounceMs,
      250,
    ),
    recentCopyLineCount: sanitizeNumber(
      settings.recentCopyLineCount,
      DEFAULT_EXTENSION_SETTINGS.recentCopyLineCount,
      1,
    ),
    debugLogging:
      typeof settings.debugLogging === "boolean"
        ? settings.debugLogging
        : DEFAULT_EXTENSION_SETTINGS.debugLogging,
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
