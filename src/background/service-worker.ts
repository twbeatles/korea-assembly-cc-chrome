import { ASSEMBLY_HOST, OFFSCREEN_DOCUMENT_PATH } from "../shared/constants";
import type {
  BackgroundCommandMessage,
  BackgroundCommandResponse,
  OffscreenDocumentMessage,
  OffscreenDocumentResponse,
} from "../shared/message-types";
import { closeRunningSessionsOnStartup } from "../storage/session-store";

const OFFSCREEN_DOCUMENT_URL = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
const OFFSCREEN_JUSTIFICATION = "자막 export용 Blob URL을 생성하기 위해 필요합니다.";
const frameForwardNonceByTabId = new Map<number, string>();
const blobDownloadUrls = new Map<number, string>();

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
  return typeof url === "string" && url.startsWith(ASSEMBLY_HOST);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function toDataUrl(content: string, mimeType: string): string {
  const bytes = new TextEncoder().encode(content);
  return `data:${mimeType};base64,${bytesToBase64(bytes)}`;
}

function createNonce(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function getOrCreateFrameForwardNonce(tabId: number): string {
  const current = frameForwardNonceByTabId.get(tabId);
  if (current) {
    return current;
  }

  const next = createNonce();
  frameForwardNonceByTabId.set(tabId, next);
  return next;
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));
}

async function pingTopFrame(tabId: number): Promise<void> {
  await callbackPromise((callback) =>
    chrome.tabs.sendMessage(tabId, { type: "PING" }, { frameId: 0 }, callback),
  );
}

async function waitForTopFrameReady(tabId: number, attempts = 4): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await pingTopFrame(tabId);
      return true;
    } catch {
      if (attempt < attempts - 1) {
        await sleep(150);
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

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: ["BLOBS"],
    justification: OFFSCREEN_JUSTIFICATION,
  });
}

async function sendOffscreenMessage(
  message: OffscreenDocumentMessage,
): Promise<OffscreenDocumentResponse> {
  return callbackPromise((callback) => chrome.runtime.sendMessage(message, callback));
}

async function requestBlobUrl(content: string, mimeType: string): Promise<string> {
  await ensureOffscreenDocument();
  const response = await sendOffscreenMessage({
    type: "OFFSCREEN_CREATE_BLOB_URL",
    content,
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
  let blobUrl = "";
  try {
    blobUrl = await requestBlobUrl(content, mimeType);
    const downloadId = await downloadByUrl(blobUrl, filename);
    blobDownloadUrls.set(downloadId, blobUrl);
    return downloadId;
  } catch (blobError) {
    if (blobUrl) {
      await revokeBlobUrl(blobUrl);
    }
    console.warn("[service-worker] Blob export download failed, falling back to data URL", blobError);
    return downloadByUrl(toDataUrl(content, mimeType), filename);
  }
}

function isBackgroundCommandMessage(message: unknown): message is BackgroundCommandMessage {
  if (!message || typeof message !== "object" || !("type" in message)) {
    return false;
  }

  const type = (message as { type?: string }).type;
  return (
    type === "ENSURE_CONTENT_SCRIPT" ||
    type === "GET_FRAME_FORWARD_NONCE" ||
    type === "DOWNLOAD_REQUEST" ||
    type === "OPEN_HISTORY_PAGE" ||
    type === "OPEN_OPTIONS_PAGE"
  );
}

async function handleMessage(
  message: BackgroundCommandMessage,
  sender: chrome.runtime.MessageSender,
): Promise<BackgroundCommandResponse> {
  switch (message.type) {
    case "ENSURE_CONTENT_SCRIPT":
      if (!supportsAssemblyPage(message.url)) {
        return {
          ok: false,
          error: "국회 의사중계 페이지에서만 동작합니다.",
        };
      }
      if (await waitForTopFrameReady(message.tabId)) {
        return { ok: true, ready: true, requiresReload: false };
      }

      try {
        await injectConfiguredContentScripts(message.tabId);
      } catch (error) {
        console.warn("[service-worker] Failed to inject configured content scripts", error);
      }

      if (await waitForTopFrameReady(message.tabId)) {
        return { ok: true, ready: true, requiresReload: false };
      }

      return { ok: true, ready: false, requiresReload: true };
    case "GET_FRAME_FORWARD_NONCE": {
      const tabId = sender.tab?.id;
      if (typeof tabId !== "number") {
        return { ok: false, error: "탭 정보를 확인하지 못했습니다." };
      }
      return { ok: true, nonce: getOrCreateFrameForwardNonce(tabId) };
    }
    case "DOWNLOAD_REQUEST": {
      const downloadId = await downloadExport(
        message.filename,
        message.content,
        message.mimeType,
      );
      return { ok: true, downloadId };
    }
    case "OPEN_HISTORY_PAGE":
      await openHistoryPage();
      return { ok: true };
    case "OPEN_OPTIONS_PAGE":
      await openOptionsPage();
      return { ok: true };
  }
}

async function runStartupSessionCleanup(): Promise<void> {
  try {
    const closed = await closeRunningSessionsOnStartup();
    if (closed > 0) {
      console.info(`[service-worker] Closed ${closed} stale running session(s) on startup`);
    }
  } catch (error) {
    console.warn("[service-worker] Failed to close stale running sessions on startup", error);
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
  void revokeBlobUrl(blobUrl);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  frameForwardNonceByTabId.delete(tabId);
});

chrome.runtime.onStartup.addListener(() => {
  void runStartupSessionCleanup();
});

chrome.runtime.onInstalled.addListener(() => {
  void runStartupSessionCleanup();
});
