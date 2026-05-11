import { isSupportedAssemblySiteUrl, OFFSCREEN_DOCUMENT_PATH } from "../shared/constants";
import { runStartupPersistenceMaintenance } from "./startup-persistence";
import {
  handleFrameForwardNonceTabRemoved,
  handleFrameForwardNonceTabUpdated,
} from "./frame-forward-nonce-lifecycle";
import {
  clearPersistedFrameForwardNonce,
  getOrCreatePersistedFrameForwardNonce,
  rotatePersistedFrameForwardNonce,
} from "./frame-forward-nonce-store";
import {
  downloadExportWithFallback,
  handleBackgroundCommand,
  isBackgroundCommandMessage,
} from "./service-worker-commands";
import { splitContentForBlobParts } from "./export-content";
import type {
  BackgroundCommandMessage,
  BackgroundCommandResponse,
  OffscreenDocumentMessage,
  OffscreenDocumentResponse,
} from "../shared/message-types";
import {
  deleteSession,
  exportSessionData,
  exportSessionLineageData,
  loadSession,
  saveSession,
  updateRunningSession,
} from "../storage/session-store";
import { queueExitPersistRecord } from "../storage/persist-recovery";
import { createRandomToken } from "../shared/random-token";

const OFFSCREEN_DOCUMENT_URL = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
const OFFSCREEN_JUSTIFICATION = "자막 export용 Blob URL을 생성하기 위해 필요합니다.";
const frameForwardNonceByTabId = new Map<number, string>();
const blobDownloadUrls = new Map<number, string>();
// Tracks Blob download IDs created during the current service worker
// generation. URLs missing from this set were restored from storage and now
// live in a defunct offscreen document, so the `URL.revokeObjectURL` round
// trip would be a no-op.
const blobDownloadUrlsCreatedThisGeneration = new Set<number>();
const BLOB_DOWNLOAD_URLS_STORAGE_KEY = "assembly-subtitle-download-blob-urls";
const TOP_FRAME_READY_ATTEMPTS = 8;
const TOP_FRAME_READY_RETRY_DELAY_MS = 150;
const OFFSCREEN_BLOB_CHUNK_SIZE = 512 * 1024;
const DATA_URL_FALLBACK_MAX_BYTES = 2 * 1024 * 1024;

function callbackPromise<T>(executor: (callback: (value: T) => void) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    executor((value) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      resolve(value);
    });
  });
}

function supportsAssemblyPage(url?: string): boolean {
  return isSupportedAssemblySiteUrl(url);
}

async function persistBlobDownloadUrls(): Promise<void> {
  await chrome.storage.local.set({
    [BLOB_DOWNLOAD_URLS_STORAGE_KEY]: Object.fromEntries(blobDownloadUrls.entries()),
  });
}

async function restoreBlobDownloadUrls(): Promise<void> {
  const stored = await chrome.storage.local.get(BLOB_DOWNLOAD_URLS_STORAGE_KEY);
  const snapshot = stored[BLOB_DOWNLOAD_URLS_STORAGE_KEY];
  blobDownloadUrls.clear();
  if (!snapshot || typeof snapshot !== "object") {
    return;
  }

  Object.entries(snapshot as Record<string, unknown>).forEach(([key, value]) => {
    const downloadId = Number(key);
    if (Number.isInteger(downloadId) && typeof value === "string" && value) {
      blobDownloadUrls.set(downloadId, value);
    }
  });
}

async function cleanupPersistedBlobDownloadUrls(): Promise<void> {
  try {
    await restoreBlobDownloadUrls();
    if (blobDownloadUrls.size === 0) {
      return;
    }

    for (const [downloadId, blobUrl] of [...blobDownloadUrls.entries()]) {
      const items = await callbackPromise<chrome.downloads.DownloadItem[]>((callback) =>
        chrome.downloads.search({ id: downloadId }, callback),
      );
      const state = items[0]?.state;
      if (!state || state === "complete" || state === "interrupted") {
        blobDownloadUrls.delete(downloadId);
        // Only revoke when this URL was created during the current SW
        // generation. Restored entries reference a URL inside a defunct
        // offscreen document, so the cross-context revoke message is a
        // useless round-trip.
        if (blobDownloadUrlsCreatedThisGeneration.has(downloadId)) {
          blobDownloadUrlsCreatedThisGeneration.delete(downloadId);
          await revokeBlobUrl(blobUrl);
        }
      }
    }
    await persistBlobDownloadUrls();
  } catch (error) {
    console.warn("[service-worker] Failed to restore persisted Blob URLs", error);
  }
}

