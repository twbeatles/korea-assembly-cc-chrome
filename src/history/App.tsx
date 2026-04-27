import { useEffect, useMemo, useRef, useState } from "react";

import { createTab, sendRuntimeMessage } from "../shared/chrome-api";
import { buildCopyText, copyTextToClipboard, filterEntriesByQuery } from "../shared/copy-utils";
import {
  resolveSessionLineageId,
  resolveSessionSegmentNumber,
  type ExportFormat,
  type SessionRecord,
} from "../core/subtitle-models";
import {
  isSegmentedSessionRecord,
  mergeSessionSegments,
} from "../core/session-lineage";
import {
  DEFAULT_EXTENSION_SETTINGS,
  EXTENSION_STORAGE_KEY,
  SESSION_LIBRARY_REVISION_STORAGE_KEY,
  isSupportedAssemblyUrl,
} from "../shared/constants";
import { mapDownloadErrorMessage, resolveDownloadErrorMessage } from "../shared/download-errors";
import {
  assertSessionLibraryTransferSizeWithinLimit,
  getUtf8ByteLength,
  parseSessionImportPayload,
} from "../storage/session-backup";
import {
  buildSessionLibraryBackupExport,
  deleteAllSessions,
  deleteSession,
  getSessionLibraryOverview,
  importSessionRecords,
  listSessionLineageSegments,
  listSessionsPage,
  loadSession,
  loadSessionsByIds,
  updateSessionMetadata,
} from "../storage/session-store";
import type {
  SessionImportSummary,
  SessionLibraryPreview,
  SessionLongTaskKind,
  SessionLongTaskProgress,
} from "../storage/types";
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
import { readBlobTextWithProgress } from "./blob-read";
import { downloadPageBlobExport } from "./page-blob-download";

const EXPORT_FORMATS: ExportFormat[] = ["txt", "srt", "vtt", "json"];
const HISTORY_PAGE_SIZE = 200;

type HistoryLongTaskState = SessionLongTaskProgress & {
  cancellable: boolean;
  cancelRequested: boolean;
};

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function isSessionImportSummary(value: unknown): value is SessionImportSummary {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<SessionImportSummary>;
  return (
    typeof candidate.addedCount === "number" &&
    typeof candidate.updatedCount === "number" &&
    typeof candidate.keptCount === "number" &&
    typeof candidate.failedCount === "number"
  );
}

function extractCancelledImportSummary(error: unknown): SessionImportSummary | null {
  if (!error || typeof error !== "object" || !("summary" in error)) {
    return null;
  }

  return isSessionImportSummary(error.summary) ? error.summary : null;
}

function getLongTaskPhaseLabel(phase: string): string {
  switch (phase) {
    case "read":
      return "파일 읽기";
    case "parse":
      return "JSON 파싱";
    case "sanitize":
      return "기록 정리";
    case "compare":
      return "기존 기록 비교";
    case "write":
      return "기록 저장";
    case "prepare":
      return "준비";
    case "collect":
      return "기록 수집";
    case "package":
      return "백업 파일 생성";
    case "download":
      return "다운로드 준비";
    default:
      return phase;
  }
}

function formatDate(value: string | null): string {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString("ko-KR");
}

function getSessionSegmentLabel(
  session: Pick<SessionRecord, "segmentNumber">,
): string {
  return `세그먼트 ${resolveSessionSegmentNumber(session.segmentNumber)}`;
}

