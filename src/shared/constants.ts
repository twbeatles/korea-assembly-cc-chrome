import type { ExtensionSettings } from "../storage/types";

export const EXTENSION_STORAGE_KEY = "assembly-extension-settings";
export const SESSION_LIBRARY_REVISION_STORAGE_KEY = "assembly-subtitle-session-library-revision";
export const SESSION_DB_NAME = "assembly-subtitle-sessions";
export const SESSION_STORE_NAME = "sessions";
export const SESSION_RECORD_VERSION = "4";
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
  txtExportTimestampsEnabled: false,
  txtExportSpeakerEnabled: false,
  txtExportEntryNotesEnabled: false,
  runningAutoSaveEnabled: true,
  runningAutoSaveDebounceMs: 800,
  recentCopyLineCount: 5,
  debugLogging: false,
  autoStartEnabled: true,
  filterUnconfirmedEnabled: true,
  presets: [],
};

export const PIPELINE_DEFAULTS = {
  suffixLength: 50,
  previewResyncThreshold: 10,
  previewAmbiguousResyncThreshold: 6,
  confirmedCompactMaxLength: 50000,
  fallbackInternalRawMaxChars: 4096,
  fallbackPreviewMaxChars: 400,
  fallbackPreviewMaxLines: 3,
  unconfirmedFallbackAllowStreak: 6,
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
  "https://assembly.webcast.go.kr/main/player*",
  "https://webcast.assembly.go.kr/main/player*",
] as const;

const ASSEMBLY_PLAYER_PATH_PREFIX = "/main/player";
const PLENARY_XCODE = "10";
const PLENARY_XCGCD_PREFIX = "DCM000010";

export function isSupportedAssemblyUrl(url?: string): boolean {
  if (typeof url !== "string") {
    return false;
  }

  try {
    const parsed = new URL(url);
    return (
      isSupportedAssemblyHostname(parsed.hostname) &&
      parsed.pathname.toLowerCase().startsWith(ASSEMBLY_PLAYER_PATH_PREFIX)
    );
  } catch {
    return false;
  }
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

export function isAssemblyPlenaryUrl(url?: string): boolean {
  if (typeof url !== "string" || !isSupportedAssemblyUrl(url)) {
    return false;
  }

  try {
    const parsed = new URL(url);
    const xcode = parsed.searchParams.get("xcode")?.trim().toUpperCase();
    const xcgcd = parsed.searchParams.get("xcgcd")?.trim().toUpperCase();
    return xcode === PLENARY_XCODE || Boolean(xcgcd?.startsWith(PLENARY_XCGCD_PREFIX));
  } catch {
    return false;
  }
}
