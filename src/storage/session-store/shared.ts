import { SESSION_LIBRARY_REVISION_STORAGE_KEY } from "../../shared/constants";

export function logStoreError(message: string, error?: unknown): void {
  console.warn(`[session-store] ${message}`, error);
}

export async function bumpSessionLibraryRevision(): Promise<void> {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    return;
  }

  try {
    await chrome.storage.local.set({
      [SESSION_LIBRARY_REVISION_STORAGE_KEY]: `${Date.now()}:${Math.random().toString(16).slice(2)}`,
    });
  } catch (error) {
    logStoreError("Failed to bump session library revision", error);
  }
}