function canReopenSourceUrl(sourceUrl: string | null | undefined): sourceUrl is string {
  return typeof sourceUrl === "string" && isSupportedAssemblyUrl(sourceUrl);
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
  const longTaskAbortControllerRef = useRef<AbortController | null>(null);
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
  const [lineageSessions, setLineageSessions] = useState<SessionRecord[]>([]);
  const [lineageLoading, setLineageLoading] = useState(false);
  const [lineageViewEnabled, setLineageViewEnabled] = useState(false);
  const [message, setMessage] = useState("기록을 불러오는 중입니다.");
  const [searchQuery, setSearchQuery] = useState("");
  const [showStarredOnly, setShowStarredOnly] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [sessionPage, setSessionPage] = useState(1);
  const [recentCopyLineCount, setRecentCopyLineCount] = useState(5);
  const [filenamePattern, setFilenamePattern] = useState(DEFAULT_EXTENSION_SETTINGS.filenamePattern);
  const [txtExportTimestampsEnabled, setTxtExportTimestampsEnabled] = useState(
    DEFAULT_EXTENSION_SETTINGS.txtExportTimestampsEnabled,
  );
  const [reloadKey, setReloadKey] = useState(0);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [longTask, setLongTask] = useState<HistoryLongTaskState | null>(null);

  const selectedLineageId = selectedSession
    ? resolveSessionLineageId(selectedSession.id, selectedSession.lineageId)
    : "";
  const availableLineageSessions = useMemo(
    () =>
      selectedSession
        ? lineageSessions.length
          ? lineageSessions
          : [selectedSession]
        : [],
    [lineageSessions, selectedSession],
  );
  const hasLineageSegments = availableLineageSessions.length > 1;
  const lineageAggregateSession = useMemo(
    () =>
      hasLineageSegments ? mergeSessionSegments(availableLineageSessions) : null,
    [availableLineageSessions, hasLineageSegments],
  );
  const displaySession =
    lineageViewEnabled && lineageAggregateSession ? lineageAggregateSession : selectedSession;
  const filteredEntries = useMemo(
    () => filterEntriesByQuery(displaySession?.entries ?? [], searchQuery),
    [displaySession, searchQuery],
  );
  const checkedIdSet = useMemo(() => new Set(checkedIds), [checkedIds]);
  const checkedEntryIdSet = useMemo(() => new Set(checkedEntryIds), [checkedEntryIds]);
  const pageCount = Math.max(1, Math.ceil(totalSessionCount / HISTORY_PAGE_SIZE));
  const selectedEntries = useMemo(
    () => displaySession?.entries.filter((entry) => checkedEntryIdSet.has(entry.id)) ?? [],
    [checkedEntryIdSet, displaySession],
  );
  const currentPageSessionsChecked =
    pageSessions.length > 0 && pageSessions.every((session) => checkedIdSet.has(session.id));
  const allVisibleEntriesChecked =
    filteredEntries.length > 0 &&
    filteredEntries.every((entry) => checkedEntryIdSet.has(entry.id));
  const hasUnsavedNote =
    selectedSession ? noteDraft !== selectedSession.note : noteDraft.trim().length > 0;
  const actionButtonsDisabled = busyAction !== null;
  const jsonTaskButtonsDisabled = busyAction !== null || longTask !== null;
  const heroMessage = longTask?.message ?? message;
  const longTaskProgressLabel =
    longTask && longTask.total > 0
      ? `${Math.min(longTask.completed, longTask.total)} / ${longTask.total}`
      : null;
  const showingLineageView = lineageViewEnabled && hasLineageSegments && !!lineageAggregateSession;
  const shouldShowSelectedSegmentLabel =
    !!selectedSession && (hasLineageSegments || isSegmentedSessionRecord(selectedSession));

  const runBusyHistoryAction = (
    actionLabel: string,
    action: () => Promise<void>,
    fallbackMessage: string,
    pendingMessage?: string,
  ): void => {
    if (busyAction) {
      return;
    }

    setBusyAction(actionLabel);
    if (pendingMessage) {
      setMessage(pendingMessage);
    }

    void action()
      .catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : fallbackMessage);
      })
      .finally(() => {
        setBusyAction((current) => (current === actionLabel ? null : current));
      });
  };

  const updateLongTaskProgress = (progress: SessionLongTaskProgress): void => {
    setLongTask((current) =>
      current && current.kind === progress.kind
        ? {
            ...current,
            ...progress,
          }
        : {
            ...progress,
            cancellable: true,
            cancelRequested: false,
          },
    );
  };

  const clearLongTaskState = (
    kind: SessionLongTaskKind,
    controller: AbortController,
  ): void => {
    if (longTaskAbortControllerRef.current === controller) {
      longTaskAbortControllerRef.current = null;
    }

    setLongTask((current) => (current?.kind === kind ? null : current));
  };

  const handleCancelLongTask = (): void => {
    const controller = longTaskAbortControllerRef.current;
    if (!controller || !longTask || longTask.cancelRequested) {
      return;
    }

    setLongTask((current) =>
      current
        ? {
            ...current,
            cancelRequested: true,
          }
        : current,
    );
    controller.abort();
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

  const discardUnsavedNoteDraft = (): void => {
    setNoteDraft(selectedSession?.note ?? "");
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
    previousSelectedSessionRef.current = selectedSession;
  }, [selectedSession]);

  useEffect(() => {
    let active = true;

    if (!selectedSession) {
      setLineageSessions([]);
      setLineageLoading(false);
      setLineageViewEnabled(false);
      return () => {
        active = false;
      };
    }

    setLineageSessions([selectedSession]);
    setLineageLoading(true);
    void listSessionLineageSegments(resolveSessionLineageId(selectedSession.id, selectedSession.lineageId))
      .then((sessions) => {
        if (!active) {
          return;
        }

        setLineageSessions(sessions.length ? sessions : [selectedSession]);
      })
      .catch(() => {
        if (!active) {
          return;
        }

        setLineageSessions([selectedSession]);
      })
      .finally(() => {
        if (active) {
          setLineageLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [selectedSession]);

  useEffect(() => {
    if (!lineageLoading && availableLineageSessions.length <= 1) {
      setLineageViewEnabled(false);
    }
  }, [availableLineageSessions.length, lineageLoading]);

  useEffect(() => {
    setCheckedEntryIds((current) =>
      resolveSelectedEntryIds(current, displaySession?.entries ?? []),
    );
  }, [displaySession]);

  useEffect(
    () => () => {
      longTaskAbortControllerRef.current?.abort();
      longTaskAbortControllerRef.current = null;
    },
    [],
  );

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
        setTxtExportTimestampsEnabled(nextSettings.txtExportTimestampsEnabled);
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
        setTxtExportTimestampsEnabled(nextSettings.txtExportTimestampsEnabled);
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

    if (hasUnsavedNote) {
      discardUnsavedNoteDraft();
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
      await updateSessionMetadata(session.id, {
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
      await updateSessionMetadata(selectedSession.id, {
        note: noteDraft,
      });
      requestRefresh(noteDraft.trim() ? "메모를 저장했습니다." : "메모를 비웠습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "메모 저장에 실패했습니다.");
    }
  };

  const handleReopen = async (): Promise<void> => {
    if (!canReopenSourceUrl(selectedSession?.sourceUrl)) {
      setMessage("지원되는 원본 의사중계 URL이 없습니다.");
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
    if (!selectedSession || !displaySession) {
      return;
    }

    try {
      const response = showingLineageView
        ? await sendRuntimeMessage({
            type: "DOWNLOAD_SESSION_LINEAGE_EXPORT",
            lineageId: selectedLineageId,
            format,
            filenamePattern,
            txtExportTimestampsEnabled,
            entryIds: entries?.map((entry) => entry.id),
          })
        : await sendRuntimeMessage({
            type: "DOWNLOAD_SESSION_EXPORT",
            sessionId: selectedSession.id,
            format,
            filenamePattern,
            txtExportTimestampsEnabled,
            entryIds: entries?.map((entry) => entry.id),
          });
      if (!response.ok) {
        setMessage(
          mapDownloadErrorMessage(response.error) || "파일 저장을 시작하지 못했습니다.",
        );
        return;
      }

      if (entries?.length) {
        setMessage(
          `${
            showingLineageView ? "연속 캡처 전체에서 " : ""
          }선택한 ${entries.length}줄 ${getExportFormatLabel(format)} 저장을 시작했습니다.`,
        );
        return;
      }

      setMessage(
        showingLineageView
          ? `연속 캡처 전체 ${getExportFormatLabel(format)} 저장을 시작했습니다.`
          : `${getExportFormatLabel(format)} 파일 저장을 시작했습니다.`,
      );
    } catch (error) {
      setMessage(resolveDownloadErrorMessage(error, "파일 저장을 시작하지 못했습니다."));
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

  const handleSelectLineageSegment = (sessionId: string): void => {
    if (sessionId !== selectedSession?.id && hasUnsavedNote && !confirmDiscardUnsavedNote("세그먼트 전환")) {
      setMessage("세그먼트 전환을 취소했습니다.");
      return;
    }

    const nextSelectedSession =
      availableLineageSessions.find((session) => session.id === sessionId) ?? null;
    if (!nextSelectedSession) {
      return;
    }

    setSelectedId(sessionId);
    setSelectedSession(nextSelectedSession);
  };

  const handleToggleEntryChecked = (entryId: string): void => {
    setCheckedEntryIds((current) => toggleSelectedEntryId(current, entryId));
  };

  const handleBackupAll = async (): Promise<void> => {
    if (jsonTaskButtonsDisabled) {
      return;
    }

    const controller = new AbortController();
    longTaskAbortControllerRef.current = controller;
    setLongTask({
      kind: "backup",
      phase: "prepare",
      completed: 0,
      total: 0,
      message: "전체 JSON 백업을 준비하고 있습니다.",
      cancellable: true,
      cancelRequested: false,
    });

    try {
      const backupExport = await buildSessionLibraryBackupExport({
        signal: controller.signal,
        onProgress: updateLongTaskProgress,
      });
      if (!backupExport.sessionCount) {
        setMessage("백업할 기록이 없습니다.");
        return;
      }

      updateLongTaskProgress({
        kind: "backup",
        phase: "download",
        completed: backupExport.sessionCount,
        total: backupExport.sessionCount,
        message: `전체 JSON 백업 다운로드를 준비하고 있습니다. (${backupExport.sessionCount} / ${backupExport.sessionCount})`,
      });
      if (controller.signal.aborted) {
        setMessage("전체 JSON 백업을 취소했습니다.");
        return;
      }

      await downloadPageBlobExport(backupExport.payload);

      setMessage(`저장된 기록 ${backupExport.sessionCount}건의 JSON 백업을 시작했습니다.`);
    } catch (error) {
      if (isAbortError(error)) {
        setMessage("전체 JSON 백업을 취소했습니다.");
        return;
      }

      setMessage(resolveDownloadErrorMessage(error, "전체 JSON 백업에 실패했습니다."));
    } finally {
      clearLongTaskState("backup", controller);
    }
  };

  const handleImportClick = (): void => {
    if (jsonTaskButtonsDisabled) {
      return;
    }

    importInputRef.current?.click();
  };

  const handleImportChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || jsonTaskButtonsDisabled) {
      return;
    }

    const controller = new AbortController();
    longTaskAbortControllerRef.current = controller;
    setLongTask({
      kind: "import",
      phase: "read",
      completed: 0,
      total: 0,
      message: "JSON 파일을 읽고 있습니다.",
      cancellable: true,
      cancelRequested: false,
    });
    let invalidCount = 0;

    try {
      assertSessionLibraryTransferSizeWithinLimit(file.size, "JSON 가져오기");
      const fileText = await readBlobTextWithProgress(file, {
        signal: controller.signal,
        onProgress: ({ completed, total }) => {
          updateLongTaskProgress({
            kind: "import",
            phase: "read",
            completed,
            total,
            message: total
              ? `JSON 파일을 읽고 있습니다. (${completed} / ${total})`
              : "JSON 파일을 읽고 있습니다.",
          });
        },
      });
      assertSessionLibraryTransferSizeWithinLimit(getUtf8ByteLength(fileText), "JSON 가져오기");

      updateLongTaskProgress({
        kind: "import",
        phase: "parse",
        completed: 0,
        total: 0,
        message: "JSON 내용을 해석하고 있습니다.",
      });
      const parsed = JSON.parse(fileText) as unknown;
      if (controller.signal.aborted) {
        setMessage("JSON 가져오기를 취소했습니다.");
        return;
      }

      updateLongTaskProgress({
        kind: "import",
        phase: "sanitize",
        completed: 0,
        total: 0,
        message: "가져올 기록을 정리하고 있습니다.",
      });
      const importPayload = parseSessionImportPayload(parsed);
      invalidCount = importPayload.invalidCount;
      if (!importPayload.records.length && importPayload.invalidCount === 0) {
        setMessage("가져올 기록이 없습니다.");
        return;
      }

      const summary = await importSessionRecords(importPayload.records, {
        signal: controller.signal,
        onProgress: updateLongTaskProgress,
      });
      requestRefresh(
        buildSessionImportMessage({
          ...summary,
          invalidCount: importPayload.invalidCount,
        }),
      );
    } catch (error) {
      if (isAbortError(error)) {
        const cancelledSummary = extractCancelledImportSummary(error);
        const cancelledSummaryData = cancelledSummary ?? {
          addedCount: 0,
          updatedCount: 0,
          keptCount: 0,
          failedCount: 0,
        };
        const hasMeaningfulCancelledSummary =
          cancelledSummaryData.addedCount > 0 ||
          cancelledSummaryData.updatedCount > 0 ||
          cancelledSummaryData.keptCount > 0 ||
          cancelledSummaryData.failedCount > 0 ||
          invalidCount > 0;

        if (!hasMeaningfulCancelledSummary) {
          setMessage("JSON 가져오기를 취소했습니다.");
          return;
        }

        const cancelledMessage = buildSessionImportMessage({
          ...cancelledSummaryData,
          invalidCount,
          cancelled: true,
        });

        if (cancelledSummaryData.addedCount > 0 || cancelledSummaryData.updatedCount > 0) {
          requestRefresh(cancelledMessage);
        } else {
          setMessage(cancelledMessage);
        }
        return;
      }

      setMessage(error instanceof Error ? error.message : "JSON 가져오기에 실패했습니다.");
    } finally {
      clearLongTaskState("import", controller);
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
            onClick={() =>
              runBusyHistoryAction(
                "refresh",
                handleRefreshClick,
                "기록 목록을 다시 읽지 못했습니다.",
                "기록 목록을 다시 불러오고 있습니다.",
              )
            }
            disabled={actionButtonsDisabled}
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
              if (hasUnsavedNote) {
                discardUnsavedNoteDraft();
              }
              setShowStarredOnly((current) => !current);
            }}
            disabled={actionButtonsDisabled}
          >
            {showStarredOnly ? "전체 보기" : "즐겨찾기만 보기"}
          </button>
          <button
            className="secondary"
            onClick={() => void handleBackupAll()}
            disabled={jsonTaskButtonsDisabled}
          >
            전체 JSON 백업
          </button>
          <button
            className="secondary"
            onClick={handleImportClick}
            disabled={jsonTaskButtonsDisabled}
          >
            JSON 가져오기
          </button>
        </div>
        {heroMessage ? (
          <div className={`hero-status ${longTask ? "long-task-status" : ""}`}>
            <div className="hero-status-copy">
              <span>{heroMessage}</span>
              {longTask ? (
                <div className="hero-status-meta">
                  <span>단계: {getLongTaskPhaseLabel(longTask.phase)}</span>
                  {longTaskProgressLabel ? <span>진행: {longTaskProgressLabel}</span> : null}
                  {longTask.cancelRequested ? (
                    <span className="hero-status-cancel-note">취소 요청을 처리하고 있습니다.</span>
                  ) : null}
                </div>
              ) : null}
            </div>
            {longTask ? (
              <button
                className="secondary"
                onClick={handleCancelLongTask}
                disabled={!longTask.cancellable || longTask.cancelRequested}
              >
                {longTask.cancelRequested ? "취소 요청 중" : "취소"}
              </button>
            ) : null}
          </div>
        ) : null}
        <input
          ref={importInputRef}
          className="hidden-file-input"
          type="file"
          accept=".json,application/json"
          disabled={jsonTaskButtonsDisabled}
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
              <button
                className="secondary"
                onClick={handleToggleCheckAll}
                disabled={actionButtonsDisabled || !pageSessions.length}
              >
                {currentPageSessionsChecked ? "현재 페이지 선택 해제" : "현재 페이지 전체 선택"}
              </button>
              <button
                className="secondary"
                onClick={() =>
                  runBusyHistoryAction(
                    "delete_checked",
                    handleDeleteChecked,
                    "선택 삭제에 실패했습니다.",
                    "선택한 기록을 삭제하고 있습니다.",
                  )
                }
                disabled={actionButtonsDisabled || !checkedIds.length}
              >
                선택 삭제
              </button>
              <button
                className="secondary"
                onClick={() =>
                  runBusyHistoryAction(
                    "delete_all",
                    handleDeleteAll,
                    "전체 삭제에 실패했습니다.",
                    "저장된 기록 전체 삭제를 진행하고 있습니다.",
                  )
                }
                disabled={actionButtonsDisabled || !totalSessionCount}
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
                    disabled={actionButtonsDisabled}
                    aria-label={`${session.committeeName || session.title} 선택`}
                  />
                </label>
                <button
                  type="button"
                  className={`favorite-toggle ${session.starred ? "active" : ""}`}
                  onClick={() =>
                    runBusyHistoryAction(
                      `favorite_${session.id}`,
                      () => handleToggleFavorite(session),
                      "즐겨찾기 저장에 실패했습니다.",
                      session.starred
                        ? "즐겨찾기 해제를 저장하고 있습니다."
                        : "즐겨찾기를 저장하고 있습니다.",
                    )
                  }
                  disabled={actionButtonsDisabled}
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
                  disabled={actionButtonsDisabled}
                >
                  <div className="session-item-heading">
                    <strong>{session.committeeName || session.title}</strong>
                    {isSegmentedSessionRecord(session) ? (
                      <span className="segment-badge">{getSessionSegmentLabel(session)}</span>
                    ) : null}
                  </div>
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
                disabled={actionButtonsDisabled || sessionPage <= 1}
              >
                이전 페이지
              </button>
              <span>
                {sessionPage} / {pageCount}
              </span>
              <button
                className="secondary"
                onClick={() => setSessionPage((current) => Math.min(pageCount, current + 1))}
                disabled={actionButtonsDisabled || sessionPage >= pageCount}
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
                  <div className="detail-title-row">
                    <h2>{selectedSession.committeeName || selectedSession.title}</h2>
                    {shouldShowSelectedSegmentLabel ? (
                      <span className="segment-badge detail-segment-badge">
                        {getSessionSegmentLabel(selectedSession)}
                      </span>
                    ) : null}
                  </div>
                  <p>{selectedSession.sourceUrl || "원본 URL 없음"}</p>
                </div>
                <div className="detail-actions">
                  <button
                    className="secondary"
                    onClick={() =>
                      runBusyHistoryAction(
                        `favorite_${selectedSession.id}`,
                        () => handleToggleFavorite(selectedSession),
                        "즐겨찾기 저장에 실패했습니다.",
                        selectedSession.starred
                          ? "즐겨찾기 해제를 저장하고 있습니다."
                          : "즐겨찾기를 저장하고 있습니다.",
                      )
                    }
                    disabled={actionButtonsDisabled}
                  >
                    {selectedSession.starred ? "즐겨찾기 해제" : "즐겨찾기 추가"}
                  </button>
                  <button
                    onClick={() =>
                      runBusyHistoryAction(
                        "reopen_source",
                        handleReopen,
                        "원본 페이지를 열지 못했습니다.",
                        "원본 의사중계 페이지를 열고 있습니다.",
                      )
                    }
                    disabled={actionButtonsDisabled || !canReopenSourceUrl(selectedSession.sourceUrl)}
                  >
                    원본 페이지 열기
                  </button>
                  <button
                    className="secondary"
                    onClick={() =>
                      runBusyHistoryAction(
                        "delete_single",
                        handleDelete,
                        "기록 삭제에 실패했습니다.",
                        "선택한 기록을 삭제하고 있습니다.",
                      )
                    }
                    disabled={actionButtonsDisabled}
                  >
                    삭제
                  </button>
                </div>
              </div>

              <dl className="stats-grid">
                <div>
                  <dt>시작</dt>
                  <dd>{formatDate(displaySession?.startedAt ?? selectedSession.startedAt)}</dd>
                </div>
                <div>
                  <dt>종료</dt>
                  <dd>{formatDate(displaySession?.endedAt ?? selectedSession.endedAt)}</dd>
                </div>
                <div>
                  <dt>자막 수</dt>
                  <dd>{displaySession?.subtitleCount ?? selectedSession.subtitleCount}</dd>
                </div>
                <div>
                  <dt>글자 수</dt>
                  <dd>{displaySession?.charCount ?? selectedSession.charCount}</dd>
                </div>
                <div>
                  <dt>연속 캡처</dt>
                  <dd>
                    {shouldShowSelectedSegmentLabel
                      ? getSessionSegmentLabel(selectedSession)
                      : "단일 세션"}
                  </dd>
                </div>
              </dl>

              {hasLineageSegments && lineageAggregateSession ? (
                <div className="lineage-card">
                  <div className="section-row">
                    <div>
                      <strong>연속 캡처 전체 보기</strong>
                      <p className="lineage-caption">
                        같은 캡처 lineage의 세그먼트 {availableLineageSessions.length}개를 하나로 볼 수 있습니다.
                      </p>
                    </div>
                    <button
                      className="secondary"
                      onClick={() => setLineageViewEnabled((current) => !current)}
                      disabled={actionButtonsDisabled || lineageLoading}
                    >
                      {showingLineageView ? "현재 세그먼트 보기" : "연속 캡처 전체 보기"}
                    </button>
                  </div>

                  <dl className="lineage-stats">
                    <div>
                      <dt>총 세그먼트</dt>
                      <dd>{availableLineageSessions.length}</dd>
                    </div>
                    <div>
                      <dt>전체 자막 수</dt>
                      <dd>{lineageAggregateSession.subtitleCount}</dd>
                    </div>
                    <div>
                      <dt>전체 글자 수</dt>
                      <dd>{lineageAggregateSession.charCount}</dd>
                    </div>
                    <div>
                      <dt>현재 보기</dt>
                      <dd>{showingLineageView ? "연속 캡처 전체" : getSessionSegmentLabel(selectedSession)}</dd>
                    </div>
                  </dl>

                  <div className="lineage-segments">
                    {availableLineageSessions.map((session) => (
                      <button
                        key={session.id}
                        className={`secondary lineage-segment-button ${
                          selectedSession.id === session.id ? "active-toggle" : ""
                        }`}
                        onClick={() => handleSelectLineageSegment(session.id)}
                        disabled={actionButtonsDisabled}
                      >
                        {getSessionSegmentLabel(session)}
                      </button>
                    ))}
                  </div>

                  <p className="lineage-caption">
                    아래 검색, 복사, 내보내기는 현재 보기 기준으로 동작합니다.
                  </p>
                </div>
              ) : null}

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
                    onClick={() =>
                      runBusyHistoryAction(
                        "save_note",
                        handleSaveNote,
                        "메모 저장에 실패했습니다.",
                        "메모를 저장하고 있습니다.",
                      )
                    }
                    disabled={actionButtonsDisabled || noteDraft === selectedSession.note}
                  >
                    메모 저장
                  </button>
                  <button
                    className="secondary"
                    onClick={() => setNoteDraft("")}
                    disabled={actionButtonsDisabled || !noteDraft}
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
                  placeholder={showingLineageView ? "연속 캡처 전체에서 내용 찾기" : "이 기록 안에서 내용 찾기"}
                />
                <span>
                  {filteredEntries.length} / {displaySession?.entries.length ?? 0}개
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
                    disabled={actionButtonsDisabled || !filteredEntries.length}
                  >
                    {allVisibleEntriesChecked ? "보이는 항목 선택 해제" : "보이는 항목 전체 선택"}
                  </button>
                  <button
                    className="secondary"
                    onClick={() => setCheckedEntryIds([])}
                    disabled={actionButtonsDisabled || !checkedEntryIds.length}
                  >
                    전체 선택 해제
                  </button>
                  <button
                    onClick={() =>
                      void handleCopy(
                        buildCopyText(displaySession?.entries ?? [], {
                          selectedIds: checkedEntryIds,
                        }),
                        `${showingLineageView ? "연속 캡처 전체에서 " : ""}선택한 ${selectedEntries.length}줄을 복사했습니다.`,
                      )
                    }
                    disabled={actionButtonsDisabled || !selectedEntries.length}
                  >
                    선택한 항목 복사
                  </button>
                </div>
              </div>

              <p className="section-heading">
                내보내기 {showingLineageView ? "(연속 캡처 전체)" : "(현재 세그먼트)"}
              </p>
              <div className="export-group">
                <div className="export-row">
                  {EXPORT_FORMATS.map((format) => (
                    <button
                      key={format}
                      onClick={() =>
                        runBusyHistoryAction(
                          `export_${format}`,
                          () => handleExport(format),
                          `${getExportFormatLabel(format)} 저장을 시작하지 못했습니다.`,
                          `${getExportFormatLabel(format)} 저장을 준비하고 있습니다.`,
                        )
                      }
                      disabled={actionButtonsDisabled}
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
                        runBusyHistoryAction(
                          `export_selected_${format}`,
                          () => handleExport(format, selectedEntries),
                          `선택 ${format.toUpperCase()} 저장을 시작하지 못했습니다.`,
                          `선택 ${format.toUpperCase()} 저장을 준비하고 있습니다.`,
                        )
                      }
                      disabled={actionButtonsDisabled || !selectedEntries.length}
                    >
                      선택 {format.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              <p className="section-heading">
                복사 {showingLineageView ? "(연속 캡처 전체)" : "(현재 세그먼트)"}
              </p>
              <div className="copy-row">
                <button
                  onClick={() =>
                    void handleCopy(
                      buildCopyText(displaySession?.entries ?? [], { limit: recentCopyLineCount }),
                      `${showingLineageView ? "연속 캡처 전체에서 " : ""}최근 ${recentCopyLineCount}줄을 복사했습니다.`,
                    )
                  }
                  disabled={actionButtonsDisabled || !(displaySession?.entries.length ?? 0)}
                >
                  최근 {recentCopyLineCount}줄 복사
                </button>
                <button
                  onClick={() =>
                    void handleCopy(
                      buildCopyText(displaySession?.entries ?? [], { query: searchQuery }),
                      "찾은 내용을 복사했습니다.",
                    )
                  }
                  disabled={actionButtonsDisabled || !filteredEntries.length}
                >
                  찾은 내용 복사
                </button>
                <button
                  className="secondary"
                  onClick={() =>
                    void handleCopy(
                      buildCopyText(displaySession?.entries ?? []),
                      showingLineageView ? "연속 캡처 전체 내용을 복사했습니다." : "전체 내용을 복사했습니다.",
                    )
                  }
                  disabled={actionButtonsDisabled || !(displaySession?.entries.length ?? 0)}
                >
                  전체 내용 복사
                </button>
              </div>

              <p className="section-heading">
                자막 항목 {filteredEntries.length} / {displaySession?.entries.length ?? 0}개
              </p>
              <div className="entries">
                {filteredEntries.length ? (
                  filteredEntries.map((entry) => (
                    <div key={entry.id} className="entry-card-row">
                      <label className="entry-check">
                        <input
                          type="checkbox"
                          checked={checkedEntryIdSet.has(entry.id)}
                          onChange={() => handleToggleEntryChecked(entry.id)}
                          disabled={actionButtonsDisabled}
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