const BASE64_BINARY_CHUNK_SIZE = 0x8000;

function bytesToBase64(bytes: Uint8Array): string {
  if (bytes.length === 0) {
    return "";
  }

  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += BASE64_BINARY_CHUNK_SIZE) {
    const slice = bytes.subarray(offset, offset + BASE64_BINARY_CHUNK_SIZE);
    chunks.push(String.fromCharCode(...slice));
  }
  return btoa(chunks.join(""));
}

function toDataUrl(content: string, mimeType: string): string {
  const bytes = new TextEncoder().encode(content);
  return `data:${mimeType};base64,${bytesToBase64(bytes)}`;
}

function getUtf8ByteLength(content: string): number {
  return new TextEncoder().encode(content).length;
}

function createNonce(): string {
  return createRandomToken();
}

function isOffscreenDocumentAlreadyExistsError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  if (!message) {
    return false;
  }

  const normalized = message.toLowerCase();
  return (
    normalized.includes("already exists") ||
    normalized.includes("single offscreen document")
  );
}

async function getOrCreateStoredFrameForwardNonce(tabId: number): Promise<string> {
  return getOrCreatePersistedFrameForwardNonce({
    tabId,
    cache: frameForwardNonceByTabId,
    storage: chrome.storage.local,
    createNonce,
  });
}

async function rotateStoredFrameForwardNonce(tabId: number): Promise<string> {
  return rotatePersistedFrameForwardNonce({
    tabId,
    cache: frameForwardNonceByTabId,
    storage: chrome.storage.local,
    createNonce,
  });
}

async function clearStoredFrameForwardNonce(tabId: number): Promise<void> {
  await clearPersistedFrameForwardNonce({
    tabId,
    cache: frameForwardNonceByTabId,
    storage: chrome.storage.local,
  });
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));
}

async function pingTopFrame(tabId: number): Promise<void> {
  await callbackPromise((callback) =>
    chrome.tabs.sendMessage(tabId, { type: "PING" }, { frameId: 0 }, callback),
  );
}

async function waitForTopFrameReady(
  tabId: number,
  attempts = TOP_FRAME_READY_ATTEMPTS,
): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await pingTopFrame(tabId);
      return true;
    } catch {
      if (attempt < attempts - 1) {
        await sleep(TOP_FRAME_READY_RETRY_DELAY_MS);
      }
    }
  }

  return false;
}

async function injectConfiguredContentScripts(tabId: number): Promise<void> {
  const manifestContentScripts = chrome.runtime.getManifest().content_scripts ?? [];
  for (const script of manifestContentScripts) {
    if (!script.js?.length) {
      continue;
    }

    await chrome.scripting.executeScript({
      target: {
        tabId,
        allFrames: Boolean(script.all_frames),
      },
      files: [...script.js],
    });
  }
}

async function openHistoryPage(): Promise<void> {
  await callbackPromise((callback) =>
    chrome.tabs.create({ url: chrome.runtime.getURL("history.html") }, callback),
  );
}

async function openOptionsPage(): Promise<void> {
  await callbackPromise<void>((callback) => chrome.runtime.openOptionsPage(callback));
}

