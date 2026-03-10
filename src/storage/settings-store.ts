import { DEFAULT_EXTENSION_SETTINGS, EXTENSION_STORAGE_KEY } from "../shared/constants";
import type { ExtensionSettings } from "./types";

let memorySettings: ExtensionSettings = { ...DEFAULT_EXTENSION_SETTINGS };

function sanitizeNumber(value: unknown, fallback: number, minimum: number): number {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= minimum) {
    return parsed;
  }
  return fallback;
}

function sanitizeSettings(settings: Partial<ExtensionSettings>): ExtensionSettings {
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
    noiseMinLength: sanitizeNumber(
      settings.noiseMinLength,
      DEFAULT_EXTENSION_SETTINGS.noiseMinLength,
      1,
    ),
    filenamePattern:
      typeof settings.filenamePattern === "string" && settings.filenamePattern.trim()
        ? settings.filenamePattern.trim()
        : DEFAULT_EXTENSION_SETTINGS.filenamePattern,
    debugLogging:
      typeof settings.debugLogging === "boolean"
        ? settings.debugLogging
        : DEFAULT_EXTENSION_SETTINGS.debugLogging,
  };
}

export async function getSettings(): Promise<ExtensionSettings> {
  if (!chrome?.storage?.local) {
    return memorySettings;
  }

  const data = await chrome.storage.local.get(EXTENSION_STORAGE_KEY);
  const merged = sanitizeSettings({
    ...DEFAULT_EXTENSION_SETTINGS,
    ...(data[EXTENSION_STORAGE_KEY] as Partial<ExtensionSettings> | undefined),
  });
  memorySettings = merged;
  return merged;
}

export async function saveSettings(
  partial: Partial<ExtensionSettings>,
): Promise<ExtensionSettings> {
  const next = sanitizeSettings({
    ...(await getSettings()),
    ...partial,
  });
  memorySettings = next;

  if (chrome?.storage?.local) {
    await chrome.storage.local.set({
      [EXTENSION_STORAGE_KEY]: next,
    });
  }

  return next;
}

export async function resetSettings(): Promise<ExtensionSettings> {
  memorySettings = { ...DEFAULT_EXTENSION_SETTINGS };

  if (chrome?.storage?.local) {
    await chrome.storage.local.set({
      [EXTENSION_STORAGE_KEY]: memorySettings,
    });
  }

  return memorySettings;
}
