import type { ExportFormat, SessionRecord } from "../core/subtitle-models";
import type { ExportPayload, SessionExportOptions } from "../storage/types";
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
  getByteLength?: (content: string) => number;
  dataUrlFallbackMaxBytes?: number;
  createDataUrlFallbackDisabledError?: (byteLength: number) => Error;
  onBlobFallbackError?: (error: unknown) => void;
}

export async function downloadExportWithFallback(
  filename: string,
  content: string,
  mimeType: string,
  dependencies: DownloadExportDependencies,
): Promise<number> {
  let byteLengthCache: number | null = null;
  const getByteLength = (): number => {
    if (byteLengthCache === null) {
      byteLengthCache = dependencies.getByteLength?.(content) ?? content.length;
    }
    return byteLengthCache;
  };
  const canUseDataUrlFallback = (): boolean =>
    typeof dependencies.dataUrlFallbackMaxBytes !== "number" ||
    getByteLength() <= dependencies.dataUrlFallbackMaxBytes;
  const resolveDataUrlFallbackError = (): Error =>
    dependencies.createDataUrlFallbackDisabledError?.(getByteLength()) ??
    new Error(`Data URL fallback disabled for large export (${getByteLength()} bytes)`);

  let blobUrl = "";
  try {
    blobUrl = await dependencies.requestBlobUrl(content, mimeType);
  } catch (error) {
    dependencies.onBlobFallbackError?.(error);
    if (!canUseDataUrlFallback()) {
      throw resolveDataUrlFallbackError();
    }
    return dependencies.downloadByUrl(dependencies.toDataUrl(content, mimeType), filename);
  }

  let downloadId: number;
  try {
    downloadId = await dependencies.downloadByUrl(blobUrl, filename);
  } catch (error) {
    await dependencies.revokeBlobUrl(blobUrl);
    dependencies.onBlobFallbackError?.(error);
    if (!canUseDataUrlFallback()) {
      throw resolveDataUrlFallbackError();
    }
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
  loadSessionRecord: (sessionId: string) => Promise<SessionRecord | undefined>;
  exportSessionRecordData: (
    session: SessionRecord,
    format: ExportFormat,
    options?: SessionExportOptions,
  ) => Promise<ExportPayload>;
  exportSessionLineageData: (
    lineageId: string,
    format: ExportFormat,
    options?: SessionExportOptions,
  ) => Promise<ExportPayload>;
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
    type === "DOWNLOAD_SESSION_EXPORT" ||
    type === "DOWNLOAD_SESSION_LINEAGE_EXPORT" ||
    type === "OPEN_HISTORY_PAGE" ||
    type === "OPEN_OPTIONS_PAGE" ||
    type === "OPEN_DIAGNOSTICS_PAGE"
  );
}

export async function handleBackgroundCommand(
  message: BackgroundCommandMessage,
  sender: chrome.runtime.MessageSender,
  dependencies: BackgroundCommandDependencies,
): Promise<BackgroundCommandResponse> {
  switch (message.type) {
    case "ENSURE_CONTENT_SCRIPT":
      if (!dependencies.supportsAssemblyPage(message.url)) {
        return {
          ok: false,
          error: "국회 의사중계 사이트에서만 동작합니다.",
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
    case "DOWNLOAD_SESSION_EXPORT": {
      const session = await dependencies.loadSessionRecord(message.sessionId);
      if (!session) {
        return { ok: false, error: "내보낼 기록을 찾지 못했습니다." };
      }

      const selectedEntries = Array.isArray(message.entryIds)
        ? session.entries.filter((entry) => message.entryIds?.includes(entry.id))
        : undefined;
      const payload = await dependencies.exportSessionRecordData(session, message.format, {
        filenamePattern: message.filenamePattern,
        txtExportTimestampsEnabled: message.txtExportTimestampsEnabled,
        entries: selectedEntries,
      });
      const downloadId = await dependencies.downloadExport(
        payload.filename,
        payload.content,
        payload.mimeType,
      );
      return { ok: true, downloadId };
    }
    case "DOWNLOAD_SESSION_LINEAGE_EXPORT": {
      const payload = await dependencies.exportSessionLineageData(message.lineageId, message.format, {
        filenamePattern: message.filenamePattern,
        txtExportTimestampsEnabled: message.txtExportTimestampsEnabled,
        entryIds: message.entryIds,
      });
      const downloadId = await dependencies.downloadExport(
        payload.filename,
        payload.content,
        payload.mimeType,
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
