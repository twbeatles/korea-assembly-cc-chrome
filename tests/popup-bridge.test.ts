import { describe, expect, it, vi } from "vitest";

import {
  createPopupFeedbackMessage,
  createPopupMessages,
  postToPopupPort,
} from "../src/content/popup-bridge";
import type { StatusSnapshot } from "../src/shared/message-types";

function buildSnapshot(): StatusSnapshot {
  return {
    connected: true,
    requiresReload: false,
    status: "running",
    sessionId: "session_popup_bridge",
    title: "국회 본회의",
    committeeName: "정무위원회",
    sourceUrl: "https://assembly.webcast.go.kr/main/player.asp",
    subtitleCount: 2,
    charCount: 14,
    previewText: "실시간 자막",
    recentEntries: [],
    startedAt: "2026-03-10T09:00:00.000Z",
    endedAt: null,
    updatedAt: "2026-03-10T09:00:03.000Z",
    lastPersistedAt: "2026-03-10T09:00:03.000Z",
    observerActive: true,
    currentSelector: "#viewSubtit",
    currentFramePath: [],
    diagnostics: {
      captureMode: "structured",
      observerActive: true,
      currentSelector: "#viewSubtit",
      currentFramePath: [],
      sourceLabel: "structured",
      persistabilityState: "persistable",
      persistabilityHint: "저장 가능한 확정 자막이 누적되고 있습니다.",
    },
    hasPersistableContent: true,
  };
}

describe("popup bridge helpers", () => {
  it("builds the popup message fan-out from a status snapshot", () => {
    const messages = createPopupMessages(buildSnapshot());

    expect(messages).toHaveLength(3);
    expect(messages[0]).toMatchObject({
      type: "CAPTURE_STATUS",
      payload: {
        diagnostics: {
          persistabilityState: "persistable",
        },
      },
    });
    expect(messages[1]).toMatchObject({
      type: "PREVIEW_UPDATE",
      payload: {
        previewText: "실시간 자막",
      },
    });
    expect(messages[2]).toMatchObject({
      type: "SESSION_STATS",
      payload: {
        subtitleCount: 2,
        charCount: 14,
      },
    });
  });

  it("posts popup messages and feedback payloads through the provided port", () => {
    const port = {
      postMessage: vi.fn(),
    } as unknown as chrome.runtime.Port;

    const feedback = createPopupFeedbackMessage({
      command: "SAVE_SESSION",
      message: "저장할 자막이 아직 없습니다.",
    });
    postToPopupPort(port, feedback);

    expect(port.postMessage).toHaveBeenCalledWith({
      type: "POPUP_FEEDBACK",
      payload: {
        command: "SAVE_SESSION",
        message: "저장할 자막이 아직 없습니다.",
      },
    });
  });
});
