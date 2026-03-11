import { useEffect, useMemo, useState } from "react";

import { createTab, sendRuntimeMessage } from "../shared/chrome-api";
import { buildCopyText, copyTextToClipboard, filterEntriesByQuery } from "../shared/copy-utils";
import type { ExportFormat, SessionRecord } from "../core/subtitle-models";
import { DEFAULT_EXTENSION_SETTINGS } from "../shared/constants";
import { deleteSession, exportSessionData, listSessions } from "../storage/session-store";
import { getSettings } from "../storage/settings-store";
import { getExportFormatLabel, getPersistedStatusLabel } from "../shared/ui-labels";

const EXPORT_FORMATS: ExportFormat[] = ["txt", "srt", "vtt", "json"];

function formatDate(value: string | null): string {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString("ko-KR");
}

function confirmDeleteSession(target: SessionRecord): boolean {
  if (typeof window === "undefined" || typeof window.confirm !== "function") {
    return true;
  }

  const title = target.committeeName || target.title;
  return window.confirm(`선택한 기록을 삭제할까요?\n${title}`);
}

export default function App() {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [message, setMessage] = useState("기록을 불러오는 중입니다.");
  const [searchQuery, setSearchQuery] = useState("");
  const [recentCopyLineCount, setRecentCopyLineCount] = useState(5);
  const [filenamePattern, setFilenamePattern] = useState(DEFAULT_EXTENSION_SETTINGS.filenamePattern);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedId) ?? sessions[0],
    [sessions, selectedId],
  );
  const filteredEntries = useMemo(
    () => filterEntriesByQuery(selectedSession?.entries ?? [], searchQuery),
    [searchQuery, selectedSession],
  );

  const refresh = async (): Promise<void> => {
    const nextSessions = await listSessions({ limit: 200 });
    setSessions(nextSessions);
    setSelectedId((current) => current || nextSessions[0]?.id || "");
    setMessage(nextSessions.length ? "최신 기록부터 보여주고 있습니다." : "저장된 기록이 없습니다.");
  };

  useEffect(() => {
    void refresh().catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : "기록 목록을 읽지 못했습니다.");
    });
  }, []);

  useEffect(() => {
    void getSettings()
      .then((settings) => {
        setRecentCopyLineCount(settings.recentCopyLineCount);
        setFilenamePattern(settings.filenamePattern);
      })
      .catch(() => {
        // Keep defaults if settings cannot be loaded from a standalone history page.
      });
  }, []);

  const handleDelete = async (): Promise<void> => {
    if (!selectedSession) {
      return;
    }
    if (!confirmDeleteSession(selectedSession)) {
      setMessage("기록 삭제를 취소했습니다.");
      return;
    }
    await deleteSession(selectedSession.id);
    setMessage("선택한 기록을 삭제했습니다.");
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
    const payload = await exportSessionData(selectedSession, format, filenamePattern);
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
    setMessage(`${getExportFormatLabel(format)} 파일 저장을 시작했습니다.`);
  };

  const handleCopy = async (text: string, label: string): Promise<void> => {
    try {
      await copyTextToClipboard(text);
      setMessage(label);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "텍스트 복사에 실패했습니다.");
    }
  };

  return (
    <main className="history-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">기록 보기</p>
          <h1>저장된 자막 기록</h1>
        </div>
        <div className="hero-actions">
          <button onClick={() => void refresh()}>목록 새로고침</button>
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
                <small>{getPersistedStatusLabel(session.status)}</small>
              </button>
            ))
          ) : (
            <div className="empty-card">아직 저장해 둔 기록이 없습니다.</div>
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
                    원본 페이지 열기
                  </button>
                  <button className="secondary" onClick={handleDelete}>
                    삭제
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

              <div className="search-row">
                <input
                  className="search-input"
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="이 기록 안에서 내용 찾기"
                />
                <span>
                  {filteredEntries.length} / {selectedSession.entries.length}개
                </span>
              </div>

              <div className="export-row">
                {EXPORT_FORMATS.map((format) => (
                  <button key={format} onClick={() => void handleExport(format)}>
                    {getExportFormatLabel(format)}
                  </button>
                ))}
              </div>

              <div className="copy-row">
                <button
                  onClick={() =>
                    void handleCopy(
                      buildCopyText(selectedSession.entries, { limit: recentCopyLineCount }),
                      `최근 ${recentCopyLineCount}줄을 복사했습니다.`,
                    )
                  }
                  disabled={!selectedSession.entries.length}
                >
                  최근 {recentCopyLineCount}줄 복사
                </button>
                <button
                  onClick={() =>
                    void handleCopy(
                      buildCopyText(selectedSession.entries, { query: searchQuery }),
                      "찾은 내용을 복사했습니다.",
                    )
                  }
                  disabled={!filteredEntries.length}
                >
                  찾은 내용 복사
                </button>
                <button
                  className="secondary"
                  onClick={() =>
                    void handleCopy(
                      buildCopyText(selectedSession.entries),
                      "전체 내용을 복사했습니다.",
                    )
                  }
                  disabled={!selectedSession.entries.length}
                >
                  전체 내용 복사
                </button>
              </div>

              <div className="entries">
                {filteredEntries.length ? (
                  filteredEntries.map((entry) => (
                    <article key={entry.id} className="entry-card">
                      <time>{formatDate(entry.startTime)}</time>
                      <p>{entry.text}</p>
                    </article>
                  ))
                ) : (
                  <div className="empty-card">
                    {searchQuery ? "찾는 내용이 없습니다." : "이 기록에 자막이 없습니다."}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="empty-card">왼쪽에서 기록을 선택하세요.</div>
          )}
        </section>
      </section>
    </main>
  );
}
