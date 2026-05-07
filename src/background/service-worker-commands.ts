import type { SessionRecord } from "../core/subtitle-models";
import type {
  BackgroundCommandMessage,
  BackgroundCommandResponse,
} from "../shared/message-types";

export interface DownloadExportDependencies {
  requestBlobUrl: (content: string, mimeType: string) => Promise<string>;
  downloadByUrl: (url: string, filename: string) => Promise<number>;
  persistBlobDownload: (downloadId: number, blobUrl: string) => Promise<void>;
  revokeBlobUrl: (url: string) => Promise<void>;
  toDataUrl: (content: string, mimeType: string) => string;
  onBlobFallbackError?: (error: unknown) => void;
}

export async function downloadExportWithFallback(
  filename: string,
  content: string,
  mimeType: string,
  dependencies: DownloadExportDependencies,
): Promise<number> {
  let blobUrl = "";
  try {
    blobUrl = await dependencies.requestBlobUrl(content, mimeType);
  } catch (error) {
    dependencies.onBlobFallbackError?.(error);
    return dependencies.downloadByUrl(dependencies.toDataUrl(content, mimeType), filename);
  }

  let downloadId: number;
  try {
    downloadId = await dependencies.downloadByUrl(blobUrl, filename);
  } catch (error) {
    await dependencies.revokeBlobUrl(blobUrl);
    dependencies.onBlobFallbackError?.(error);
    return dependencies.downloadByUrl(dependencies.toDataUrl(content, mimeType), filename);
  }

  try {
    await dependencies.persistBlobDownload(downloadId, blobUrl);
  } catch (error) {
    console.warn(
      "[background] Blob download metadata persistence failed; keeping runtime mapping only.",
      error,
    );
  }

  return downloadId;
}

export interface BackgroundCommandDependencies {
  supportsAssemblyPage: (url?: string) => boolean;
  waitForTopFrameReady: (tabId: number) => Promise<boolean>;
  injectConfiguredContentScripts: (tabId: number) => Promise<void>;
  onInjectConfiguredContentScriptsError?: (error: unknown) => void;
  getOrCreateStoredFrameForwardNonce: (tabId: number) => Promise<string>;
  queueExitPersistRecord: (record: SessionRecord) => Promise<void>;
  persistSessionRecord: (record: SessionRecord) => Promise<{ updatedAt: string }>;
  deleteSessionRecord: (sessionId: string) => Promise<void>;
  downloadExport: (filename: string, content: string, mimeType: string) => Promise<number>;
  openHistoryPage: () => Promise<void>;
  openOptionsPage: () => Promise<void>;
  openDiagnosticsPage: (tabId?: number) => Promise<void>;
}

export function isBackgroundCommandMessage(message: unknown): message is BackgroundCommandMessage {
  if (!message || typeof message !== "object" || !("type" in message)) {
    return false;
  }

  const type = (message as { type?: string }).type;
  return (
    type === "ENSURE_CONTENT_SCRIPT" ||
    type === "GET_FRAME_FORWARD_NONCE" ||
    type === "QUEUE_EXIT_PERSIST_RECORD" ||
    type === "PERSIST_SESSION_RECORD" ||
    type === "DELETE_SESSION_RECORD" ||
    type === "DOWNLOAD_REQUEST" ||
    type === "OPEN_HISTORY_PAGE" ||
    type === "OPEN_OPTIONS_PAGE" ||
    type === "OPEN_DIAGNOSTICS_PAGE"
  );
}

function isMessageFromOwnExtension(sender: chrome.runtime.MessageSender): boolean {
  // Reject messages whose sender id does not match our own extension. This is
  // a defense-in-depth check — Chrome already routes externally_connectable
  // messages through a separate event listener — but it costs nothing to
  // verify and makes the boundary explicit for security review.
  if (typeof chrome === "undefined" || !chrome.runtime?.id) {
    return true;
  }
  return !sender.id || sender.id === chrome.runtime.id;
}

export async function handleBackgroundCommand(
  message: BackgroundCommandMessage,
  sender: chrome.runtime.MessageSender,
  dependencies: BackgroundCommandDependencies,
): Promise<BackgroundCommandResponse> {
  if (!isMessageFromOwnExtension(sender)) {
    return {
      ok: false,
      error: "외부 발신자의 명령을 거부했습니다.",
    };
  }

  switch (message.type) {
    case "ENSURE_CONTENT_SCRIPT":
      if (!dependencies.supportsAssemblyPage(message.url)) {
        return {
          ok: false,
          error: "국회 의사중계 플레이어 페이지에서만 동작합니다.",
        };
      }
      if (await dependencies.waitForTopFrameReady(message.tabId)) {
        return { ok: true, ready: true, requiresReload: false };
      }

      try {
        await dependencies.injectConfiguredContentScripts(message.tabId);
      } catch (error) {
        dependencies.onInjectConfiguredContentScriptsError?.(error);
      }

      if (await dependencies.waitForTopFrameReady(message.tabId)) {
        return { ok: true, ready: true, requiresReload: false };
      }

      return { ok: true, ready: false, requiresReload: true };
    case "GET_FRAME_FORWARD_NONCE": {
      const tabId = sender.tab?.id;
      if (typeof tabId !== "number") {
        return { ok: false, error: "탭 정보를 확인하지 못했습니다." };
      }
      return { ok: true, nonce: await dependencies.getOrCreateStoredFrameForwardNonce(tabId) };
    }
    case "QUEUE_EXIT_PERSIST_RECORD":
      await dependencies.queueExitPersistRecord(message.record);
      return { ok: true };
    case "PERSIST_SESSION_RECORD": {
      const saved = await dependencies.persistSessionRecord(message.record);
      return { ok: true, updatedAt: saved.updatedAt };
    }
    case "DELETE_SESSION_RECORD":
      await dependencies.deleteSessionRecord(message.sessionId);
      return { ok: true };
    case "DOWNLOAD_REQUEST": {
      const downloadId = await dependencies.downloadExport(
        message.filename,
        message.content,
        message.mimeType,
      );
      return { ok: true, downloadId };
    }
    case "OPEN_HISTORY_PAGE":
      await dependencies.openHistoryPage();
      return { ok: true };
    case "OPEN_OPTIONS_PAGE":
      await dependencies.openOptionsPage();
      return { ok: true };
    case "OPEN_DIAGNOSTICS_PAGE":
      await dependencies.openDiagnosticsPage(message.tabId ?? sender.tab?.id);
      return { ok: true };
  }
}
