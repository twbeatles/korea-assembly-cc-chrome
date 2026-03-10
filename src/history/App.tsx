import { useEffect, useMemo, useState } from "react";

import { createTab, sendRuntimeMessage } from "../shared/chrome-api";
import type { ExportFormat, SessionRecord } from "../core/subtitle-models";
import { deleteSession, exportSessionData, listSessions } from "../storage/session-store";

const EXPORT_FORMATS: ExportFormat[] = ["txt", "srt", "vtt", "json"];

function formatDate(value: string | null): string {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString("ko-KR");
}

export default function App() {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [message, setMessage] = useState("세션을 불러오는 중입니다.");

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedId) ?? sessions[0],
    [sessions, selectedId],
  );

  const refresh = async (): Promise<void> => {
    const nextSessions = await listSessions({ limit: 200 });
    setSessions(nextSessions);
    setSelectedId((current) => current || nextSessions[0]?.id || "");
    setMessage(nextSessions.length ? "최신 세션순으로 정렬했습니다." : "저장된 세션이 없습니다.");
  };

  useEffect(() => {
    void refresh().catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : "세션 목록을 읽지 못했습니다.");
    });
  }, []);

  const handleDelete = async (): Promise<void> => {
    if (!selectedSession) {
      return;
    }
    await deleteSession(selectedSession.id);
    setMessage("선택한 세션을 삭제했습니다.");
    await refresh();
  };

  const handleReopen = async (): Promise<void> => {
    if (!selectedSession?.sourceUrl) {
      return;
    }
    await createTab(selectedSession.sourceUrl);
    setMessage("원본 의사중계 페이지를 새 탭으로 열었습니다.");
  };

  const handleExport = async (format: ExportFormat): Promise<void> => {
    if (!selectedSession) {
      return;
    }
    const payload = await exportSessionData(selectedSession, format);
    const response = await sendRuntimeMessage({
      type: "DOWNLOAD_REQUEST",
      filename: payload.filename,
      content: payload.content,
      mimeType: payload.mimeType,
    });
    if (!response.ok) {
      setMessage(response.error);
      return;
    }
    setMessage(`${format.toUpperCase()} 내보내기를 시작했습니다.`);
  };

  return (
    <main className="history-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">History</p>
          <h1>국회 자막 세션 히스토리</h1>
        </div>
        <div className="hero-actions">
          <button onClick={() => void refresh()}>새로고침</button>
          <span>{message}</span>
        </div>
      </header>

      <section className="layout">
        <aside className="session-list">
          {sessions.length ? (
            sessions.map((session) => (
              <button
                key={session.id}
                className={`session-item ${selectedSession?.id === session.id ? "active" : ""}`}
                onClick={() => setSelectedId(session.id)}
              >
                <strong>{session.committeeName || session.title}</strong>
                <span>{formatDate(session.startedAt)}</span>
                <span>
                  {session.subtitleCount}문장 / {session.charCount}자
                </span>
                <small>{session.status}</small>
              </button>
            ))
          ) : (
            <div className="empty-card">아직 저장된 세션이 없습니다.</div>
          )}
        </aside>

        <section className="session-detail">
          {selectedSession ? (
            <>
              <div className="detail-header">
                <div>
                  <h2>{selectedSession.committeeName || selectedSession.title}</h2>
                  <p>{selectedSession.sourceUrl || "원본 URL 없음"}</p>
                </div>
                <div className="detail-actions">
                  <button onClick={handleReopen} disabled={!selectedSession.sourceUrl}>
                    Reopen
                  </button>
                  <button className="secondary" onClick={handleDelete}>
                    Delete
                  </button>
                </div>
              </div>

              <dl className="stats-grid">
                <div>
                  <dt>시작</dt>
                  <dd>{formatDate(selectedSession.startedAt)}</dd>
                </div>
                <div>
                  <dt>종료</dt>
                  <dd>{formatDate(selectedSession.endedAt)}</dd>
                </div>
                <div>
                  <dt>자막 수</dt>
                  <dd>{selectedSession.subtitleCount}</dd>
                </div>
                <div>
                  <dt>글자 수</dt>
                  <dd>{selectedSession.charCount}</dd>
                </div>
              </dl>

              <div className="export-row">
                {EXPORT_FORMATS.map((format) => (
                  <button key={format} onClick={() => void handleExport(format)}>
                    {format.toUpperCase()}
                  </button>
                ))}
              </div>

              <div className="entries">
                {selectedSession.entries.map((entry) => (
                  <article key={entry.id} className="entry-card">
                    <time>{formatDate(entry.startTime)}</time>
                    <p>{entry.text}</p>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <div className="empty-card">왼쪽에서 세션을 선택하세요.</div>
          )}
        </section>
      </section>
    </main>
  );
}
