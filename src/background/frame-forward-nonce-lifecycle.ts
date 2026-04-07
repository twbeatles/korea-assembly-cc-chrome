type WarnLogger = (message: string, error: unknown) => void;

export function shouldRotateFrameForwardNonce(
  changeInfo: Pick<chrome.tabs.TabChangeInfo, "status">,
): boolean {
  return changeInfo.status === "loading";
}

export async function handleFrameForwardNonceTabUpdated(
  tabId: number,
  changeInfo: Pick<chrome.tabs.TabChangeInfo, "status">,
  rotateNonce: (tabId: number) => Promise<unknown>,
  warn: WarnLogger = (message, error) => console.warn(message, error),
): Promise<void> {
  if (!shouldRotateFrameForwardNonce(changeInfo)) {
    return;
  }

  try {
    await rotateNonce(tabId);
  } catch (error) {
    warn("[service-worker] Failed to rotate frame forward nonce", error);
  }
}

export async function handleFrameForwardNonceTabRemoved(
  tabId: number,
  clearNonce: (tabId: number) => Promise<void>,
  warn: WarnLogger = (message, error) => console.warn(message, error),
): Promise<void> {
  try {
    await clearNonce(tabId);
  } catch (error) {
    warn("[service-worker] Failed to clear frame forward nonce", error);
  }
}
