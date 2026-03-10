import { useEffect, useRef, useState } from "react";

import { ASSEMBLY_HOST, POPUP_PORT_NAME } from "../shared/constants";
import { connectToTab, queryActiveTab, sendRuntimeMessage } from "../shared/chrome-api";
import type {
  ContentToPopupMessage,
  PopupToContentMessage,
  StatusSnapshot,
} from "../shared/message-types";

const EXPORT_FORMATS = ["txt", "srt", "vtt", "json"] as const;

const STATUS_LABELS: Record<string, string> = {
  idle: "대기 중",
  running: "수집 중",
  stopped: "중지됨",
  error: "오류",
};

function formatDate(value: string | null): string {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString("ko-KR");
}

export default function App() {
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const [snapshot, setSnapshot] = useState<StatusSnapshot | null>(null);
  const [statusMessage, setStatusMessage] = useState("활성 탭을 확인하는 중입니다.");
  const [tabReady, setTabReady] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [requiresReload, setRequiresReload] = useState(false);

  useEffect(() => {
    let active = true;

    const connect = async (): Promise<void> => {
      const tab = await queryActiveTab();
      if (!active) {
        return;
      }

      if (!tab?.id || !tab.url) {
        setStatusMessage("활성 탭 정보를 읽을 수 없습니다.");
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
      const port = connectToTab(tab.id, 0, POPUP_PORT_NAME);
      portRef.current = port;

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
              observerActive: message.payload.observerActive,
              currentSelector: message.payload.currentSelector,
              currentFramePath: message.payload.currentFramePath,
            }));
            setTabReady(true);
            setStatusMessage("현재 탭과 연결되었습니다.");
            return;
          case "PREVIEW_UPDATE":
            setSnapshot((current) =>
              current
                ? {
                    ...current,
                    sessionId: message.payload.sessionId,
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
                    sessionId: message.payload.sessionId,
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
        if (!active) {
          return;
        }
        setTabReady(false);
        setRequiresReload(true);
        setStatusMessage("content script 연결이 끊겼습니다. 탭 새로고침 후 다시 시도하세요.");
      };

      port.onMessage.addListener(onMessage);
      port.onDisconnect.addListener(onDisconnect);
      port.postMessage({ type: "GET_STATUS" } satisfies PopupToContentMessage);
    };

    void connect().catch((error: unknown) => {
      if (!active) {
        return;
      }
      setStatusMessage(error instanceof Error ? error.message : "popup 초기화에 실패했습니다.");
    });

    return () => {
      active = false;
      portRef.current?.disconnect();
      portRef.current = null;
    };
  }, []);

  const sendCommand = (message: PopupToContentMessage, label: string): void => {
    if (!portRef.current) {
      setStatusMessage("현재 탭과 연결되지 않았습니다.");
      return;
    }
    setStatusMessage(label);
    portRef.current.postMessage(message);
  };

  const openHistory = async (): Promise<void> => {
    const response = await sendRuntimeMessage({ type: "OPEN_HISTORY_PAGE" });
    if (!response.ok) {
      setStatusMessage(response.error);
    }
  };

  const openOptions = async (): Promise<void> => {
    const response = await sendRuntimeMessage({ type: "OPEN_OPTIONS_PAGE" });
    if (!response.ok) {
      setStatusMessage(response.error);
    }
  };

  return (
    <div className="popup-shell">
      <header className="popup-header">
        <div>
          <p className="eyebrow">Assembly Subtitle Capture</p>
          <h1>국회 AI 자막 추출기</h1>
        </div>
        <span className={`status-badge ${snapshot?.status ?? "idle"}`}>
          {snapshot ? STATUS_LABELS[snapshot.status] : "연결 전"}
        </span>
      </header>

      <section className="panel">
        <div className="meta-row">
          <span>탭 연결</span>
          <strong>{tabReady ? "연결됨" : unsupported ? "비지원 페이지" : "대기 중"}</strong>
        </div>
        <div className="meta-row">
          <span>옵저버</span>
          <strong>{snapshot?.observerActive ? "활성" : "fallback / 미감지"}</strong>
        </div>
        <div className="meta-row">
          <span>위원회</span>
          <strong>{snapshot?.committeeName || "-"}</strong>
        </div>
        <div className="meta-row">
          <span>세션 시작</span>
          <strong>{formatDate(snapshot?.startedAt ?? null)}</strong>
        </div>
        <div className="status-line">{statusMessage}</div>
        {requiresReload ? (
          <div className="warning-box">
            확장 설치 이후 열려 있던 탭이면 새로고침이 필요할 수 있습니다.
          </div>
        ) : null}
      </section>

      <section className="actions-grid">
        <button
          onClick={() => sendCommand({ type: "START_CAPTURE" }, "자막 수집 시작을 요청했습니다.")}
          disabled={!tabReady}
        >
          Start
        </button>
        <button
          onClick={() => sendCommand({ type: "STOP_CAPTURE" }, "자막 수집 중지를 요청했습니다.")}
          disabled={!tabReady}
        >
          Stop
        </button>
        <button
          onClick={() => sendCommand({ type: "CLEAR_SESSION" }, "현재 세션 초기화를 요청했습니다.")}
          disabled={!tabReady}
        >
          Clear
        </button>
        <button
          onClick={() => sendCommand({ type: "SAVE_SESSION" }, "현재 세션 저장을 요청했습니다.")}
          disabled={!tabReady}
        >
          Save Session
        </button>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>실시간 Preview</h2>
          <span>
            {snapshot?.subtitleCount ?? 0}문장 / {snapshot?.charCount ?? 0}자
          </span>
        </div>
        <div className="preview-box">
          {snapshot?.previewText || "자막이 감지되면 이 영역에 최신 누적 텍스트가 표시됩니다."}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>최근 자막</h2>
          <span>{snapshot?.recentEntries.length ?? 0}개 표시</span>
        </div>
        <div className="entry-list">
          {(snapshot?.recentEntries ?? []).length ? (
            snapshot?.recentEntries.map((entry) => (
              <article className="entry-card" key={entry.id}>
                <time>{formatDate(entry.startTime)}</time>
                <p>{entry.text}</p>
              </article>
            ))
          ) : (
            <p className="empty-state">아직 수집된 자막이 없습니다.</p>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>내보내기</h2>
          <span>TXT / SRT / VTT / JSON</span>
        </div>
        <div className="export-grid">
          {EXPORT_FORMATS.map((format) => (
            <button
              key={format}
              onClick={() =>
                sendCommand(
                  { type: "EXPORT_REQUEST", format },
                  `${format.toUpperCase()} 내보내기를 요청했습니다.`,
                )
              }
              disabled={!tabReady || !snapshot?.subtitleCount}
            >
              {format.toUpperCase()}
            </button>
          ))}
        </div>
      </section>

      <footer className="footer-actions">
        <button onClick={openHistory}>History</button>
        <button onClick={openOptions}>Settings</button>
      </footer>
    </div>
  );
}
