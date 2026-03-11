import { useEffect, useState } from "react";

import { ASSEMBLY_HOST, POPUP_PORT_NAME } from "../shared/constants";
import { connectToTab, queryActiveTab, sendRuntimeMessage } from "../shared/chrome-api";
import type {
  ContentToPopupMessage,
  PopupToContentMessage,
  StatusSnapshot,
} from "../shared/message-types";
import { getCaptureStatusLabel, UI_TEXT } from "../shared/ui-labels";

function formatDate(value: string | null): string {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString("ko-KR");
}

export default function App() {
  const [snapshot, setSnapshot] = useState<StatusSnapshot | null>(null);
  const [statusMessage, setStatusMessage] = useState("현재 페이지를 확인하고 있습니다.");
  const [tabReady, setTabReady] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [requiresReload, setRequiresReload] = useState(false);
  const [port, setPort] = useState<chrome.runtime.Port | null>(null);

  useEffect(() => {
    let active = true;

    const connect = async (): Promise<void> => {
      const tab = await queryActiveTab();
      if (!active) {
        return;
      }

      if (!tab?.id || !tab.url) {
        setStatusMessage("현재 탭 정보를 읽지 못했습니다.");
        return;
      }

      if (!tab.url.startsWith(ASSEMBLY_HOST)) {
        setUnsupported(true);
        setStatusMessage("국회 의사중계 페이지에서만 사용할 수 있습니다.");
        return;
      }

      const ensure = await sendRuntimeMessage({
        type: "ENSURE_CONTENT_SCRIPT",
        tabId: tab.id,
        url: tab.url,
      });
      if (!active) {
        return;
      }

      if (!ensure.ok) {
        setStatusMessage(ensure.error);
        return;
      }

      setRequiresReload(Boolean(ensure.requiresReload));
      if (!ensure.ready) {
        setStatusMessage("현재 탭과 아직 연결되지 않았습니다. 탭을 새로고침한 뒤 다시 열어주세요.");
        return;
      }

      const nextPort = connectToTab(tab.id, 0, POPUP_PORT_NAME);
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
            }));
            setTabReady(true);
            setStatusMessage("페이지 안 패널과 연결되었습니다.");
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
        }
      };

      const onDisconnect = (): void => {
        const disconnectReason = chrome.runtime.lastError?.message;
        if (!active) {
          return;
        }
        setPort(null);
        setTabReady(false);
        setRequiresReload(true);
        setStatusMessage(
          disconnectReason?.includes("Receiving end does not exist")
            ? "현재 탭과의 연결이 없습니다. 탭을 새로고침한 뒤 다시 열어주세요."
            : disconnectReason || "연결이 끊겼습니다. 탭을 새로고침한 뒤 다시 열어주세요.",
        );
      };

      nextPort.onMessage.addListener(onMessage);
      nextPort.onDisconnect.addListener(onDisconnect);
      nextPort.postMessage({ type: "GET_STATUS" } satisfies PopupToContentMessage);
    };

    void connect().catch((error: unknown) => {
      if (!active) {
        return;
      }
      setStatusMessage(error instanceof Error ? error.message : "팝업을 준비하지 못했습니다.");
    });

    return () => {
      active = false;
      setPort((current) => {
        current?.disconnect();
        return null;
      });
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
          <span>현재 페이지</span>
          <strong>{unsupported ? "지원되지 않음" : tabReady ? "연결됨" : "대기 중"}</strong>
        </div>
        <div className="meta-row">
          <span>상태</span>
          <strong>{snapshot ? getCaptureStatusLabel(snapshot.status) : "-"}</strong>
        </div>
        <div className="meta-row">
          <span>회의 이름</span>
          <strong>{snapshot?.committeeName || snapshot?.title || "-"}</strong>
        </div>
        <div className="meta-row">
          <span>모인 자막</span>
          <strong>
            {snapshot?.subtitleCount ?? 0}문장 / {snapshot?.charCount ?? 0}자
          </strong>
        </div>
        <div className="meta-row">
          <span>시작 시각</span>
          <strong>{formatDate(snapshot?.startedAt ?? null)}</strong>
        </div>
        <div className="meta-row">
          <span>마지막 저장</span>
          <strong>{formatDate(snapshot?.lastPersistedAt ?? null)}</strong>
        </div>
        <div className="status-line">{statusMessage}</div>
        {requiresReload ? (
          <div className="warning-box">
            확장 설치 전부터 열려 있던 탭이면 새로고침이 필요할 수 있습니다.
          </div>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>사용 방법</h2>
        </div>
        <p className="help-text">
          이제 자막 수집 화면은 확장 아이콘 안이 아니라 국회 사이트 오른쪽 패널에 바로
          나타납니다.
        </p>
        <div className="actions-stack">
          <button
            onClick={() =>
              sendCommand({ type: "OPEN_INPAGE_PANEL" }, "페이지 오른쪽 패널을 다시 열고 있습니다.")
            }
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
        </div>
      </section>
    </div>
  );
}
