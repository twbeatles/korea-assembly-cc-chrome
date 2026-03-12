import { useEffect, useMemo, useState } from "react";

import { createTab, sendRuntimeMessage } from "../shared/chrome-api";
import { buildCopyText, copyTextToClipboard, filterEntriesByQuery } from "../shared/copy-utils";
import type { ExportFormat, SessionRecord } from "../core/subtitle-models";
import { DEFAULT_EXTENSION_SETTINGS, EXTENSION_STORAGE_KEY } from "../shared/constants";
import { deleteAllSessions, deleteSession, exportSessionData, listSessions } from "../storage/session-store";
import { getSettings } from "../storage/settings-store";
import { getExportFormatLabel, getPersistedStatusLabel } from "../shared/ui-labels";
import {
  buildDeleteAllFailureMessage,
  buildDeleteAllSuccessMessage,
  buildHistoryRefreshMessage,
  buildSelectedDeleteMessage,
  extractHistoryViewSettings,
  resolveSelectedSessionIds,
  resolveSelectedSessionId,
  selectAllSessionIds,
  selectHistoryViewSettings,
  toggleSelectedSessionId,
} from "./history-view-state";

const EXPORT_FORMATS: ExportFormat[] = ["txt", "srt", "vtt", "json"];
const HISTORY_PAGE_SESSION_LIMIT = 1000;

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

function confirmDeleteSessions(targets: SessionRecord[], scopeLabel: string): boolean {
  if (!targets.length) {
    return false;
  }

  if (typeof window === "undefined" || typeof window.confirm !== "function") {
    return true;
  }

  const previewTitles = targets
    .slice(0, 3)
    .map((target) => `- ${target.committeeName || target.title}`)
    .join("\n");
  const moreLabel =
    targets.length > 3 ? `\n외 ${targets.length - 3}건` : "";

  return window.confirm(
    `${scopeLabel} 기록 ${targets.length}건을 삭제할까요?\n\n${previewTitles}${moreLabel}`,
  );
}

export default function App() {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
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
  const checkedIdSet = useMemo(() => new Set(checkedIds), [checkedIds]);
  const checkedSessions = useMemo(
    () => sessions.filter((session) => checkedIdSet.has(session.id)),
    [checkedIdSet, sessions],
  );
  const allSessionsChecked = sessions.length > 0 && checkedIds.length === sessions.length;

  const refresh = async (messageOnSuccess?: string): Promise<SessionRecord[]> => {
    const nextSessions = await listSessions({ limit: HISTORY_PAGE_SESSION_LIMIT });
    setSessions(nextSessions);
    setSelectedId((current) => resolveSelectedSessionId(current, nextSessions));
    setCheckedIds((current) => resolveSelectedSessionIds(current, nextSessions));
    setMessage(messageOnSuccess ?? buildHistoryRefreshMessage(nextSessions.length));
    return nextSessions;
  };

  useEffect(() => {
    void refresh().catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : "기록 목록을 읽지 못했습니다.");
    });
  }, []);

  useEffect(() => {
    let active = true;

    void getSettings()
      .then((settings) => {
        if (!active) {
          return;
        }

        const nextSettings = selectHistoryViewSettings(settings);
        setRecentCopyLineCount(nextSettings.recentCopyLineCount);
        setFilenamePattern(nextSettings.filenamePattern);
      })
      .catch(() => {
        // Keep defaults if settings cannot be loaded from a standalone history page.
      });

    if (typeof chrome === "undefined" || !chrome.storage?.onChanged) {
      return () => {
        active = false;
      };
    }

    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ): void => {
      if (!active || areaName !== "local" || !changes[EXTENSION_STORAGE_KEY]) {
        return;
      }

      const nextSettings = extractHistoryViewSettings(changes[EXTENSION_STORAGE_KEY].newValue);
      setRecentCopyLineCount(nextSettings.recentCopyLineCount);
      setFilenamePattern(nextSettings.filenamePattern);
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => {
      active = false;
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  const handleDelete = async (): Promise<void> => {
    if (!selectedSession) {
      return;
    }
    if (!confirmDeleteSession(selectedSession)) {
      setMessage("기록 삭제를 취소했습니다.");
      return;
    }

    try {
      await deleteSession(selectedSession.id);
      await refresh("선택한 기록을 삭제했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "기록 삭제에 실패했습니다.");
    }
  };

  const deleteSessionIds = async (
    ids: string[],
  ): Promise<{
    deletedCount: number;
    failedCount: number;
  }> => {
    const results = await Promise.allSettled(ids.map((id) => deleteSession(id)));
    return results.reduce(
      (summary, result) => ({
        deletedCount: summary.deletedCount + (result.status === "fulfilled" ? 1 : 0),
        failedCount: summary.failedCount + (result.status === "rejected" ? 1 : 0),
      }),
      {
        deletedCount: 0,
        failedCount: 0,
      },
    );
  };

  const handleDeleteChecked = async (): Promise<void> => {
    if (!checkedSessions.length) {
      return;
    }
    if (!confirmDeleteSessions(checkedSessions, "선택한")) {
      setMessage("선택 삭제를 취소했습니다.");
      return;
    }

    try {
      const result = await deleteSessionIds(checkedSessions.map((session) => session.id));
      await refresh(
        buildSelectedDeleteMessage(
          checkedSessions.length,
          result.deletedCount,
          result.failedCount,
        ),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "선택 삭제에 실패했습니다.");
    }
  };

  const handleDeleteAll = async (): Promise<void> => {
    try {
      const allSessions = await listSessions({ limit: Number.MAX_SAFE_INTEGER });
      if (!allSessions.length) {
        await refresh();
        return;
      }
      if (!confirmDeleteSessions(allSessions, "전체")) {
        setMessage("전체 삭제를 취소했습니다.");
        return;
      }

      await deleteAllSessions();
      setSearchQuery("");
      await refresh(buildDeleteAllSuccessMessage(allSessions.length));
    } catch (error) {
      try {
        await refresh(
          buildDeleteAllFailureMessage(
            error instanceof Error ? `(${error.message})` : undefined,
          ),
        );
      } catch (refreshError) {
        setMessage(
          refreshError instanceof Error
            ? refreshError.message
            : "저장된 기록 목록을 다시 불러오지 못했습니다.",
        );
      }
    }
  };

  const handleToggleChecked = (sessionId: string): void => {
    setCheckedIds((current) => toggleSelectedSessionId(current, sessionId));
  };

  const handleToggleCheckAll = (): void => {
    setCheckedIds((current) =>
      current.length === sessions.length ? [] : selectAllSessionIds(sessions),
    );
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
          <div className="session-list-toolbar">
            <span>
              총 {sessions.length}개 / 선택 {checkedIds.length}개
            </span>
            <div className="session-list-actions">
              <button className="secondary" onClick={handleToggleCheckAll} disabled={!sessions.length}>
                {allSessionsChecked ? "선택 해제" : "전체 선택"}
              </button>
              <button className="secondary" onClick={() => void handleDeleteChecked()} disabled={!checkedIds.length}>
                선택 삭제
              </button>
              <button className="secondary" onClick={() => void handleDeleteAll()} disabled={!sessions.length}>
                전체 삭제
              </button>
            </div>
          </div>
          {sessions.length ? (
            sessions.map((session) => (
              <div key={session.id} className="session-item-row">
                <label className="session-check">
                  <input
                    type="checkbox"
                    checked={checkedIdSet.has(session.id)}
                    onChange={() => handleToggleChecked(session.id)}
                    aria-label={`${session.committeeName || session.title} 선택`}
                  />
                </label>
                <button
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
              </div>
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
