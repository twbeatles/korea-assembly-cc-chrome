import { useEffect, useState } from "react";

import { POPUP_PORT_NAME, isSupportedAssemblyUrl } from "../shared/constants";
import { connectToTab, queryActiveTab, sendRuntimeMessage } from "../shared/chrome-api";
import type {
  ContentToPopupMessage,
  PopupToContentMessage,
  StatusSnapshot,
} from "../shared/message-types";
import { getCaptureStatusLabel, UI_TEXT } from "../shared/ui-labels";

export default function App() {
  const [snapshot, setSnapshot] = useState<StatusSnapshot | null>(null);
  const [statusMessage, setStatusMessage] = useState("현재 페이지를 확인하고 있습니다.");
  const [tabReady, setTabReady] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [requiresReload, setRequiresReload] = useState(false);
  const [port, setPort] = useState<chrome.runtime.Port | null>(null);
  const [currentTabId, setCurrentTabId] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    let reconnectTimer: number | null = null;
    let reconnectAttempt = 0;
    let connecting = false;
    let currentPort: chrome.runtime.Port | null = null;

    const clearReconnectTimer = (): void => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const scheduleReconnect = (message: string): void => {
      if (!active) {
        return;
      }

      setStatusMessage(message);
      clearReconnectTimer();
      const delay = Math.min(5000, 500 * 2 ** reconnectAttempt);
      reconnectAttempt += 1;
      reconnectTimer = window.setTimeout(() => {
        void connect();
      }, delay);
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
          setCurrentTabId(null);
          setTabReady(false);
          scheduleReconnect("현재 탭 정보를 읽지 못했습니다. 자동으로 다시 연결을 시도합니다.");
          return;
        }

        setCurrentTabId(tab.id);
        if (!isSupportedAssemblyUrl(tab.url)) {
          setUnsupported(true);
          setTabReady(false);
          clearReconnectTimer();
          setStatusMessage("국회 의사중계 페이지에서만 사용할 수 있습니다.");
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
              setSnapshot((current) => ({
                connected: message.payload.connected,
                requiresReload: message.payload.requiresReload,
                status: message.payload.status,
                sessionId: message.payload.sessionId,
                title: message.payload.title,
                committeeName: message.payload.committeeName,
                sourceUrl: message.payload.sourceUrl,
                subtitleCount: current?.subtitleCount ?? 0,
                charCount: current?.charCount ?? 0,
                previewText: current?.previewText ?? "",
                recentEntries: current?.recentEntries ?? [],
                startedAt: message.payload.startedAt,
                endedAt: message.payload.endedAt,
                updatedAt: message.payload.updatedAt,
                lastPersistedAt: message.payload.lastPersistedAt,
                observerActive: message.payload.observerActive,
                currentSelector: message.payload.currentSelector,
                currentFramePath: message.payload.currentFramePath,
                diagnostics: message.payload.diagnostics,
              }));
              setTabReady(true);
              setStatusMessage((current) =>
                current === "현재 페이지를 확인하고 있습니다."
                  ? "페이지 확장판과 연결했습니다."
                  : current,
              );
              return;
            case "PREVIEW_UPDATE":
              setSnapshot((current) =>
                current
                  ? {
                      ...current,
                      previewText: message.payload.previewText,
                      recentEntries: message.payload.recentEntries,
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
      }
    };

    void connect();

    return () => {
      active = false;
      clearReconnectTimer();
      currentPort?.disconnect();
      currentPort = null;
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
    const response = await sendRuntimeMessage({ type: "OPEN_HISTORY_PAGE" });
    if (!response.ok) {
      setStatusMessage(response.error);
      return;
    }
    setStatusMessage("저장된 기록 화면을 열었습니다.");
  };

  const openOptions = async (): Promise<void> => {
    const response = await sendRuntimeMessage({ type: "OPEN_OPTIONS_PAGE" });
    if (!response.ok) {
      setStatusMessage(response.error);
      return;
    }
    setStatusMessage("환경 설정 화면을 열었습니다.");
  };

  const openDiagnostics = async (): Promise<void> => {
    const response = await sendRuntimeMessage({
      type: "OPEN_DIAGNOSTICS_PAGE",
      tabId: currentTabId ?? undefined,
    });
    if (!response.ok) {
      setStatusMessage(response.error);
      return;
    }
    setStatusMessage("수집 진단 화면을 열었습니다.");
  };

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
        <div className="meta-row">
          <span>작동 상태</span>
          <strong>{unsupported ? "지원되지 않음" : tabReady ? "연결됨" : "대기 중"}</strong>
        </div>
        <div className="meta-row">
          <span>회의 이름</span>
          <strong>{snapshot?.committeeName || snapshot?.title || "-"}</strong>
        </div>
        <div className="meta-row">
          <span>모인 자막</span>
          <strong>{snapshot?.subtitleCount ?? 0}문장</strong>
        </div>
        <div className="meta-row">
          <span>누적 글자</span>
          <strong>{snapshot?.charCount ?? 0}자</strong>
        </div>
        <div className="status-line">{statusMessage}</div>
        {requiresReload ? (
          <div className="warning-box">
            확장 설치 전부터 열려 있던 탭이면 새로고침이 필요할 수 있습니다.
          </div>
        ) : null}
      </section>

      <section className="panel">
        <div className="actions-stack">
          {snapshot?.status === "running" ? (
            <button
              onClick={() => sendCommand({ type: "STOP_CAPTURE" }, "현재 수집을 멈춥니다.")}
              disabled={!tabReady}
            >
              {UI_TEXT.stopCapture}
            </button>
          ) : (
            <button
              onClick={() => sendCommand({ type: "START_CAPTURE" }, "현재 탭에서 수집을 시작합니다.")}
              disabled={!tabReady}
            >
              {UI_TEXT.startCapture}
            </button>
          )}
          <button
            className="secondary"
            onClick={() => sendCommand({ type: "SAVE_SESSION" }, "현재 세션을 저장합니다.")}
            disabled={!tabReady}
          >
            {UI_TEXT.saveSession}
          </button>
          <button
            onClick={() => sendCommand({ type: "OPEN_INPAGE_PANEL" }, "페이지 패널 상태를 확인합니다.")}
            disabled={!tabReady}
          >
            {UI_TEXT.openPanel}
          </button>
          <button className="secondary" onClick={() => void openHistory()}>
            {UI_TEXT.openHistory}
          </button>
          <button className="secondary" onClick={() => void openOptions()}>
            {UI_TEXT.openOptions}
          </button>
          <button className="secondary" onClick={() => void openDiagnostics()}>
            {UI_TEXT.openDiagnostics}
          </button>
        </div>
      </section>
    </div>
  );
}
