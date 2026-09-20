

import { POPUP_PORT_NAME } from "../../../../../shared/constants";

import type { PopupToContentMessage } from "../../../../../shared/message-types";

import { createInPagePanel } from "../../../../inpage-panel";

import { saveSettings } from "../../../../../storage/settings-store";

import { createPopupFeedbackMessage, postToPopupPort } from "../../../../popup-bridge";

import { isTopFrame } from "../../constants";

import type { RuntimeCoreContext } from "./context";
import { reportRuntimeError, setPanelNotice } from "./notices";
import { buildStatusSnapshot, syncPortState, syncUserInterfaces, updateInPagePanel } from "./panel-status";
import { clearSessionAndReset, confirmSessionClear, startCapture, stopCapture } from "./session-lifecycle";
import { copyRecentSessionLines, exportCurrentSession, highlightLatestCommittedEntry, openDiagnosticsPage, openHistoryPage, openOptionsPage, saveAndStartNewSession, saveCurrentSessionSnapshot } from "./session-commands";

/** 인페이지 패널 장착과 popup 포트 명령 (단일 책임: 호스트 바인딩). */
export function openInPagePanel(ctx: RuntimeCoreContext): {
  command: "OPEN_INPAGE_PANEL";
  message: string;
  panelOpened: boolean;
} {
  const panelOpened = ctx.panelCollapsed;
  ctx.panelCollapsed = false;
  const message = panelOpened
    ? "페이지 오른쪽 패널을 열었습니다."
    : "페이지 오른쪽 패널이 이미 열려 있습니다.";
  setPanelNotice(ctx, message);
  syncUserInterfaces(ctx);
  return {
    command: "OPEN_INPAGE_PANEL",
    message,
    panelOpened,
  };
}

export function collapseInPagePanel(ctx: RuntimeCoreContext): void {
  ctx.panelCollapsed = true;
  setPanelNotice(ctx, "오른쪽 가장자리의 '자막 보기' 버튼으로 다시 열 수 있습니다.");
  syncUserInterfaces(ctx);
}

export function mountInPagePanel(ctx: RuntimeCoreContext): void {
  if (!isTopFrame || ctx.inPagePanel) {
    return;
  }

  ctx.inPagePanel = createInPagePanel({
    onStartCapture: () => {
      void startCapture(ctx).catch((error: unknown) => {
        reportRuntimeError(ctx, 
          error instanceof Error
            ? error.message
            : "자막 모으기를 시작하지 못했습니다.",
          error,
        );
      });
    },
    onStopCapture: () => {
      void stopCapture(ctx).catch((error: unknown) => {
        reportRuntimeError(ctx, 
          error instanceof Error
            ? error.message
            : "자막 모으기를 멈추지 못했습니다.",
          error,
        );
      });
    },
    onClearSession: () => {
      void confirmSessionClear()
        .then((confirmed) => {
          if (!confirmed) {
            setPanelNotice(ctx, "세션 비우기를 취소했습니다.");
            syncUserInterfaces(ctx);
            return;
          }
          return clearSessionAndReset(ctx);
        })
        .catch((error: unknown) => {
        reportRuntimeError(ctx, 
          error instanceof Error
            ? error.message
            : "세션 비우기를 완료하지 못했습니다.",
          error,
        );
      });
    },
    onSaveSession: () => {
      void saveCurrentSessionSnapshot(ctx)
        .then(() => syncUserInterfaces(ctx))
        .catch((error: unknown) => {
          reportRuntimeError(ctx, 
            error instanceof Error
              ? error.message
              : "지금 저장을 완료하지 못했습니다.",
            error,
          );
        });
    },
    onSaveAndStartNewSession: () => {
      void saveAndStartNewSession(ctx).catch((error: unknown) => {
        reportRuntimeError(ctx, 
          error instanceof Error
            ? error.message
            : "중간 저장 후 새 세션을 시작하지 못했습니다.",
          error,
        );
      });
    },
    onHighlightLatestEntry: () => {
      void highlightLatestCommittedEntry(ctx).catch((error: unknown) => {
        reportRuntimeError(ctx, 
          error instanceof Error
            ? error.message
            : "최신 자막 중요 표시를 저장하지 못했습니다.",
          error,
        );
      });
    },
    onExport: (format) => {
      void exportCurrentSession(ctx, format).catch((error: unknown) => {
        reportRuntimeError(ctx, 
          error instanceof Error
            ? error.message
            : "파일 저장을 시작하지 못했습니다.",
          error,
        );
      });
    },
    onCopyRecent: () => {
      void copyRecentSessionLines(ctx).catch((error: unknown) => {
        reportRuntimeError(ctx, 
          error instanceof Error
            ? error.message
            : "최근 자막 복사에 실패했습니다.",
          error,
        );
      });
    },
    onSetSpeakerHighlight: (enabled) => {
      void saveSettings({ panelSpeakerHighlightEnabled: enabled })
        .then((next) => {
          ctx.settings = next;
          setPanelNotice(ctx, 
            enabled
              ? "패널에 발언자 색 표시를 켰습니다."
              : "패널 발언자 색 표시를 껐습니다.",
          );
          syncUserInterfaces(ctx);
        })
        .catch((error: unknown) => {
          reportRuntimeError(ctx, 
            error instanceof Error
              ? error.message
              : "발언자 보기 설정을 저장하지 못했습니다.",
            error,
          );
        });
    },
    onSetExportSpeaker: (enabled) => {
      void saveSettings({ txtExportSpeakerEnabled: enabled })
        .then((next) => {
          ctx.settings = next;
          setPanelNotice(ctx, 
            enabled
              ? "내보내기·복사에 발언자를 포함합니다."
              : "내보내기·복사에서 발언자를 빼 둡니다.",
          );
          syncUserInterfaces(ctx);
        })
        .catch((error: unknown) => {
          reportRuntimeError(ctx, 
            error instanceof Error
              ? error.message
              : "발언자 내보내기 설정을 저장하지 못했습니다.",
            error,
          );
        });
    },
    onOpenHistory: () => {
      void openHistoryPage(ctx).catch((error: unknown) => {
        reportRuntimeError(ctx, 
          error instanceof Error
            ? error.message
            : "저장된 기록 화면을 열지 못했습니다.",
          error,
        );
      });
    },
    onOpenOptions: () => {
      void openOptionsPage(ctx).catch((error: unknown) => {
        reportRuntimeError(ctx, 
          error instanceof Error
            ? error.message
            : "환경 설정 화면을 열지 못했습니다.",
          error,
        );
      });
    },
    onOpenDiagnostics: () => {
      void openDiagnosticsPage(ctx).catch((error: unknown) => {
        reportRuntimeError(ctx, 
          error instanceof Error
            ? error.message
            : "상태 확인 화면을 열지 못했습니다.",
          error,
        );
      });
    },
    onExpand: () => openInPagePanel(ctx),
    onCollapse: () => collapseInPagePanel(ctx),
    onTogglePreviewCollapsed: () => {
      ctx.previewCollapsed = !ctx.previewCollapsed;
      syncUserInterfaces(ctx);
    },
  });

  updateInPagePanel(ctx);
}

