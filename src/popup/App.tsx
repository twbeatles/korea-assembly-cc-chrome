import { useEffect, useState } from "react";

import { POPUP_PORT_NAME, isSupportedAssemblySiteUrl } from "../shared/constants";
import {
  addTabActivatedListener,
  addTabRemovedListener,
  addTabUpdatedListener,
  connectToTab,
  createTab,
  queryActiveTab,
  removeTabActivatedListener,
  removeTabRemovedListener,
  removeTabUpdatedListener,
  sendRuntimeMessage,
} from "../shared/chrome-api";
import type {
  ContentToPopupMessage,
  PopupToContentMessage,
  StatusSnapshot,
} from "../shared/message-types";
import { getCaptureStatusLabel, UI_TEXT } from "../shared/ui-labels";
import { getSettings } from "../storage/settings-store";
import type { AssemblyPreset } from "../storage/types";

export default function App() {
  const [snapshot, setSnapshot] = useState<StatusSnapshot | null>(null);
  const [statusMessage, setStatusMessage] = useState("현재 페이지를 확인하고 있습니다.");
  const [tabReady, setTabReady] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [requiresReload, setRequiresReload] = useState(false);
  const [port, setPort] = useState<chrome.runtime.Port | null>(null);
  const [currentTabId, setCurrentTabId] = useState<number | null>(null);
  const [presets, setPresets] = useState<AssemblyPreset[]>([]);
  const hasPersistableContent = Boolean(snapshot?.hasPersistableContent);
  const captureReady = Boolean(snapshot?.connected);

  useEffect(() => {
    void getSettings()
      .then((settings) => setPresets(settings.presets ?? []))
      .catch(() => setPresets([]));

    let active = true;
    let reconnectTimer: number | null = null;
    let reconnectAttempt = 0;
    let connecting = false;
    let currentPort: chrome.runtime.Port | null = null;
    let currentTabIdValue: number | null = null;
    let pendingReconnectMessage: string | null = null;

    const clearReconnectTimer = (): void => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const disconnectCurrentPort = (): void => {
      if (!currentPort) {
        return;
      }

      const portToDisconnect = currentPort;
      currentPort = null;
      setPort(null);
      portToDisconnect.disconnect();
    };

    const scheduleReconnect = (message: string, immediate = false): void => {
      if (!active) {
        return;
      }

      setStatusMessage(message);
      clearReconnectTimer();
      const delay = immediate ? 0 : Math.min(5000, 500 * 2 ** reconnectAttempt);
      reconnectAttempt = immediate ? 0 : reconnectAttempt + 1;
      reconnectTimer = window.setTimeout(() => {
        void connect();
      }, delay);
    };

    const reconnectToActiveTab = (message: string): void => {
      if (!active) {
        return;
      }

      if (connecting) {
        pendingReconnectMessage = message;
        return;
      }

      disconnectCurrentPort();
      setTabReady(false);
      setRequiresReload(false);
      scheduleReconnect(message, true);
    };

    const connect = async (): Promise<void> => {
      if (!active || connecting || currentPort) {
        return;
      }
      connecting = true;

      try {
        const tab = await queryActiveTab();
        if (!active) {
          return;
        }

        if (!tab?.id || !tab.url) {
          currentTabIdValue = null;
          setCurrentTabId(null);
          setTabReady(false);
          setUnsupported(false);
          scheduleReconnect("현재 탭 정보를 읽지 못했습니다. 자동으로 다시 연결을 시도합니다.");
          return;
        }

        currentTabIdValue = tab.id;
        setCurrentTabId(tab.id);
        if (!isSupportedAssemblySiteUrl(tab.url)) {
          setUnsupported(true);
          setTabReady(false);
          setRequiresReload(false);
          clearReconnectTimer();
          setStatusMessage("국회 의사중계 사이트에서만 사용할 수 있습니다.");
          return;
        }

        setUnsupported(false);

        const ensure = await sendRuntimeMessage({
          type: "ENSURE_CONTENT_SCRIPT",
          tabId: tab.id,
          url: tab.url,
        });
        if (!active) {
          return;
        }

        if (!ensure.ok) {
          setTabReady(false);
          scheduleReconnect(`${ensure.error} 자동으로 다시 연결을 시도합니다.`);
          return;
        }

        setRequiresReload(Boolean(ensure.requiresReload));
        if (!ensure.ready) {
          setTabReady(false);
          scheduleReconnect("현재 탭과 아직 연결되지 않았습니다. 자동으로 다시 연결을 시도합니다.");
          return;
        }

        reconnectAttempt = 0;
        clearReconnectTimer();
        const nextPort = connectToTab(tab.id, 0, POPUP_PORT_NAME);
        currentPort = nextPort;
        setPort(nextPort);

        const onMessage = (message: ContentToPopupMessage): void => {
          if (!active) {
            return;
          }

          switch (message.type) {
            case "CAPTURE_STATUS":
              setSnapshot(() => ({
                connected: message.payload.connected,
                requiresReload: message.payload.requiresReload,
                status: message.payload.status,
                sessionId: message.payload.sessionId,
                title: message.payload.title,
                committeeName: message.payload.committeeName,
                sourceUrl: message.payload.sourceUrl,
                subtitleCount: message.payload.subtitleCount,
                charCount: message.payload.charCount,
                previewText: message.payload.previewText,
                recentEntries: message.payload.recentEntries,
                startedAt: message.payload.startedAt,
                endedAt: message.payload.endedAt,
                updatedAt: message.payload.updatedAt,
                lastPersistedAt: message.payload.lastPersistedAt,
                observerActive: message.payload.observerActive,
                currentSelector: message.payload.currentSelector,
                currentFramePath: message.payload.currentFramePath,
                diagnostics: message.payload.diagnostics,
                hasPersistableContent: message.payload.hasPersistableContent,
              }));
              setTabReady(true);
              setStatusMessage(
                message.payload.connected
                  ? "페이지 확장판과 연결했습니다."
                  : "국회 의사중계 메인 페이지에 연결했습니다. 플레이어 페이지로 이동하면 수집을 시작할 수 있습니다.",
              );
              return;
            case "PREVIEW_UPDATE":
              setSnapshot((current) =>
                current
                  ? {
                      ...current,
                      previewText: message.payload.previewText,
                      recentEntries: message.payload.recentEntries,
                      hasPersistableContent: message.payload.hasPersistableContent,
                    }
                  : current,
              );
              return;
            case "SESSION_STATS":
              setSnapshot((current) =>
                current
                  ? {
                      ...current,
                      subtitleCount: message.payload.subtitleCount,
                      charCount: message.payload.charCount,
                      hasPersistableContent: message.payload.hasPersistableContent,
                    }
                  : current,
              );
              return;
            case "ERROR":
              setStatusMessage(message.message);
              return;
            case "POPUP_FEEDBACK":
              setStatusMessage(message.payload.message);
              return;
          }
        };

        const onDisconnect = (): void => {
          if (currentPort !== nextPort) {
            return;
          }
          const disconnectReason = chrome.runtime.lastError?.message;
          if (!active) {
            return;
          }
          currentPort = null;
          setPort(null);
          setTabReady(false);
          setRequiresReload(true);
          scheduleReconnect(
            disconnectReason?.includes("Receiving end does not exist")
              ? "현재 탭과의 연결이 없습니다. 자동으로 다시 연결을 시도합니다."
              : disconnectReason || "연결이 끊겼습니다. 자동으로 다시 연결을 시도합니다.",
          );
        };

        nextPort.onMessage.addListener(onMessage);
        nextPort.onDisconnect.addListener(onDisconnect);
        nextPort.postMessage({ type: "GET_STATUS" } satisfies PopupToContentMessage);
      } catch (error: unknown) {
        if (!active) {
          return;
        }

        const baseMessage = error instanceof Error ? error.message : "팝업을 준비하지 못했습니다.";
        scheduleReconnect(`${baseMessage} 자동으로 다시 연결을 시도합니다.`);
      } finally {
        connecting = false;
        if (pendingReconnectMessage) {
          const nextMessage = pendingReconnectMessage;
          pendingReconnectMessage = null;
          reconnectToActiveTab(nextMessage);
        }
      }
    };

    const handleTabActivated = (): void => {
      reconnectToActiveTab("현재 창의 활성 탭으로 다시 연결하고 있습니다.");
    };

    const handleTabUpdated = (
      _tabId: number,
      changeInfo: chrome.tabs.TabChangeInfo,
      tab: chrome.tabs.Tab,
    ): void => {
      if (!tab.active || (!changeInfo.status && !changeInfo.url)) {
        return;
      }

      reconnectToActiveTab("현재 창의 활성 탭 정보를 다시 확인하고 있습니다.");
    };

    const handleTabRemoved = (tabId: number): void => {
      if (tabId !== currentTabIdValue) {
        return;
      }

      reconnectToActiveTab("현재 탭이 닫혀 활성 탭으로 다시 연결하고 있습니다.");
    };

    addTabActivatedListener(handleTabActivated);
    addTabUpdatedListener(handleTabUpdated);
    addTabRemovedListener(handleTabRemoved);
    void connect();

    return () => {
      active = false;
      clearReconnectTimer();
      removeTabActivatedListener(handleTabActivated);
      removeTabUpdatedListener(handleTabUpdated);
      removeTabRemovedListener(handleTabRemoved);
      disconnectCurrentPort();
      setPort(null);
    };
  }, []);

  const sendCommand = (message: PopupToContentMessage, label: string): void => {
    if (!port) {
      setStatusMessage("현재 페이지와 아직 연결되지 않았습니다.");
      return;
    }

    setStatusMessage(label);
    port.postMessage(message);
  };

  const openHistory = async (): Promise<void> => {
    try {
      const response = await sendRuntimeMessage({ type: "OPEN_HISTORY_PAGE" });
      if (!response.ok) {
        setStatusMessage(response.error);
        return;
      }
      setStatusMessage("저장된 기록 화면을 열었습니다.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "저장된 기록 화면을 열지 못했습니다.");
    }
  };

  const openOptions = async (): Promise<void> => {
    try {
      const response = await sendRuntimeMessage({ type: "OPEN_OPTIONS_PAGE" });
      if (!response.ok) {
        setStatusMessage(response.error);
        return;
      }
      setStatusMessage("환경 설정 화면을 열었습니다.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "환경 설정 화면을 열지 못했습니다.");
    }
  };

  const openDiagnostics = async (): Promise<void> => {
    try {
      const response = await sendRuntimeMessage({
        type: "OPEN_DIAGNOSTICS_PAGE",
        tabId: currentTabId ?? undefined,
      });
      if (!response.ok) {
        setStatusMessage(response.error);
        return;
      }
      setStatusMessage("상태 확인 화면을 열었습니다.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "상태 확인 화면을 열지 못했습니다.");
    }
  };

  const openSidePanel = async (): Promise<void> => {
    try {
      const response = await sendRuntimeMessage({
        type: "OPEN_SIDE_PANEL",
        tabId: currentTabId ?? undefined,
      });
      setStatusMessage(response.ok ? "브라우저 사이드 패널을 열었습니다." : response.error);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "사이드 패널을 열지 못했습니다.");
    }
  };

  const openPreset = async (preset: AssemblyPreset): Promise<void> => {
    try {
      await createTab(preset.url);
      setStatusMessage(`${preset.name} 페이지를 열었습니다.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "프리셋 페이지를 열지 못했습니다.");
    }
  };

  const subtitleCount = snapshot?.subtitleCount ?? 0;
  const charCount = snapshot?.charCount ?? 0;
  const isRunning = snapshot?.status === "running";

  return (
    <div className="popup-shell">
      <header className="popup-header">
        <div>
          <p className="eyebrow">빠른 열기</p>
          <h1>{UI_TEXT.appName}</h1>
        </div>
        <span className={`status-badge ${snapshot?.status ?? "idle"}`}>
          {snapshot ? getCaptureStatusLabel(snapshot.status) : "연결 전"}
        </span>
      </header>

      <section className="panel">
        <div className="stat-row" aria-label="현재 수집 요약">
          <div className="stat">
            <span className="stat-label">상태</span>
            <span className="stat-value">
              {unsupported ? "지원되지 않음" : tabReady ? "연결됨" : "대기 중"}
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">자막</span>
            <span className="stat-value">{subtitleCount.toLocaleString("ko-KR")}문장</span>
          </div>
          <div className="stat">
            <span className="stat-label">글자</span>
            <span className="stat-value">{charCount.toLocaleString("ko-KR")}자</span>
          </div>
        </div>
        <div className="meta-row">
          <span>회의 이름</span>
          <strong>{snapshot?.committeeName || snapshot?.title || "-"}</strong>
        </div>
        <div className="status-line" role="status" aria-live="polite">
          {statusMessage}
        </div>
        {requiresReload ? (
          <div className="warning-box">
            확장 설치 전부터 열려 있던 탭이면 새로고침이 필요할 수 있습니다.
          </div>
        ) : null}
        {snapshot?.previewText ? (
          <div className="preview-block">
            <span className="preview-label">최근 자막</span>
            <p className="preview-text">{snapshot.previewText}</p>
          </div>
        ) : null}
      </section>

      <section className="panel">
        <div className="group">
          <span className="group-label">자막 수집</span>
          <div className="capture-actions">
            {isRunning ? (
              <button
                className="capture-btn stop"
                onClick={() => sendCommand({ type: "STOP_CAPTURE" }, "현재 수집을 멈춥니다.")}
                disabled={!tabReady}
              >
                {UI_TEXT.stopCapture}
              </button>
            ) : (
              <button
                className="capture-btn"
                onClick={() => sendCommand({ type: "START_CAPTURE" }, "현재 탭에서 수집을 시작합니다.")}
                disabled={!tabReady || !captureReady}
              >
                {UI_TEXT.startCapture}
              </button>
            )}
            <div className="save-open-row">
              <button
                className="secondary"
                onClick={() => sendCommand({ type: "SAVE_SESSION" }, "현재 세션을 저장합니다.")}
                disabled={!tabReady || !hasPersistableContent}
              >
                {UI_TEXT.saveSession}
              </button>
              <button
                className="secondary"
                onClick={() => sendCommand({ type: "OPEN_INPAGE_PANEL" }, "페이지 패널 상태를 확인합니다.")}
                disabled={!tabReady}
              >
                {UI_TEXT.openPanel}
              </button>
            </div>
          </div>
        </div>
        <div className="group">
          <span className="group-label">다른 화면 열기</span>
          <div className="nav-actions four">
            <button className="ghost" onClick={() => void openHistory()}>
              {UI_TEXT.openHistory}
            </button>
            <button className="ghost" onClick={() => void openOptions()}>
              {UI_TEXT.openOptions}
            </button>
            <button className="ghost" onClick={() => void openDiagnostics()}>
              {UI_TEXT.openDiagnostics}
            </button>
            <button className="ghost" onClick={() => void openSidePanel()}>
              사이드 패널
            </button>
          </div>
        </div>
        {presets.length ? (
          <div className="group">
            <span className="group-label">즐겨 찾는 페이지</span>
            <div className="preset-row">
              {presets.slice(0, 4).map((preset) => (
                <button
                  className="secondary"
                  key={preset.id}
                  onClick={() => void openPreset(preset)}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
