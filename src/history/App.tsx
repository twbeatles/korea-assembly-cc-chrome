import { useEffect, useMemo, useRef, useState } from "react";

import { createTab, sendRuntimeMessage } from "../shared/chrome-api";
import { buildCopyText, copyTextToClipboard, filterEntriesByQuery } from "../shared/copy-utils";
import type { ExportFormat, SessionRecord } from "../core/subtitle-models";
import {
  DEFAULT_EXTENSION_SETTINGS,
  EXTENSION_STORAGE_KEY,
  SESSION_LIBRARY_REVISION_STORAGE_KEY,
} from "../shared/constants";
import { parseSessionImportPayload } from "../storage/session-backup";
import {
  buildSessionLibraryBackupExport,
  deleteAllSessions,
  deleteSession,
  exportSessionData,
  getSessionLibraryOverview,
  importSessionRecords,
  listSessionsPage,
  loadSession,
  loadSessionsByIds,
  upsertSessionRecord,
} from "../storage/session-store";
import type { SessionLibraryPreview } from "../storage/types";
import { getSettings } from "../storage/settings-store";
import { getExportFormatLabel, getPersistedStatusLabel } from "../shared/ui-labels";
import {
  buildDeleteAllFailureMessage,
  buildDeleteAllSuccessMessage,
  buildHistoryRefreshMessage,
  buildSelectedDeleteMessage,
  buildSessionImportMessage,
  extractHistoryViewSettings,
  resolveSelectedEntryIds,
  selectAllEntryIds,
  selectAllSessionIds,
  selectHistoryViewSettings,
  toggleSelectedEntryId,
  toggleSelectedSessionId,
} from "./history-view-state";

const EXPORT_FORMATS: ExportFormat[] = ["txt", "srt", "vtt", "json"];
const HISTORY_PAGE_SIZE = 200;

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

function confirmDeleteSessions(
  targets: SessionRecord[],
  scopeLabel: string,
  extraNotice?: string,
): boolean {
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
  const moreLabel = targets.length > 3 ? `\n외 ${targets.length - 3}건` : "";

  return window.confirm(
    `${scopeLabel} 기록 ${targets.length}건을 삭제할까요?\n\n${previewTitles}${moreLabel}${extraNotice ? `\n\n${extraNotice}` : ""}`,
  );
}

function confirmDeleteSessionLibrary(
  overview: {
    totalCount: number;
    previewSessions: SessionLibraryPreview[];
  },
  extraNotice?: string,
): boolean {
  if (!overview.totalCount) {
    return false;
  }

  if (typeof window === "undefined" || typeof window.confirm !== "function") {
    return true;
  }

  const previewTitles = overview.previewSessions
    .map((target) => `- ${target.committeeName || target.title}`)
    .join("\n");
  const moreLabel =
    overview.totalCount > overview.previewSessions.length
      ? `\n외 ${overview.totalCount - overview.previewSessions.length}건`
      : "";

  return window.confirm(
    `전체 기록 ${overview.totalCount}건을 삭제할까요?\n\n${previewTitles}${moreLabel}${extraNotice ? `\n\n${extraNotice}` : ""}`,
  );
}

function confirmDiscardUnsavedNote(actionLabel: string): boolean {
  if (typeof window === "undefined" || typeof window.confirm !== "function") {
    return true;
  }

  return window.confirm(`저장하지 않은 메모가 있습니다. ${actionLabel} 전에 변경 내용을 버릴까요?`);
}

