import type { ContentRuntime, ContentRuntimeServices } from "../../../context";

import { FRAME_FORWARD_NONCE_SOURCE } from "../../../../../shared/constants";

import { getSettings } from "../../../../../storage/settings-store";

import { isTopFrame, localFramePath } from "../../constants";

import { isCapturePage, resolveDefaultPanelNotice, deriveCommitteeName } from "../helpers";
import type { RuntimeCoreContext } from "./context";
import { clearRunningPersistTimer } from "./timers";
import { logDebug, reportRuntimeError, setPanelNotice } from "./notices";
import { syncUserInterfaces, updateInPagePanel } from "./panel-status";
import { ensureFrameForwardNonce, startFrameForwardNonceRefresh } from "./observer-bridge";
import { bindVisibilityPollingAdjust, startLocalPolling, startTopFrameFallback } from "./polling";
import { startCapture, startCapturePipelineForCurrentPage, stopCapture, stopCapturePipelineForCurrentPage } from "./session-lifecycle";
import { bindPopupPort, mountInPagePanel } from "./panel-host";
import { bindBridgeMessages, bindNavigationGuards, bindSettingsChanges, bindUrlChangeDetection } from "./bindings";
import { createRuntimeCoreContext } from "./context";

/** 부트스트랩과 공개 진입 (단일 책임: 조립 루트). */
export async function bootstrap(ctx: RuntimeCoreContext): Promise<void> {
  if (ctx.extensionContextInvalidated) {
    return;
  }

  ctx.state.title = document.title;
  ctx.state.committeeName = deriveCommitteeName(document.title);
  bindPopupPort(ctx);

  try {
    ctx.settings = await getSettings();
  } catch (error) {
    reportRuntimeError(ctx, 
      "확장 설정을 불러오지 못해 기본값으로 계속 진행합니다.",
      error,
    );
  }
  if (ctx.extensionContextInvalidated) {
    return;
  }

  try {
    await ensureFrameForwardNonce(ctx);
  } catch (error) {
    reportRuntimeError(ctx, "프레임 전달 보안 토큰 준비에 실패했습니다.", error);
  }
  if (ctx.extensionContextInvalidated) {
    return;
  }

  ctx.state.title = document.title;
  ctx.state.committeeName = deriveCommitteeName(document.title);
  setPanelNotice(ctx, resolveDefaultPanelNotice());
  bindBridgeMessages(ctx);
  bindSettingsChanges(ctx);
  bindNavigationGuards(ctx);
  bindVisibilityPollingAdjust(ctx);
  bindUrlChangeDetection(ctx);
  mountInPagePanel(ctx);
  updateInPagePanel(ctx);
  startFrameForwardNonceRefresh(ctx);

  if (!isCapturePage()) {
    syncUserInterfaces(ctx);
    logDebug(ctx, "content script bootstrapped without capture pipeline", {
      isTopFrame,
      localFramePath,
      url: window.location.href,
    });
    return;
  }

  await startCapturePipelineForCurrentPage(ctx);
  syncUserInterfaces(ctx);
  logDebug(ctx, "content script bootstrapped", {
    isTopFrame,
    localFramePath,
    nonceSource: FRAME_FORWARD_NONCE_SOURCE,
  });
}

export function handleBootstrapError(ctx: RuntimeCoreContext, error: unknown): void {
  reportRuntimeError(ctx, "content script 초기화 중 오류가 발생했습니다.", error);
  if (ctx.extensionContextInvalidated) {
    return;
  }
  mountInPagePanel(ctx);
  updateInPagePanel(ctx);
  if (isCapturePage()) {
    startLocalPolling(ctx);
    startTopFrameFallback(ctx);
  }
}

function createContentRuntimeServices(ctx: RuntimeCoreContext): ContentRuntimeServices {
  return {
    ui: {
      updateInPagePanel: () => updateInPagePanel(ctx),
      syncUserInterfaces: (requiresReload) => syncUserInterfaces(ctx, requiresReload),
    },
    persistence: {
      clearRunningPersistTimer: () => clearRunningPersistTimer(ctx),
    },
    capturePipeline: {
      startCapturePipelineForCurrentPage: () =>
        startCapturePipelineForCurrentPage(ctx),
      stopCapturePipelineForCurrentPage: () =>
        stopCapturePipelineForCurrentPage(ctx),
    },
    sessionActions: {
      startCapture: () => startCapture(ctx),
      stopCapture: () => stopCapture(ctx),
    },
    bindings: {
      bindPopupPort: () => bindPopupPort(ctx),
      bindSettingsChanges: () => bindSettingsChanges(ctx),
      bindNavigationGuards: () => bindNavigationGuards(ctx),
      bindUrlChangeDetection: () => bindUrlChangeDetection(ctx),
      bindBridgeMessages: () => bindBridgeMessages(ctx),
    },
  };
}

export function createContentRuntime(): ContentRuntime {
  const ctx = createRuntimeCoreContext();
  return {
    bootstrap: () => bootstrap(ctx),
    handleBootstrapError: (error) => handleBootstrapError(ctx, error),
    services: createContentRuntimeServices(ctx),
  };
}
