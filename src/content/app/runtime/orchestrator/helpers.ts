import { isSupportedAssemblyUrl } from "../../../../shared/constants";
import {
  DEFAULT_IN_PAGE_NOTICE,
  NON_CAPTURE_PAGE_NOTICE,
} from "../constants";
import { createRandomToken } from "../../../../shared/random-token";
import type { ObserverBridgeEvent } from "../../../../shared/message-types";

export function isCapturePage(): boolean {
  return isSupportedAssemblyUrl(window.location.href);
}

export function resolveDefaultPanelNotice(): string {
  return isCapturePage() ? DEFAULT_IN_PAGE_NOTICE : NON_CAPTURE_PAGE_NOTICE;
}

export function createObserverBridgeToken(): string {
  return createRandomToken();
}

export function cloneObserverBridgeEventForReplay(
  event: ObserverBridgeEvent,
): ObserverBridgeEvent {
  return {
    ...event,
    rows: event.rows?.map((row) => ({
      ...row,
    })),
    framePath: event.framePath ? [...event.framePath] : undefined,
  };
}

export function deriveCommitteeName(title: string): string {
  return title.replace(/\s+\|\s+[^|]+$/, "").trim();
}
