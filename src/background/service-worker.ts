import { ASSEMBLY_HOST } from "../shared/constants";
import type {
  BackgroundCommandMessage,
  BackgroundCommandResponse,
} from "../shared/message-types";

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

async function pingTopFrame(tabId: number): Promise<void> {
  await callbackPromise((callback) =>
    chrome.tabs.sendMessage(tabId, { type: "PING" }, { frameId: 0 }, callback),
  );
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

async function downloadExport(
  filename: string,
  content: string,
  mimeType: string,
): Promise<number> {
  return callbackPromise((callback) =>
    chrome.downloads.download(
      {
        url: toDataUrl(content, mimeType),
        filename,
        saveAs: true,
        conflictAction: "uniquify",
      },
      callback,
    ),
  );
}

async function openHistoryPage(): Promise<void> {
  await callbackPromise((callback) =>
    chrome.tabs.create({ url: chrome.runtime.getURL("history.html") }, callback),
  );
}

async function openOptionsPage(): Promise<void> {
  await callbackPromise<void>((callback) => chrome.runtime.openOptionsPage(callback));
}

async function handleMessage(
  message: BackgroundCommandMessage,
): Promise<BackgroundCommandResponse> {
  switch (message.type) {
    case "ENSURE_CONTENT_SCRIPT":
      if (!supportsAssemblyPage(message.url)) {
        return {
          ok: false,
          error: "국회 의사중계 페이지에서만 동작합니다.",
        };
      }
      try {
        await pingTopFrame(message.tabId);
        return { ok: true, ready: true, requiresReload: false };
      } catch {
        return { ok: true, ready: false, requiresReload: true };
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void handleMessage(message as BackgroundCommandMessage)
    .then(sendResponse)
    .catch((error: unknown) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Background command failed",
      } satisfies BackgroundCommandResponse);
    });
  return true;
});
