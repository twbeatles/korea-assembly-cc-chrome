import type { ExtensionSettings } from "../storage/types";

export const BASIC_NUMBER_FIELDS: Array<keyof ExtensionSettings> = [
  "runningAutoSaveDebounceMs",
  "recentCopyLineCount",
];

export const ADVANCED_NUMBER_FIELDS: Array<keyof ExtensionSettings> = [
  "keepaliveIntervalMs",
  "pollingFallbackIntervalMs",
  "maxBufferLength",
  "recentDuplicateMinLength",
];

export const TOGGLE_FIELDS: Array<keyof ExtensionSettings> = [
  "autoScroll",
  "runningAutoSaveEnabled",
  "autoStartEnabled",
  "filterUnconfirmedEnabled",
  "txtExportTimestampsEnabled",
  "noiseFilterEnabled",
  "debugLogging",
];

export const TEXT_FIELDS: Array<keyof ExtensionSettings> = ["filenamePattern"];

export const EXPOSED_OPTION_FIELDS = [
  ...TOGGLE_FIELDS,
  ...BASIC_NUMBER_FIELDS,
  ...ADVANCED_NUMBER_FIELDS,
  ...TEXT_FIELDS,
] as Array<keyof ExtensionSettings>;
