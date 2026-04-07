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

function isInvalidatedExtensionContextMessage(message: string): boolean {
  return (
    message.includes(INVALIDATED_EXTENSION_CONTEXT_MESSAGE) ||
    message.includes("Could not establish connection. Receiving end does not exist.") ||
    message.includes("Receiving end does not exist")
  );
}

export function isExtensionContextInvalidatedError(error: unknown): boolean {
  const message = extractErrorMessage(error);
  if (!message) {
    return false;
  }

  return isInvalidatedExtensionContextMessage(message);
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
