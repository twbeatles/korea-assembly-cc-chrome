import type { ExportFormat } from "../../core/subtitle-models";
import {
  createInPagePanel,
  type InPagePanelController,
} from "../inpage-panel";

interface OpenPanelOptions {
  panelCollapsed: boolean;
  setPanelCollapsed: (collapsed: boolean) => void;
  setPanelNotice: (message: string) => void;
  syncUserInterfaces: () => void;
}

interface MountPanelOptions {
  isTopFrame: boolean;
  inPagePanel: InPagePanelController | null;
  setInPagePanel: (panel: InPagePanelController) => void;
  confirmSessionClear: () => boolean;
  setPanelNotice: (message: string) => void;
  syncUserInterfaces: () => void;
  updateInPagePanel: () => void;
  reportRuntimeError: (message: string, error?: unknown) => void;
  startCapture: () => Promise<void>;
  stopCapture: () => Promise<void>;
  clearSessionAndReset: () => Promise<void>;
  saveCurrentSessionSnapshot: () => Promise<void>;
  exportCurrentSession: (format: ExportFormat) => Promise<void>;
  copyRecentSessionLines: () => Promise<void>;
  openHistoryPage: () => Promise<void>;
  openOptionsPage: () => Promise<void>;
  openDiagnosticsPage: () => Promise<void>;
  openInPagePanel: () => {
    command: "OPEN_INPAGE_PANEL";
    message: string;
    panelOpened: boolean;
  };
  collapseInPagePanel: () => void;
  previewCollapsed: boolean;
  setPreviewCollapsed: (collapsed: boolean) => void;
}

export function openInPagePanelController(options: OpenPanelOptions): {
  command: "OPEN_INPAGE_PANEL";
  message: string;
  panelOpened: boolean;
} {
  const panelOpened = options.panelCollapsed;
  options.setPanelCollapsed(false);
  const message = panelOpened
    ? "페이지 오른쪽 패널을 열었습니다."
    : "페이지 오른쪽 패널이 이미 열려 있습니다.";
  options.setPanelNotice(message);
  options.syncUserInterfaces();
  return {
    command: "OPEN_INPAGE_PANEL",
    message,
    panelOpened,
  };
}

export function collapseInPagePanelController(options: OpenPanelOptions): void {
  options.setPanelCollapsed(true);
  options.setPanelNotice("오른쪽 가장자리의 '자막 보기' 버튼으로 다시 열 수 있습니다.");
  options.syncUserInterfaces();
}

export function mountInPagePanelController(options: MountPanelOptions): InPagePanelController | null {
  if (!options.isTopFrame || options.inPagePanel) {
    return options.inPagePanel;
  }

  const panel = createInPagePanel({
    onStartCapture: () => {
      void options.startCapture().catch((error: unknown) => {
        options.reportRuntimeError(
          error instanceof Error ? error.message : "자막 모으기를 시작하지 못했습니다.",
          error,
        );
      });
    },
    onStopCapture: () => {
      void options.stopCapture().catch((error: unknown) => {
        options.reportRuntimeError(
          error instanceof Error ? error.message : "자막 모으기를 멈추지 못했습니다.",
          error,
        );
      });
    },
    onClearSession: () => {
      if (!options.confirmSessionClear()) {
        options.setPanelNotice("세션 비우기를 취소했습니다.");
        options.syncUserInterfaces();
        return;
      }
      void options.clearSessionAndReset().catch((error: unknown) => {
        options.reportRuntimeError(
          error instanceof Error ? error.message : "세션 비우기를 완료하지 못했습니다.",
          error,
        );
      });
    },
    onSaveSession: () => {
      void options.saveCurrentSessionSnapshot()
        .then(() => options.syncUserInterfaces())
        .catch((error: unknown) => {
          options.reportRuntimeError(
            error instanceof Error ? error.message : "지금 저장을 완료하지 못했습니다.",
            error,
          );
        });
    },
    onExport: (format) => {
      void options.exportCurrentSession(format).catch((error: unknown) => {
        options.reportRuntimeError(
          error instanceof Error ? error.message : "파일 저장을 시작하지 못했습니다.",
          error,
        );
      });
    },
    onCopyRecent: () => {
      void options.copyRecentSessionLines().catch((error: unknown) => {
        options.reportRuntimeError(
          error instanceof Error ? error.message : "최근 자막 복사에 실패했습니다.",
          error,
        );
      });
    },
    onOpenHistory: () => {
      void options.openHistoryPage().catch((error: unknown) => {
        options.reportRuntimeError(
          error instanceof Error ? error.message : "저장된 기록 화면을 열지 못했습니다.",
          error,
        );
      });
    },
    onOpenOptions: () => {
      void options.openOptionsPage().catch((error: unknown) => {
        options.reportRuntimeError(
          error instanceof Error ? error.message : "환경 설정 화면을 열지 못했습니다.",
          error,
        );
      });
    },
    onOpenDiagnostics: () => {
      void options.openDiagnosticsPage().catch((error: unknown) => {
        options.reportRuntimeError(
          error instanceof Error ? error.message : "수집 진단 화면을 열지 못했습니다.",
          error,
        );
      });
    },
    onExpand: options.openInPagePanel,
    onCollapse: options.collapseInPagePanel,
    onTogglePreviewCollapsed: () => {
      options.setPreviewCollapsed(!options.previewCollapsed);
      options.syncUserInterfaces();
    },
  });

  options.setInPagePanel(panel);
  options.updateInPagePanel();
  return panel;
}