async function openSidePanel(tabId?: number): Promise<void> {
  const runtimeWithSidePanel = chrome as typeof chrome & {
    sidePanel?: {
      open?: (options: { tabId?: number; windowId?: number }) => Promise<void>;
      setOptions?: (options: { tabId?: number; path?: string; enabled?: boolean }) => Promise<void>;
    };
  };

  if (!runtimeWithSidePanel.sidePanel?.open) {
    await callbackPromise((callback) =>
      chrome.tabs.create({ url: chrome.runtime.getURL("sidepanel.html") }, callback),
    );
    return;
  }

  if (runtimeWithSidePanel.sidePanel.setOptions && typeof tabId === "number") {
    await runtimeWithSidePanel.sidePanel.setOptions({
      tabId,
      path: "sidepanel.html",
      enabled: true,
    });
  }
  await runtimeWithSidePanel.sidePanel.open(
    typeof tabId === "number" ? { tabId } : {},
  );
}

async function openDiagnosticsPage(tabId?: number): Promise<void> {
  const url = new URL(chrome.runtime.getURL("options.html"));
  url.searchParams.set("view", "diagnostics");
  if (typeof tabId === "number") {
    url.searchParams.set("tabId", String(tabId));
  }

  await callbackPromise((callback) => chrome.tabs.create({ url: url.toString() }, callback));
}

async function ensureOffscreenDocument(): Promise<void> {
  if (!chrome.offscreen?.createDocument) {
    throw new Error("Offscreen document API를 사용할 수 없습니다.");
  }

  const runtimeWithContexts = chrome.runtime as typeof chrome.runtime & {
    getContexts?: (filter: {
      contextTypes?: string[];
      documentUrls?: string[];
    }) => Promise<Array<{ contextType?: string; documentUrl?: string }>>;
  };

  if (runtimeWithContexts.getContexts) {
    const contexts = await runtimeWithContexts.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [OFFSCREEN_DOCUMENT_URL],
    });
    if (contexts.length > 0) {
      return;
    }
  }

  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ["BLOBS"],
      justification: OFFSCREEN_JUSTIFICATION,
    });
  } catch (error) {
    if (!isOffscreenDocumentAlreadyExistsError(error)) {
      throw error;
    }
  }
}

async function sendOffscreenMessage(
  message: OffscreenDocumentMessage,
): Promise<OffscreenDocumentResponse> {
  return callbackPromise((callback) => chrome.runtime.sendMessage(message, callback));
}

async function requestBlobUrl(content: string, mimeType: string): Promise<string> {
  await ensureOffscreenDocument();
  const contentParts = splitContentForBlobParts(content, OFFSCREEN_BLOB_CHUNK_SIZE);
  const response = await sendOffscreenMessage({
    type: "OFFSCREEN_CREATE_BLOB_URL",
    content: contentParts.length === 1 ? contentParts[0] : undefined,
    contentParts: contentParts.length > 1 ? contentParts : undefined,
    mimeType,
  });
  if (!response.ok || !response.url) {
    throw new Error(response.ok ? "Blob URL을 생성하지 못했습니다." : response.error);
  }
  return response.url;
}

async function revokeBlobUrl(url: string): Promise<void> {
  try {
    await sendOffscreenMessage({
      type: "OFFSCREEN_REVOKE_BLOB_URL",
      url,
    });
  } catch (error) {
    console.warn("[service-worker] Failed to revoke Blob URL", error);
  }
}

async function downloadByUrl(url: string, filename: string): Promise<number> {
  return callbackPromise((callback) =>
    chrome.downloads.download(
      {
        url,
        filename,
        saveAs: true,
        conflictAction: "uniquify",
      },
      callback,
    ),
  );
}

async function downloadExport(
  filename: string,
  content: string,
  mimeType: string,
): Promise<number> {
  return downloadExportWithFallback(filename, content, mimeType, {
    requestBlobUrl,
    downloadByUrl,
    persistBlobDownload: async (downloadId, blobUrl) => {
      blobDownloadUrls.set(downloadId, blobUrl);
      blobDownloadUrlsCreatedThisGeneration.add(downloadId);
      await persistBlobDownloadUrls();
    },
    revokeBlobUrl,
    toDataUrl,
    getByteLength: getUtf8ByteLength,
    dataUrlFallbackMaxBytes: DATA_URL_FALLBACK_MAX_BYTES,
    createDataUrlFallbackDisabledError: (byteLength) =>
      new Error(`Data URL fallback disabled for large export (${byteLength} bytes)`),
    onBlobFallbackError: (error) => {
      console.warn("[service-worker] Blob export download failed; evaluating fallback path", error);
    },
  });
}

