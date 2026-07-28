import type {
  BackgroundCommandMessage,
  BackgroundCommandResponse,
  PopupToContentMessage,
} from "./message-types";
import {
  createExtensionContextInvalidatedError,
  isTransientExtensionMessagingError,
  markExtensionContextInvalidated,
} from "./extension-context";

const RUNTIME_MESSAGE_RETRY_COUNT = 2;
const RUNTIME_MESSAGE_RETRY_DELAY_MS = 80;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

function callbackPromise<T>(executor: (callback: (value: T) => void) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    executor((value) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        const error = new Error(lastError.message);
        // permanent invalidation 만 전역 플래그로 승격. Receiving end 부재는 일시 오류.
        if (markExtensionContextInvalidated(error)) {
          reject(createExtensionContextInvalidatedError());
          return;
        }
        reject(error);
        return;
      }
      resolve(value);
    });
  });
}

export async function sendRuntimeMessage(
  message: BackgroundCommandMessage,
): Promise<BackgroundCommandResponse> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RUNTIME_MESSAGE_RETRY_COUNT; attempt += 1) {
    try {
      return await callbackPromise((callback) => chrome.runtime.sendMessage(message, callback));
    } catch (error) {
      lastError = error;
      if (
        markExtensionContextInvalidated(error) ||
        !isTransientExtensionMessagingError(error) ||
        attempt >= RUNTIME_MESSAGE_RETRY_COUNT
      ) {
        throw error;
      }
      await sleep(RUNTIME_MESSAGE_RETRY_DELAY_MS * (attempt + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "runtime message failed"));
}

export function sendTabMessage<T>(tabId: number, message: PopupToContentMessage): Promise<T> {
  return callbackPromise((callback) => chrome.tabs.sendMessage(tabId, message, callback));
}

export async function queryActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await callbackPromise<chrome.tabs.Tab[]>((callback) =>
    chrome.tabs.query({ active: true, currentWindow: true }, callback),
  );
  return tabs[0];
}

export function queryTabs(queryInfo: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]> {
  return callbackPromise((callback) => chrome.tabs.query(queryInfo, callback));
}

export function getTab(tabId: number): Promise<chrome.tabs.Tab> {
  return callbackPromise((callback) => chrome.tabs.get(tabId, callback));
}

export function connectToTab(
  tabId: number,
  frameId = 0,
  name = "assembly-subtitle-popup",
): chrome.runtime.Port {
  return chrome.tabs.connect(tabId, { frameId, name });
}

export function addTabActivatedListener(
  listener: (activeInfo: chrome.tabs.TabActiveInfo) => void,
): void {
  chrome.tabs.onActivated.addListener(listener);
}

export function removeTabActivatedListener(
  listener: (activeInfo: chrome.tabs.TabActiveInfo) => void,
): void {
  chrome.tabs.onActivated.removeListener(listener);
}

export function addTabUpdatedListener(
  listener: (
    tabId: number,
    changeInfo: chrome.tabs.TabChangeInfo,
    tab: chrome.tabs.Tab,
  ) => void,
): void {
  chrome.tabs.onUpdated.addListener(listener);
}

export function removeTabUpdatedListener(
  listener: (
    tabId: number,
    changeInfo: chrome.tabs.TabChangeInfo,
    tab: chrome.tabs.Tab,
  ) => void,
): void {
  chrome.tabs.onUpdated.removeListener(listener);
}

export function addTabRemovedListener(
  listener: (tabId: number, removeInfo: chrome.tabs.TabRemoveInfo) => void,
): void {
  chrome.tabs.onRemoved.addListener(listener);
}

export function removeTabRemovedListener(
  listener: (tabId: number, removeInfo: chrome.tabs.TabRemoveInfo) => void,
): void {
  chrome.tabs.onRemoved.removeListener(listener);
}

export async function openOptionsPage(): Promise<void> {
  await callbackPromise<void>((callback) => chrome.runtime.openOptionsPage(callback));
}

export async function createTab(url: string): Promise<chrome.tabs.Tab> {
  return callbackPromise((callback) => chrome.tabs.create({ url }, callback));
}
