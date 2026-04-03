export function confirmSessionClear(): boolean {
  if (typeof window === "undefined" || typeof window.confirm !== "function") {
    return true;
  }

  return window.confirm("현재 세션 기록을 비우고 다시 시작할까요?");
}

export function confirmFailedStoppedSessionDiscard(message: string): boolean {
  if (typeof window === "undefined" || typeof window.confirm !== "function") {
    return false;
  }

  return window.confirm(message);
}

export function createObserverBridgeToken(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function isExtensionContextInvalidatedError(error: unknown): boolean {
  if (typeof error === "string") {
    return error.includes("Extension context invalidated");
  }
  if (error instanceof Error) {
    return error.message.includes("Extension context invalidated");
  }
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" && message.includes("Extension context invalidated");
  }
  return false;
}
