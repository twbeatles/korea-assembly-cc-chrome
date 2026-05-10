import { DEFAULT_EXTENSION_SETTINGS, EXTENSION_STORAGE_KEY } from "../shared/constants";
import {
  sanitizeFilenamePattern,
  validateFilenamePattern,
} from "../shared/filename-pattern";
import type { ExtensionSettings } from "./types";
import { createPrefixedRandomToken } from "../shared/random-token";
import { isSupportedAssemblyUrl } from "../shared/constants";

let memorySettings: ExtensionSettings = { ...DEFAULT_EXTENSION_SETTINGS };

type StoredSettings = Partial<ExtensionSettings> & {
  noiseMinLength?: number;
};

function sanitizePresetList(value: unknown): ExtensionSettings["presets"] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seenUrls = new Set<string>();
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => {
      const url = typeof item.url === "string" && isSupportedAssemblyUrl(item.url) ? item.url : "";
      const name = typeof item.name === "string" ? item.name.trim().slice(0, 80) : "";
      if (!url || !name) {
        return null;
      }
      if (seenUrls.has(url)) {
        return null;
      }
      seenUrls.add(url);
      return {
        id:
          typeof item.id === "string" && item.id.trim()
            ? item.id.trim()
            : createPrefixedRandomToken("preset"),
        name,
        url,
        committeeName:
          typeof item.committeeName === "string" ? item.committeeName.trim().slice(0, 120) : "",
        autoStartEnabled:
          typeof item.autoStartEnabled === "boolean" ? item.autoStartEnabled : true,
        noiseFilterEnabled:
          typeof item.noiseFilterEnabled === "boolean" ? item.noiseFilterEnabled : true,
      };
    })
    .filter((item): item is ExtensionSettings["presets"][number] => Boolean(item))
    .slice(0, 50);
}

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

function sanitizeSettings(settings: StoredSettings): ExtensionSettings {
  const legacyRecentDuplicateMinLength =
    settings.recentDuplicateMinLength ?? settings.noiseMinLength;
  return {
    autoScroll:
      typeof settings.autoScroll === "boolean"
        ? settings.autoScroll
        : DEFAULT_EXTENSION_SETTINGS.autoScroll,
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
    txtExportSpeakerEnabled:
      typeof settings.txtExportSpeakerEnabled === "boolean"
        ? settings.txtExportSpeakerEnabled
        : DEFAULT_EXTENSION_SETTINGS.txtExportSpeakerEnabled,
    txtExportEntryNotesEnabled:
      typeof settings.txtExportEntryNotesEnabled === "boolean"
        ? settings.txtExportEntryNotesEnabled
        : DEFAULT_EXTENSION_SETTINGS.txtExportEntryNotesEnabled,
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
    presets: sanitizePresetList(settings.presets),
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