export async function handleCommand(ctx: RuntimeCoreContext, 
  port: chrome.runtime.Port,
  message: PopupToContentMessage,
): Promise<void> {
  switch (message.type) {
    case "PING":
      syncPortState(ctx, port);
      return;
    case "GET_STATUS":
      ctx.diagnosticsPorts.delete(port);
      syncPortState(ctx, port);
      return;
    case "GET_DIAGNOSTICS_STATUS":
      ctx.diagnosticsPorts.add(port);
      syncPortState(ctx, port, false, true);
      return;
    case "OPEN_INPAGE_PANEL": {
      const feedback = openInPagePanel(ctx);
      postToPopupPort(port, createPopupFeedbackMessage(feedback));
      syncPortState(ctx, port);
      return;
    }
    case "START_CAPTURE":
      await startCapture(ctx);
      syncPortState(ctx, port);
      return;
    case "STOP_CAPTURE":
      await stopCapture(ctx);
      syncPortState(ctx, port);
      return;
    case "CLEAR_SESSION":
      if (!(await confirmSessionClear())) {
        setPanelNotice(ctx, "세션 비우기를 취소했습니다.");
        syncUserInterfaces(ctx);
        syncPortState(ctx, port);
        return;
      }
      await clearSessionAndReset(ctx);
      syncPortState(ctx, port);
      return;
    case "SAVE_SESSION":
      {
        const result = await saveCurrentSessionSnapshot(ctx);
        if (result.message && !result.saved) {
          postToPopupPort(
            port,
            createPopupFeedbackMessage({
              command: "SAVE_SESSION",
              message: result.message,
            }),
          );
        }
      }
      syncUserInterfaces(ctx);
      syncPortState(ctx, port);
      return;
    case "EXPORT_REQUEST":
      await exportCurrentSession(ctx, message.format);
      syncPortState(ctx, port);
      return;
  }
}

export function bindPopupPort(ctx: RuntimeCoreContext): void {
  if (!isTopFrame) {
    return;
  }

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== POPUP_PORT_NAME) {
      return;
    }

    ctx.popupPorts.add(port);
    syncPortState(ctx, port);

    port.onMessage.addListener((message: PopupToContentMessage) => {
      void handleCommand(ctx, port, message).catch((error: unknown) => {
        postToPopupPort(port, {
          type: "ERROR",
          message:
            error instanceof Error
              ? error.message
              : "알 수 없는 오류가 발생했습니다.",
        });
      });
    });

    port.onDisconnect.addListener(() => {
      ctx.popupPorts.delete(port);
      ctx.diagnosticsPorts.delete(port);
    });
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const typedMessage = message as PopupToContentMessage;
    if (typedMessage.type === "PING") {
      sendResponse({ ok: true });
      return true;
    }
    if (typedMessage.type === "GET_STATUS") {
      sendResponse(buildStatusSnapshot(ctx, false));
      return true;
    }
    if (typedMessage.type === "GET_DIAGNOSTICS_STATUS") {
      sendResponse(buildStatusSnapshot(ctx, false, true));
      return true;
    }
    return undefined;
  });
}
