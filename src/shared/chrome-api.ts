import type {
  BackgroundCommandMessage,
  BackgroundCommandResponse,
  PopupToContentMessage,
} from "./message-types";

function callbackPromise<T>(executor: (callback: (value: T) => void) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    executor((value) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      resolve(value);
    });
  });
}

export function sendRuntimeMessage(
  message: BackgroundCommandMessage,
): Promise<BackgroundCommandResponse> {
  return callbackPromise((callback) => chrome.runtime.sendMessage(message, callback));
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

export async function openOptionsPage(): Promise<void> {
  await callbackPromise<void>((callback) => chrome.runtime.openOptionsPage(callback));
}

export async function createTab(url: string): Promise<chrome.tabs.Tab> {
  return callbackPromise((callback) => chrome.tabs.create({ url }, callback));
}
