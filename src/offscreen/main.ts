import type {
  OffscreenDocumentMessage,
  OffscreenDocumentResponse,
} from "../shared/message-types";

const activeBlobUrls = new Set<string>();

function isOffscreenDocumentMessage(message: unknown): message is OffscreenDocumentMessage {
  if (!message || typeof message !== "object" || !("type" in message)) {
    return false;
  }

  const type = (message as { type?: string }).type;
  return type === "OFFSCREEN_CREATE_BLOB_URL" || type === "OFFSCREEN_REVOKE_BLOB_URL";
}

function createBlobUrl(content: string, mimeType: string): string {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  activeBlobUrls.add(url);
  return url;
}

function revokeBlobUrl(url: string): void {
  if (!activeBlobUrls.has(url)) {
    return;
  }

  URL.revokeObjectURL(url);
  activeBlobUrls.delete(url);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isOffscreenDocumentMessage(message)) {
    return undefined;
  }

  try {
    switch (message.type) {
      case "OFFSCREEN_CREATE_BLOB_URL":
        sendResponse({
          ok: true,
          url: createBlobUrl(message.content, message.mimeType),
        } satisfies OffscreenDocumentResponse);
        return true;
      case "OFFSCREEN_REVOKE_BLOB_URL":
        revokeBlobUrl(message.url);
        sendResponse({ ok: true } satisfies OffscreenDocumentResponse);
        return true;
    }
  } catch (error) {
    sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : "Offscreen document failed",
    } satisfies OffscreenDocumentResponse);
    return true;
  }
});
