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

/** content script → SW 의 DOWNLOAD_REQUEST 본문 상한 (data URL fallback 과 동일 계열). */
export const DOWNLOAD_REQUEST_MAX_BYTES = 2 * 1024 * 1024;

/** PERSIST/QUEUE 메시지 세션 페이로드 방어 상한 (entry 개수). */
export const PERSIST_SESSION_RECORD_MAX_ENTRIES = 50_000;
/** persist 메시지 본문 바이트 상한. SW 메모리와 storage.local 을 보호한다. */
export const PERSIST_SESSION_RECORD_MAX_BYTES = 8 * 1024 * 1024;
const PERSIST_SESSION_ID_MAX_LENGTH = 128;

export function getUtf8ContentByteLength(content: string): number {
  return new TextEncoder().encode(content).length;
}

/**
 * background persist 경계 최소 스키마 검증.
 * 상세 정규화는 saveSession/normalizeSessionRecord 가 수행한다.
 */
export function isValidPersistSessionRecordPayload(
  value: unknown,
): value is SessionRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Partial<SessionRecord>;
  if (typeof record.id !== "string" || !record.id.trim()) {
    return false;
  }
  if (record.id.trim().length > PERSIST_SESSION_ID_MAX_LENGTH) {
    return false;
  }
  if (
    record.status !== "running" &&
    record.status !== "stopped" &&
    record.status !== "saved"
  ) {
    return false;
  }
  if (typeof record.updatedAt !== "string" || !record.updatedAt) {
    return false;
  }
  if (!Array.isArray(record.entries)) {
    return false;
  }
  if (record.entries.length > PERSIST_SESSION_RECORD_MAX_ENTRIES) {
    return false;
  }
  try {
    const encoded = JSON.stringify(record);
    if (getUtf8ContentByteLength(encoded) > PERSIST_SESSION_RECORD_MAX_BYTES) {
      return false;
    }
  } catch {
    return false;
  }
  return true;
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
  openSidePanel?: (tabId?: number) => Promise<void>;
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
    type === "OPEN_SIDE_PANEL" ||
    type === "OPEN_DIAGNOSTICS_PAGE"
  );
}

export function isMessageFromOwnExtension(sender: chrome.runtime.MessageSender): boolean {
  // 운영 빌드에서는 확장 id 가 반드시 있다. sender.id 가 없거나 다르면 거부.
  const ownId = typeof chrome !== "undefined" ? chrome.runtime?.id : undefined;
  if (!ownId) {
    return false;
  }
  return sender.id === ownId;
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
      if (!isValidPersistSessionRecordPayload(message.record)) {
        return { ok: false, error: "종료 저장 큐 페이로드가 올바르지 않습니다." };
      }
      if (message.record.status !== "stopped") {
        return { ok: false, error: "종료 저장 큐는 stopped 세션만 허용합니다." };
      }
      await dependencies.queueExitPersistRecord(message.record);
      return { ok: true };
    case "PERSIST_SESSION_RECORD": {
      if (!isValidPersistSessionRecordPayload(message.record)) {
        return { ok: false, error: "세션 저장 페이로드가 올바르지 않습니다." };
      }
      const saved = await dependencies.persistSessionRecord(message.record);
      return { ok: true, updatedAt: saved.updatedAt };
    }
    case "DELETE_SESSION_RECORD":
      if (typeof message.sessionId !== "string" || !message.sessionId.trim()) {
        return { ok: false, error: "삭제할 세션 id가 올바르지 않습니다." };
      }
      await dependencies.deleteSessionRecord(message.sessionId);
      return { ok: true };
    case "DOWNLOAD_REQUEST": {
      const content = typeof message.content === "string" ? message.content : "";
      const byteLength = getUtf8ContentByteLength(content);
      if (byteLength > DOWNLOAD_REQUEST_MAX_BYTES) {
        return {
          ok: false,
          error: `다운로드 요청 본문이 너무 큽니다 (${byteLength} bytes). 세션/라인리지 내보내기 경로를 사용하세요.`,
        };
      }
      const downloadId = await dependencies.downloadExport(
        message.filename,
        content,
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
        txtExportSpeakerEnabled: message.txtExportSpeakerEnabled,
        txtExportEntryNotesEnabled: message.txtExportEntryNotesEnabled,
        filenameSuffix: message.filenameSuffix,
        entries: selectedEntries,
        timeRange: message.timeRange,
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
        txtExportSpeakerEnabled: message.txtExportSpeakerEnabled,
        txtExportEntryNotesEnabled: message.txtExportEntryNotesEnabled,
        entryIds: message.entryIds,
        filenameSuffix: message.filenameSuffix,
        timeRange: message.timeRange,
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
    case "OPEN_SIDE_PANEL":
      if (!dependencies.openSidePanel) {
        return { ok: false, error: "사이드 패널 API를 사용할 수 없습니다." };
      }
      await dependencies.openSidePanel(message.tabId ?? sender.tab?.id);
      return { ok: true };
    case "OPEN_DIAGNOSTICS_PAGE":
      await dependencies.openDiagnosticsPage(message.tabId ?? sender.tab?.id);
      return { ok: true };
  }
}
