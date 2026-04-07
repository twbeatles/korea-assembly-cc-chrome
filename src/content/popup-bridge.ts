import type {
  ContentToPopupMessage,
  PopupFeedbackPayload,
  StatusSnapshot,
} from "../shared/message-types";

export function postToPopupPort(
  port: chrome.runtime.Port,
  message: ContentToPopupMessage,
): void {
  port.postMessage(message);
}

export function createPopupMessages(snapshot: StatusSnapshot): ContentToPopupMessage[] {
  return [
    {
      type: "CAPTURE_STATUS",
      payload: {
        connected: snapshot.connected,
        requiresReload: snapshot.requiresReload,
        status: snapshot.status,
        sessionId: snapshot.sessionId,
        title: snapshot.title,
        committeeName: snapshot.committeeName,
        sourceUrl: snapshot.sourceUrl,
        subtitleCount: snapshot.subtitleCount,
        charCount: snapshot.charCount,
        previewText: snapshot.previewText,
        recentEntries: snapshot.recentEntries,
        startedAt: snapshot.startedAt,
        endedAt: snapshot.endedAt,
        updatedAt: snapshot.updatedAt,
        lastPersistedAt: snapshot.lastPersistedAt,
        observerActive: snapshot.observerActive,
        currentSelector: snapshot.currentSelector,
        currentFramePath: snapshot.currentFramePath,
        diagnostics: snapshot.diagnostics,
        hasPersistableContent: snapshot.hasPersistableContent,
      },
    },
    {
      type: "PREVIEW_UPDATE",
      payload: {
        sessionId: snapshot.sessionId,
        previewText: snapshot.previewText,
        recentEntries: snapshot.recentEntries,
        hasPersistableContent: snapshot.hasPersistableContent,
      },
    },
    {
      type: "SESSION_STATS",
      payload: {
        sessionId: snapshot.sessionId,
        subtitleCount: snapshot.subtitleCount,
        charCount: snapshot.charCount,
        hasPersistableContent: snapshot.hasPersistableContent,
      },
    },
  ];
}

export function createPopupFeedbackMessage(
  payload: PopupFeedbackPayload,
): ContentToPopupMessage {
  return {
    type: "POPUP_FEEDBACK",
    payload,
  };
}
