import { useEffect, useState } from "react";

import { isSupportedAssemblyUrl } from "../shared/constants";
import { queryActiveTab, sendRuntimeMessage, sendTabMessage } from "../shared/chrome-api";
import type {
  PopupToContentMessage,
  StatusSnapshot,
  TabCommandResponse,
} from "../shared/message-types";
import { getCaptureStatusLabel, UI_TEXT } from "../shared/ui-labels";

function getContentMessageError(error: unknown): string {
  if (error instanceof Error) {
    if (error.message.includes("Receiving end does not exist")) {
      return "현재 탭과 아직 연결되지 않았습니다. 페이지를 새로고침한 뒤 다시 시도해주세요.";
    }
    return error.message;
  }
  return "현재 탭 상태를 확인하지 못했습니다.";
}

export default function App() {
  const [snapshot, setSnapshot] = useState<StatusSnapshot | null>(null);
  const [statusMessage, setStatusMessage] = useState("현재 페이지를 확인하고 있습니다.");
  const [tabReady, setTabReady] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [requiresReload, setRequiresReload] = useState(false);
  const [currentTabId, setCurrentTabId] = useState<number | null>(null);
  const hasPersistableContent = Boolean(snapshot?.canPersistPreparedContent);

  useEffect(() => {
    let active = true;

    const loadStatus = async (): Promise<void> => {
      try {
        const tab = await queryActiveTab();
        if (!active) {
          return;
        }

        if (!tab?.id || !tab.url) {
          setCurrentTabId(null);
          setSnapshot(null);
          setTabReady(false);
          setRequiresReload(false);
          setStatusMessage("현재 탭 정보를 읽지 못했습니다.");
          return;
        }

        setCurrentTabId(tab.id);
        if (!isSupportedAssemblyUrl(tab.url)) {
          setUnsupported(true);
          setSnapshot(null);
          setTabReady(false);
          setRequiresReload(false);
          setStatusMessage("국회 의사중계 페이지에서만 사용할 수 있습니다.");
          return;
        }

        setUnsupported(false);
        const response = await sendTabMessage<TabCommandResponse>(tab.id, {
          type: "GET_STATUS",
        });
        if (!active) {
          return;
        }

        if (!response.ok) {
          setSnapshot(response.snapshot ?? null);
          setTabReady(false);
          setRequiresReload(true);
          setStatusMessage(response.error);
          return;
        }

        setSnapshot(response.snapshot ?? null);
        setTabReady(true);
        setRequiresReload(false);
        setStatusMessage("현재 탭 상태를 불러왔습니다.");
      } catch (error: unknown) {
        if (!active) {
          return;
        }

        setTabReady(false);
        setRequiresReload(true);
        setStatusMessage(getContentMessageError(error));
      }
    };

    void loadStatus();
    return () => {
      active = false;
    };
  }, []);

  const sendCommand = async (
    message: PopupToContentMessage,
    pendingMessage: string,
  ): Promise<void> => {
    if (currentTabId === null) {
      setStatusMessage("현재 페이지와 아직 연결되지 않았습니다.");
      return;
    }

    setStatusMessage(pendingMessage);

    try {
      const response = await sendTabMessage<TabCommandResponse>(currentTabId, message);
      if (!response.ok) {
        setSnapshot(response.snapshot ?? snapshot);
        setTabReady(false);
        setRequiresReload(true);
        setStatusMessage(response.error);
        return;
      }

      if (response.snapshot) {
        setSnapshot(response.snapshot);
      }
      setTabReady(true);
      setRequiresReload(false);
      setStatusMessage(response.feedback?.message || pendingMessage);
    } catch (error: unknown) {
      setTabReady(false);
      setRequiresReload(true);
      setStatusMessage(getContentMessageError(error));
    }
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
      setStatusMessage("수집 진단 화면을 열었습니다.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "수집 진단 화면을 열지 못했습니다.");
    }
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
        {snapshot?.previewText ? (
          <div className="preview-block">
            <span className="preview-label">최근 자막</span>
            <p className="preview-text">{snapshot.previewText}</p>
          </div>
        ) : null}
      </section>

      <section className="panel">
        <div className="capture-actions">
          {snapshot?.status === "running" ? (
            <button
              className="capture-btn stop"
              onClick={() => void sendCommand({ type: "STOP_CAPTURE" }, "현재 수집을 멈춥니다.")}
              disabled={!tabReady}
            >
              {UI_TEXT.stopCapture}
            </button>
          ) : (
            <button
              className="capture-btn"
              onClick={() => void sendCommand({ type: "START_CAPTURE" }, "현재 탭에서 수집을 시작합니다.")}
              disabled={!tabReady}
            >
              {UI_TEXT.startCapture}
            </button>
          )}
          <div className="save-open-row">
            <button
              className="secondary"
              onClick={() => void sendCommand({ type: "SAVE_SESSION" }, "현재 세션을 저장합니다.")}
              disabled={!tabReady || !hasPersistableContent}
            >
              {UI_TEXT.saveSession}
            </button>
            <button
              className="secondary"
              onClick={() => void sendCommand({ type: "OPEN_INPAGE_PANEL" }, "페이지 패널 상태를 확인합니다.")}
              disabled={!tabReady}
            >
              {UI_TEXT.openPanel}
            </button>
          </div>
        </div>
        <div className="nav-actions">
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
