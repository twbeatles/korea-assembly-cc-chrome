import type { ExtensionSettings } from "../storage/types";

export const EXTENSION_STORAGE_KEY = "assembly-extension-settings";
export const SESSION_LIBRARY_REVISION_STORAGE_KEY = "assembly-subtitle-session-library-revision";
export const SESSION_DB_NAME = "assembly-subtitle-sessions";
export const SESSION_STORE_NAME = "sessions";
export const SESSION_RECORD_VERSION = "3";
export const SESSION_DB_SCHEMA_VERSION = 3;

export const OBSERVER_CONFIG_EVENT = "assembly-subtitle-observer:config";
export const OBSERVER_STOP_EVENT = "assembly-subtitle-observer:stop";
export const OBSERVER_ACTIVATE_EVENT = "assembly-subtitle-observer:activate";
export const OBSERVER_BRIDGE_SOURCE = "assembly-subtitle-observer";
export const FRAME_FORWARD_SOURCE = "assembly-subtitle-frame-forward";
export const FRAME_FORWARD_NONCE_SOURCE = "assembly-subtitle-frame-forward:nonce";
export const POPUP_PORT_NAME = "assembly-subtitle-popup";
export const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";

export const SUBTITLE_SELECTOR_CANDIDATES = [
  "#viewSubtit .smi_word:last-child",
  "#viewSubtit .smi_word",
  "#viewSubtit .incont",
  "#viewSubtit span",
  "#viewSubtit",
  ".subtitle_area",
  ".ai_subtitle",
  "[class*='subtitle']",
] as const;

export const DEFAULT_EXTENSION_SETTINGS: ExtensionSettings = {
  autoScroll: true,
  keepaliveIntervalMs: 1000,
  pollingFallbackIntervalMs: 200,
  maxBufferLength: 50000,
  noiseFilterEnabled: true,
  recentDuplicateMinLength: 8,
  filenamePattern: "{date}_{committee}_{time}",
  runningAutoSaveEnabled: true,
  runningAutoSaveDebounceMs: 800,
  recentCopyLineCount: 5,
  debugLogging: false,
  autoStartEnabled: true,
  filterUnconfirmedEnabled: true,
};

export const PIPELINE_DEFAULTS = {
  suffixLength: 50,
  previewResyncThreshold: 10,
  previewAmbiguousResyncThreshold: 6,
  confirmedCompactMaxLength: 50000,
  recentDuplicateMinLength: 8,
  mergeGapSeconds: 5,
  mergeMaxChars: 1000,
  keepaliveIntervalMs: 1000,
  recentHistoryEntries: 12,
  recentHistoryCompactLength: 5000,
  recentResyncEntries: 5,
  frameProbeMaxDepth: 3,
  frameProbeMaxFrames: 60,
  observerPollIntervalMs: 180,
  liveLedgerMaxRows: 300,
} as const;

export const ASSEMBLY_HOSTS = [
  "https://assembly.webcast.go.kr/",
  "https://webcast.assembly.go.kr/",
] as const;

export const ASSEMBLY_HOST_MATCH_PATTERNS = [
  "https://assembly.webcast.go.kr/*",
  "https://webcast.assembly.go.kr/*",
] as const;

export function isSupportedAssemblyUrl(url?: string): boolean {
  return typeof url === "string" && ASSEMBLY_HOSTS.some((host) => url.startsWith(host));
}

export function isSupportedAssemblyHostname(hostname: string): boolean {
  return ASSEMBLY_HOSTS.some((host) => {
    try {
      return new URL(host).hostname === hostname;
    } catch {
      return false;
    }
  });
}