async function handleMessage(
  message: BackgroundCommandMessage,
  sender: chrome.runtime.MessageSender,
): Promise<BackgroundCommandResponse> {
  return handleBackgroundCommand(message, sender, {
    supportsAssemblyPage,
    waitForTopFrameReady,
    injectConfiguredContentScripts,
    onInjectConfiguredContentScriptsError: (error) => {
      console.warn("[service-worker] Failed to inject configured content scripts", error);
    },
    getOrCreateStoredFrameForwardNonce,
    queueExitPersistRecord,
    persistSessionRecord: async (record) => {
      const saved =
        record.status === "running"
          ? await updateRunningSession(record)
          : await saveSession(record);
      return { updatedAt: saved.updatedAt };
    },
    deleteSessionRecord: deleteSession,
    loadSessionRecord: loadSession,
    exportSessionRecordData: exportSessionData,
    exportSessionLineageData,
    downloadExport,
    openHistoryPage,
    openOptionsPage,
    openSidePanel,
    openDiagnosticsPage,
  });
}

const STARTUP_DEDUP_WINDOW_MS = 5_000;
let lastStartupSessionCleanupAt = 0;
let inFlightStartupSessionCleanup: Promise<void> | null = null;

async function runStartupSessionCleanup(): Promise<void> {
  // onStartup and onInstalled can fire back-to-back during browser launch +
  // auto-update. Coalesce concurrent calls and ignore rapid re-entries so the
  // session-library revision does not bump twice for no reason.
  if (inFlightStartupSessionCleanup) {
    return inFlightStartupSessionCleanup;
  }
  if (Date.now() - lastStartupSessionCleanupAt < STARTUP_DEDUP_WINDOW_MS) {
    return;
  }

  inFlightStartupSessionCleanup = (async () => {
    await cleanupPersistedBlobDownloadUrls();
    try {
      const result = await runStartupPersistenceMaintenance();
      if (result.replaySummary.replayedCount > 0 || result.cleanupSummary.closedCount > 0) {
        console.info(
          `[service-worker] Replayed ${result.replaySummary.replayedCount} queued exit record(s); closed ${result.cleanupSummary.closedCount} stale running session(s) on startup`,
        );
      }
      if (
        result.diagnostics.lastError ||
        result.replaySummary.failedCount > 0 ||
        result.cleanupSummary.failedCount > 0
      ) {
        console.warn("[service-worker] Startup persistence maintenance finished with failures", result);
      }
    } catch (error) {
      console.warn("[service-worker] Failed to run startup persistence maintenance", error);
    } finally {
      lastStartupSessionCleanupAt = Date.now();
    }
  })();

  try {
    await inFlightStartupSessionCleanup;
  } finally {
    inFlightStartupSessionCleanup = null;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isBackgroundCommandMessage(message)) {
    return undefined;
  }

  void handleMessage(message, sender)
    .then(sendResponse)
    .catch((error: unknown) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Background command failed",
      } satisfies BackgroundCommandResponse);
    });
  return true;
});

chrome.downloads.onChanged.addListener((delta) => {
  const state = delta.state?.current;
  if (!state || (state !== "complete" && state !== "interrupted")) {
    return;
  }

  const blobUrl = blobDownloadUrls.get(delta.id);
  if (!blobUrl) {
    return;
  }

  blobDownloadUrls.delete(delta.id);
  void persistBlobDownloadUrls();
  if (blobDownloadUrlsCreatedThisGeneration.delete(delta.id)) {
    void revokeBlobUrl(blobUrl);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void handleFrameForwardNonceTabRemoved(tabId, clearStoredFrameForwardNonce);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  void handleFrameForwardNonceTabUpdated(tabId, changeInfo, rotateStoredFrameForwardNonce);
});

chrome.runtime.onStartup.addListener(() => {
  void runStartupSessionCleanup();
});

chrome.runtime.onInstalled.addListener(() => {
  void runStartupSessionCleanup();
});
