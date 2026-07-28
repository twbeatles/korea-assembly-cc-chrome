import type { ExportPayload } from "../storage/types";

/** saveAs 대화상자·대형 파일 전송을 고려한 안전망. complete 전 정상 경로에서는 사용하지 않는다. */
export const DEFAULT_REVOKE_TIMEOUT_MS = 10 * 60 * 1000;
/** downloads API 없는 anchor fallback 전용 최소 유지 시간 */
export const ANCHOR_FALLBACK_REVOKE_TIMEOUT_MS = 2 * 60 * 1000;

interface PageBlobDownloadDependencies {
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
  setTimeoutFn?: (callback: () => void, delayMs: number) => number;
  clearTimeoutFn?: (timerId: number) => void;
  documentRef?: Document;
  chromeDownloads?: typeof chrome.downloads;
  chromeRuntime?: typeof chrome.runtime;
  revokeTimeoutMs?: number;
  anchorRevokeTimeoutMs?: number;
}

function fallbackAnchorDownload(
  url: string,
  filename: string,
  documentRef: Document,
): void {
  const anchor = documentRef.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  documentRef.body.append(anchor);
  anchor.click();
  anchor.remove();
}

export function downloadPageBlobExport(
  payload: Pick<ExportPayload, "filename" | "mimeType" | "content">,
  dependencies: PageBlobDownloadDependencies = {},
): Promise<number | null> {
  const createObjectUrl = dependencies.createObjectUrl ?? URL.createObjectURL.bind(URL);
  const revokeObjectUrl = dependencies.revokeObjectUrl ?? URL.revokeObjectURL.bind(URL);
  const setTimeoutFn =
    dependencies.setTimeoutFn ??
    ((callback, delayMs) => window.setTimeout(callback, delayMs));
  const clearTimeoutFn =
    dependencies.clearTimeoutFn ??
    ((timerId) => window.clearTimeout(timerId));
  const documentRef =
    dependencies.documentRef ?? (typeof document !== "undefined" ? document : undefined);
  const chromeDownloads =
    dependencies.chromeDownloads ??
    (typeof chrome !== "undefined" ? chrome.downloads : undefined);
  const chromeRuntime =
    dependencies.chromeRuntime ??
    (typeof chrome !== "undefined" ? chrome.runtime : undefined);
  const revokeTimeoutMs = dependencies.revokeTimeoutMs ?? DEFAULT_REVOKE_TIMEOUT_MS;
  const anchorRevokeTimeoutMs =
    dependencies.anchorRevokeTimeoutMs ?? ANCHOR_FALLBACK_REVOKE_TIMEOUT_MS;
  const blob = new Blob([payload.content], { type: payload.mimeType });
  const blobUrl = createObjectUrl(blob);

  return new Promise((resolve, reject) => {
    let settled = false;
    let downloadId: number | null = null;
    let timerId: number | null = null;
    let listenerAttached = false;
    let cleaned = false;

    const cleanup = (): void => {
      if (cleaned) {
        return;
      }
      cleaned = true;
      if (timerId !== null) {
        clearTimeoutFn(timerId);
        timerId = null;
      }
      if (listenerAttached && chromeDownloads?.onChanged) {
        chromeDownloads.onChanged.removeListener(handleDownloadChanged);
        listenerAttached = false;
      }
      revokeObjectUrl(blobUrl);
    };

    const armSafetyTimer = (timeoutMs: number): void => {
      if (timerId !== null) {
        clearTimeoutFn(timerId);
      }
      timerId = setTimeoutFn(() => {
        timerId = null;
        cleanup();
      }, timeoutMs);
    };

    const settleResolve = (value: number | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };

    const settleReject = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };

    function handleDownloadChanged(delta: chrome.downloads.DownloadDelta): void {
      if (downloadId === null || delta.id !== downloadId || !delta.state?.current) {
        return;
      }
      // complete/interrupted 이전에는 Blob URL 을 유지한다.
      if (delta.state.current === "complete" || delta.state.current === "interrupted") {
        cleanup();
      }
    }

    if (!chromeDownloads?.download) {
      if (!documentRef) {
        settleReject(new Error("페이지 다운로드를 시작할 수 없습니다."));
        return;
      }
      fallbackAnchorDownload(blobUrl, payload.filename, documentRef);
      armSafetyTimer(anchorRevokeTimeoutMs);
      settleResolve(null);
      return;
    }

    if (chromeDownloads.onChanged) {
      chromeDownloads.onChanged.addListener(handleDownloadChanged);
      listenerAttached = true;
    }
    chromeDownloads.download(
      {
        url: blobUrl,
        filename: payload.filename,
        saveAs: true,
        conflictAction: "uniquify",
      },
      (nextDownloadId) => {
        const lastError = chromeRuntime?.lastError;
        if (lastError) {
          settleReject(new Error(lastError.message));
          return;
        }
        if (typeof nextDownloadId !== "number") {
          settleReject(new Error("다운로드를 시작하지 못했습니다."));
          return;
        }

        downloadId = nextDownloadId;
        // 시작 성공 후에만 안전망 타이머를 건다. 정상 종료는 onChanged complete.
        armSafetyTimer(revokeTimeoutMs);
        settleResolve(nextDownloadId);
      },
    );
  });
}