export default function App() {
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const refreshMessageRef = useRef<string | undefined>(undefined);
  const preserveMessageOnRefreshRef = useRef(false);
  const selectedIdRef = useRef("");
  const checkedIdsRef = useRef<string[]>([]);
  const noteDraftRef = useRef("");
  const previousSelectedSessionRef = useRef<SessionRecord | null>(null);
  const [pageSessions, setPageSessions] = useState<SessionRecord[]>([]);
  const [totalSessionCount, setTotalSessionCount] = useState(0);
  const [selectedSession, setSelectedSession] = useState<SessionRecord | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [checkedEntryIds, setCheckedEntryIds] = useState<string[]>([]);
  const [message, setMessage] = useState("기록을 불러오는 중입니다.");
  const [searchQuery, setSearchQuery] = useState("");
  const [showStarredOnly, setShowStarredOnly] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [sessionPage, setSessionPage] = useState(1);
  const [recentCopyLineCount, setRecentCopyLineCount] = useState(5);
  const [filenamePattern, setFilenamePattern] = useState(DEFAULT_EXTENSION_SETTINGS.filenamePattern);
  const [reloadKey, setReloadKey] = useState(0);

  const filteredEntries = useMemo(
    () => filterEntriesByQuery(selectedSession?.entries ?? [], searchQuery),
    [searchQuery, selectedSession],
  );
  const checkedIdSet = useMemo(() => new Set(checkedIds), [checkedIds]);
  const checkedEntryIdSet = useMemo(() => new Set(checkedEntryIds), [checkedEntryIds]);
  const pageCount = Math.max(1, Math.ceil(totalSessionCount / HISTORY_PAGE_SIZE));
  const selectedEntries = useMemo(
    () =>
      selectedSession?.entries.filter((entry) => checkedEntryIdSet.has(entry.id)) ?? [],
    [checkedEntryIdSet, selectedSession],
  );
  const currentPageSessionsChecked =
    pageSessions.length > 0 && pageSessions.every((session) => checkedIdSet.has(session.id));
  const allVisibleEntriesChecked =
    filteredEntries.length > 0 &&
    filteredEntries.every((entry) => checkedEntryIdSet.has(entry.id));
  const hasUnsavedNote =
    selectedSession ? noteDraft !== selectedSession.note : noteDraft.trim().length > 0;

  const runHistoryAction = (action: () => Promise<void>, fallbackMessage: string): void => {
    void action().catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : fallbackMessage);
    });
  };

  const requestRefresh = (
    messageOnSuccess?: string,
    options: {
      preserveMessage?: boolean;
    } = {},
  ): void => {
    refreshMessageRef.current = messageOnSuccess;
    preserveMessageOnRefreshRef.current = options.preserveMessage ?? false;
    setReloadKey((current) => current + 1);
  };

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    checkedIdsRef.current = checkedIds;
  }, [checkedIds]);

  useEffect(() => {
    noteDraftRef.current = noteDraft;
  }, [noteDraft]);

  useEffect(() => {
    const previousSelectedSession = previousSelectedSessionRef.current;
    const selectedSessionIdChanged = previousSelectedSession?.id !== selectedSession?.id;

    if (selectedSessionIdChanged) {
      setNoteDraft(selectedSession?.note ?? "");
    } else if (
      previousSelectedSession &&
      selectedSession &&
      noteDraftRef.current === previousSelectedSession.note
    ) {
      setNoteDraft(selectedSession.note);
    }

    setCheckedEntryIds((current) =>
      resolveSelectedEntryIds(current, selectedSession?.entries ?? []),
    );
    previousSelectedSessionRef.current = selectedSession;
  }, [selectedSession]);

  useEffect(() => {
    let active = true;
    const messageOnSuccess = refreshMessageRef.current;
    const preserveMessage = preserveMessageOnRefreshRef.current;
    refreshMessageRef.current = undefined;
    preserveMessageOnRefreshRef.current = false;

    void (async () => {
      try {
        const pageResult = await listSessionsPage({
          page: sessionPage,
          pageSize: HISTORY_PAGE_SIZE,
          starredOnly: showStarredOnly,
        });
        if (!active) {
          return;
        }

        setPageSessions(pageResult.sessions);
        setTotalSessionCount(pageResult.totalCount);
        if (pageResult.page !== sessionPage) {
          setSessionPage(pageResult.page);
        }

        if (checkedIdsRef.current.length > 0) {
          const existingCheckedSessions = await loadSessionsByIds(checkedIdsRef.current);
          if (!active) {
            return;
          }
          setCheckedIds(existingCheckedSessions.map((session) => session.id));
        }

        let nextSelectedId = selectedIdRef.current || pageResult.sessions[0]?.id || "";
        let nextSelectedSession =
          pageResult.sessions.find((session) => session.id === nextSelectedId) ?? null;

        if (!nextSelectedSession && nextSelectedId) {
          const loadedSelectedSession = await loadSession(nextSelectedId);
          if (!active) {
            return;
          }
          if (loadedSelectedSession && (!showStarredOnly || loadedSelectedSession.starred)) {
            nextSelectedSession = loadedSelectedSession;
          }
        }

        if (!nextSelectedSession && pageResult.sessions.length > 0) {
          nextSelectedSession = pageResult.sessions[0];
          nextSelectedId = nextSelectedSession.id;
        }

        if (!nextSelectedSession) {
          nextSelectedId = "";
        }

        setSelectedId(nextSelectedId);
        setSelectedSession(nextSelectedSession);

        if (!preserveMessage) {
          setMessage(messageOnSuccess ?? buildHistoryRefreshMessage(pageResult.totalCount));
        }
      } catch (error: unknown) {
        if (!active) {
          return;
        }
        setMessage(error instanceof Error ? error.message : "기록 목록을 읽지 못했습니다.");
      }
    })();

    return () => {
      active = false;
    };
  }, [reloadKey, sessionPage, showStarredOnly]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (!hasUnsavedNote) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedNote]);

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
      if (!active || areaName !== "local") {
        return;
      }

      if (changes[EXTENSION_STORAGE_KEY]) {
        const nextSettings = extractHistoryViewSettings(changes[EXTENSION_STORAGE_KEY].newValue);
        setRecentCopyLineCount(nextSettings.recentCopyLineCount);
        setFilenamePattern(nextSettings.filenamePattern);
      }

      if (changes[SESSION_LIBRARY_REVISION_STORAGE_KEY]) {
        preserveMessageOnRefreshRef.current = true;
        setReloadKey((current) => current + 1);
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => {
      active = false;
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  const handleRefreshClick = async (): Promise<void> => {
    if (hasUnsavedNote && !confirmDiscardUnsavedNote("목록 새로고침")) {
      setMessage("새로고침을 취소했습니다.");
      return;
    }

    requestRefresh();
  };

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
      requestRefresh("선택한 기록을 삭제했습니다.");
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
    if (!checkedIds.length) {
      return;
    }

    const targetSessions = await loadSessionsByIds(checkedIds);
    if (!targetSessions.length) {
      setCheckedIds([]);
      requestRefresh(undefined, { preserveMessage: true });
      return;
    }

    if (!confirmDeleteSessions(targetSessions, "선택한")) {
      setMessage("선택 삭제를 취소했습니다.");
      return;
    }

    try {
      const result = await deleteSessionIds(targetSessions.map((session) => session.id));
      setCheckedIds([]);
      requestRefresh(
        buildSelectedDeleteMessage(
          targetSessions.length,
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
      const overview = await getSessionLibraryOverview();
      if (!overview.totalCount) {
        requestRefresh();
        return;
      }
      if (
        !confirmDeleteSessionLibrary(
          overview,
          "이 확인 이후에 새로 저장된 기록도 함께 삭제될 수 있습니다.",
        )
      ) {
        setMessage("전체 삭제를 취소했습니다.");
        return;
      }

      await deleteAllSessions();
      setSearchQuery("");
      setCheckedIds([]);
      setCheckedEntryIds([]);
      requestRefresh(buildDeleteAllSuccessMessage(overview.totalCount));
    } catch (error) {
      requestRefresh(
        buildDeleteAllFailureMessage(
          error instanceof Error ? `(${error.message})` : undefined,
        ),
      );
    }
  };

  const handleToggleChecked = (sessionId: string): void => {
    setCheckedIds((current) => toggleSelectedSessionId(current, sessionId));
  };

  const handleToggleCheckAll = (): void => {
    setCheckedIds((current) =>
      currentPageSessionsChecked
        ? current.filter((id) => !pageSessions.some((session) => session.id === id))
        : [...new Set([...current, ...selectAllSessionIds(pageSessions)])],
    );
  };

  const handleToggleFavorite = async (session: SessionRecord): Promise<void> => {
    try {
      await upsertSessionRecord({
        ...session,
        starred: !session.starred,
        pinnedAt: session.starred ? null : new Date().toISOString(),
      });
      requestRefresh(
        session.starred ? "즐겨찾기를 해제했습니다." : "즐겨찾기에 추가했습니다.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "즐겨찾기 저장에 실패했습니다.");
    }
  };

  const handleSaveNote = async (): Promise<void> => {
    if (!selectedSession) {
      return;
    }

    try {
      await upsertSessionRecord({
        ...selectedSession,
        note: noteDraft,
      });
      requestRefresh(noteDraft.trim() ? "메모를 저장했습니다." : "메모를 비웠습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "메모 저장에 실패했습니다.");
    }
  };

  const handleReopen = async (): Promise<void> => {
    if (!selectedSession?.sourceUrl) {
      return;
    }

    try {
      await createTab(selectedSession.sourceUrl);
      setMessage("원본 의사중계 페이지를 새 탭으로 열었습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "원본 페이지를 열지 못했습니다.");
    }
  };

  const handleExport = async (
    format: ExportFormat,
    entries?: SessionRecord["entries"],
  ): Promise<void> => {
    if (!selectedSession) {
      return;
    }

    try {
      const payload = await exportSessionData(selectedSession, format, filenamePattern, entries);
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

      if (entries?.length) {
        setMessage(
          `선택한 ${entries.length}줄 ${getExportFormatLabel(format)} 저장을 시작했습니다.`,
        );
        return;
      }

      setMessage(`${getExportFormatLabel(format)} 파일 저장을 시작했습니다.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "파일 저장을 시작하지 못했습니다.");
    }
  };

  const handleCopy = async (text: string, label: string): Promise<void> => {
    try {
      await copyTextToClipboard(text);
      setMessage(label);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "텍스트 복사에 실패했습니다.");
    }
  };

  const handleSelectVisibleEntries = (): void => {
    setCheckedEntryIds((current) => [
      ...new Set([...current, ...selectAllEntryIds(filteredEntries)]),
    ]);
  };

  const handleToggleVisibleEntries = (): void => {
    if (allVisibleEntriesChecked) {
      setCheckedEntryIds((current) =>
        current.filter((id) => !filteredEntries.some((entry) => entry.id === id)),
      );
      return;
    }

    handleSelectVisibleEntries();
  };

  const handleSelectSession = (sessionId: string): void => {
    if (sessionId !== selectedSession?.id && hasUnsavedNote && !confirmDiscardUnsavedNote("세션 전환")) {
      setMessage("세션 전환을 취소했습니다.");
      return;
    }

    const nextSelectedSession = pageSessions.find((session) => session.id === sessionId) ?? null;
    setSelectedId(sessionId);
    setSelectedSession(nextSelectedSession);
  };

  const handleToggleEntryChecked = (entryId: string): void => {
    setCheckedEntryIds((current) => toggleSelectedEntryId(current, entryId));
  };

  const handleBackupAll = async (): Promise<void> => {
    try {
      const backupExport = await buildSessionLibraryBackupExport();
      if (!backupExport.sessionCount) {
        setMessage("백업할 기록이 없습니다.");
        return;
      }

      const response = await sendRuntimeMessage({
        type: "DOWNLOAD_REQUEST",
        filename: backupExport.payload.filename,
        content: backupExport.payload.content,
        mimeType: backupExport.payload.mimeType,
      });
      if (!response.ok) {
        setMessage(response.error);
        return;
      }

      setMessage(`저장된 기록 ${backupExport.sessionCount}건의 JSON 백업을 시작했습니다.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "전체 JSON 백업에 실패했습니다.");
    }
  };

  const handleImportClick = (): void => {
    importInputRef.current?.click();
  };

  const handleImportChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const importPayload = parseSessionImportPayload(parsed);
      if (!importPayload.records.length && importPayload.invalidCount === 0) {
        setMessage("가져올 기록이 없습니다.");
        return;
      }

      const summary = await importSessionRecords(importPayload.records);
      requestRefresh(
        buildSessionImportMessage({
          ...summary,
          invalidCount: importPayload.invalidCount,
        }),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "JSON 가져오기에 실패했습니다.");
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
          <button
            onClick={() => runHistoryAction(handleRefreshClick, "기록 목록을 다시 읽지 못했습니다.")}
          >
            목록 새로고침
          </button>
          <button
            className={`secondary ${showStarredOnly ? "active-toggle" : ""}`}
            onClick={() => {
              if (hasUnsavedNote && !confirmDiscardUnsavedNote("필터 변경")) {
                setMessage("필터 변경을 취소했습니다.");
                return;
              }
              setShowStarredOnly((current) => !current);
            }}
          >
            {showStarredOnly ? "전체 보기" : "즐겨찾기만 보기"}
          </button>
          <button
            className="secondary"
            onClick={() => runHistoryAction(handleBackupAll, "전체 JSON 백업에 실패했습니다.")}
          >
            전체 JSON 백업
          </button>
          <button className="secondary" onClick={handleImportClick}>
            JSON 가져오기
          </button>
          <span>{message}</span>
        </div>
        <input
          ref={importInputRef}
          className="hidden-file-input"
          type="file"
          accept=".json,application/json"
          onChange={(event) => void handleImportChange(event)}
        />
      </header>

      <section className="layout">
        <aside className="session-list">
          <div className="session-list-toolbar">
            <span>
              현재 필터 {totalSessionCount}개 / 현재 페이지 {pageSessions.length}개 / 선택 {checkedIds.length}개
            </span>
            <div className="session-list-actions">
              <button className="secondary" onClick={handleToggleCheckAll} disabled={!pageSessions.length}>
                {currentPageSessionsChecked ? "현재 페이지 선택 해제" : "현재 페이지 전체 선택"}
              </button>
              <button
                className="secondary"
                onClick={() => runHistoryAction(handleDeleteChecked, "선택 삭제에 실패했습니다.")}
                disabled={!checkedIds.length}
              >
                선택 삭제
              </button>
              <button
                className="secondary"
                onClick={() => runHistoryAction(handleDeleteAll, "전체 삭제에 실패했습니다.")}
                disabled={!totalSessionCount}
              >
                전체 삭제
              </button>
            </div>
          </div>
          {pageSessions.length ? (
            pageSessions.map((session) => (
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
                  type="button"
                  className={`favorite-toggle ${session.starred ? "active" : ""}`}
                  onClick={() => void handleToggleFavorite(session)}
                  aria-label={
                    session.starred
                      ? `${session.committeeName || session.title} 즐겨찾기 해제`
                      : `${session.committeeName || session.title} 즐겨찾기 추가`
                  }
                >
                  {session.starred ? "★" : "☆"}
                </button>
                <button
                  className={`session-item ${selectedSession?.id === session.id ? "active" : ""}`}
                  onClick={() => handleSelectSession(session.id)}
                >
                  <strong>{session.committeeName || session.title}</strong>
                  <span>{formatDate(session.startedAt)}</span>
                  <span>
                    {session.subtitleCount}문장 / {session.charCount}자
                  </span>
                  <small>{getPersistedStatusLabel(session.status)}</small>
                  {session.note.trim() ? <small>메모 있음</small> : null}
                </button>
              </div>
            ))
          ) : (
            <div className="empty-card">
              {showStarredOnly
                ? "즐겨찾기한 기록이 없습니다."
                : "아직 저장해 둔 기록이 없습니다."}
            </div>
          )}
          {totalSessionCount > HISTORY_PAGE_SIZE ? (
            <div className="session-pagination">
              <button
                className="secondary"
                onClick={() => setSessionPage((current) => Math.max(1, current - 1))}
                disabled={sessionPage <= 1}
              >
                이전 페이지
              </button>
              <span>
                {sessionPage} / {pageCount}
              </span>
              <button
                className="secondary"
                onClick={() => setSessionPage((current) => Math.min(pageCount, current + 1))}
                disabled={sessionPage >= pageCount}
              >
                다음 페이지
              </button>
            </div>
          ) : null}
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
                  <button
                    className="secondary"
                    onClick={() => void handleToggleFavorite(selectedSession)}
                  >
                    {selectedSession.starred ? "즐겨찾기 해제" : "즐겨찾기 추가"}
                  </button>
                  <button
                    onClick={() => runHistoryAction(handleReopen, "원본 페이지를 열지 못했습니다.")}
                    disabled={!selectedSession.sourceUrl}
                  >
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

              <div className="note-card">
                <div className="section-row">
                  <strong>세션 메모</strong>
                  <div className="note-meta">
                    <span>{noteDraft.trim().length}자</span>
                    <span className={`note-status ${hasUnsavedNote ? "dirty" : ""}`}>
                      {hasUnsavedNote ? "저장되지 않음" : "저장됨"}
                    </span>
                  </div>
                </div>
                <textarea
                  className="note-input"
                  value={noteDraft}
                  onChange={(event) => setNoteDraft(event.target.value)}
                  placeholder="이 기록에 대한 메모를 남겨두세요."
                  rows={4}
                />
                <div className="note-actions">
                  <button
                    onClick={() => runHistoryAction(handleSaveNote, "메모 저장에 실패했습니다.")}
                    disabled={noteDraft === selectedSession.note}
                  >
                    메모 저장
                  </button>
                  <button
                    className="secondary"
                    onClick={() => setNoteDraft("")}
                    disabled={!noteDraft}
                  >
                    입력 비우기
                  </button>
                </div>
              </div>

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

              <div className="selection-toolbar">
                <span>
                  보이는 항목 {filteredEntries.length}개 / 선택 {selectedEntries.length}개
                </span>
                <div className="selection-actions">
                  <button
                    className="secondary"
                    onClick={handleToggleVisibleEntries}
                    disabled={!filteredEntries.length}
                  >
                    {allVisibleEntriesChecked ? "보이는 항목 선택 해제" : "보이는 항목 전체 선택"}
                  </button>
                  <button
                    className="secondary"
                    onClick={() => setCheckedEntryIds([])}
                    disabled={!checkedEntryIds.length}
                  >
                    전체 선택 해제
                  </button>
                  <button
                    onClick={() =>
                      void handleCopy(
                        buildCopyText(selectedSession.entries, {
                          selectedIds: checkedEntryIds,
                        }),
                        `선택한 ${selectedEntries.length}줄을 복사했습니다.`,
                      )
                    }
                    disabled={!selectedEntries.length}
                  >
                    선택한 항목 복사
                  </button>
                </div>
              </div>

              <div className="export-row">
                {EXPORT_FORMATS.map((format) => (
                  <button
                    key={format}
                    onClick={() =>
                      runHistoryAction(
                        () => handleExport(format),
                        `${getExportFormatLabel(format)} 저장을 시작하지 못했습니다.`,
                      )
                    }
                  >
                    {getExportFormatLabel(format)}
                  </button>
                ))}
              </div>

              <div className="export-row partial-export-row">
                {EXPORT_FORMATS.map((format) => (
                  <button
                    key={`selected_${format}`}
                    className="secondary"
                    onClick={() =>
                      runHistoryAction(
                        () => handleExport(format, selectedEntries),
                        `선택 ${format.toUpperCase()} 저장을 시작하지 못했습니다.`,
                      )
                    }
                    disabled={!selectedEntries.length}
                  >
                    선택 {format.toUpperCase()}
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
                    <div key={entry.id} className="entry-card-row">
                      <label className="entry-check">
                        <input
                          type="checkbox"
                          checked={checkedEntryIdSet.has(entry.id)}
                          onChange={() => handleToggleEntryChecked(entry.id)}
                          aria-label={`${entry.text.slice(0, 30)} 항목 선택`}
                        />
                      </label>
                      <article className="entry-card">
                        <time>{formatDate(entry.startTime)}</time>
                        <p>{entry.text}</p>
                      </article>
                    </div>
                  ))
                ) : (
                  <div className="empty-card">
                    {searchQuery ? "찾는 내용이 없습니다." : "이 기록에 자막이 없습니다."}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="empty-card">
              {totalSessionCount > 0 && showStarredOnly
                ? "즐겨찾기 목록에서 기록을 선택하세요."
                : "왼쪽에서 기록을 선택하세요."}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
