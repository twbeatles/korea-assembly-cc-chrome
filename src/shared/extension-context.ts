const INVALIDATED_EXTENSION_CONTEXT_MESSAGE = "Extension context invalidated";

let extensionContextInvalidated = false;

function extractErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }

  return String(error ?? "");
}

/**
 * 확장이 언로드/업데이트되어 content script 가 더 이상 쓸 수 없는 상태.
 * 이 경우에만 permanent invalidation 을 허용한다.
 */
function isPermanentInvalidatedExtensionContextMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    message.includes(INVALIDATED_EXTENSION_CONTEXT_MESSAGE) ||
    normalized.includes("extension context invalidated")
  );
}

/**
 * 수신자 부재·SW 미기동 등 일시적 메시징 실패.
 * permanent invalidation 으로 취급하면 안 된다.
 */
export function isTransientExtensionMessagingError(error: unknown): boolean {
  const message = extractErrorMessage(error);
  if (!message) {
    return false;
  }
  const normalized = message.toLowerCase();
  return (
    message.includes("Receiving end does not exist") ||
    message.includes("Could not establish connection") ||
    normalized.includes("the message port closed before a response was received") ||
    normalized.includes("message port closed")
  );
}

export function isExtensionContextInvalidatedError(error: unknown): boolean {
  const message = extractErrorMessage(error);
  if (!message) {
    return false;
  }

  return isPermanentInvalidatedExtensionContextMessage(message);
}

export function hasExtensionContextInvalidated(): boolean {
  return extensionContextInvalidated;
}

export function markExtensionContextInvalidated(error?: unknown): boolean {
  if (extensionContextInvalidated) {
    return true;
  }

  if (typeof error === "undefined" || !isExtensionContextInvalidatedError(error)) {
    return false;
  }

  extensionContextInvalidated = true;
  return true;
}

export function invalidateExtensionContext(): void {
  extensionContextInvalidated = true;
}

export function createExtensionContextInvalidatedError(): Error {
  invalidateExtensionContext();
  return new Error(INVALIDATED_EXTENSION_CONTEXT_MESSAGE);
}

export function resetExtensionContextInvalidationForTests(): void {
  extensionContextInvalidated = false;
}
