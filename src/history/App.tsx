import { useEffect, useMemo, useRef, useState } from "react";

import { createTab, sendRuntimeMessage } from "../shared/chrome-api";
import {
  buildCopyText,
  copyTextToClipboard,
  filterEntriesByQuery,
} from "../shared/copy-utils";
import type { ExportFormat, SessionRecord } from "../core/subtitle-models";
import {
  cloneEntry,
  createId,
  type SubtitleEntry,
} from "../core/subtitle-models";
import {
  DEFAULT_EXTENSION_SETTINGS,
  EXTENSION_STORAGE_KEY,
  SESSION_LIBRARY_REVISION_STORAGE_KEY,
  isSupportedAssemblyUrl,
} from "../shared/constants";
import {
  mapDownloadErrorMessage,
  resolveDownloadErrorMessage,
} from "../shared/download-errors";
import {
  assertSessionLibraryTransferSizeWithinLimit,
  parseSessionImportPayload,
} from "../storage/session-backup";
import {
  getUtf8ByteLength,
  SINGLE_SESSION_EXPORT_WARNING_BYTES,
} from "../shared/byte-size";
import {
  buildSessionLibraryBackupExport,
  deleteAllSessions,
  deleteSession,
  exportSessionData,
  filterSessionEntriesByTimeRange,
  getSessionLibraryOverview,
  importSessionRecords,
  listSessionsPage,
  loadSession,
  loadSessionsByIds,
  searchSessions,
  SESSION_NOTE_MAX_LENGTH,
  updateSessionContent,
  updateSessionMetadata,
} from "../storage/session-store";
import type {
  SessionImportSummary,
  SessionLibraryPreview,
  SessionLongTaskKind,
  SessionLongTaskProgress,
  SessionSearchResult,
  SessionExportOptions,
} from "../storage/types";
import { getSettings } from "../storage/settings-store";
import {
  getExportFormatLabel,
  getPersistedStatusLabel,
} from "../shared/ui-labels";
import {
  buildDeleteAllFailureMessage,
  buildDeleteAllSuccessMessage,
  buildHistoryRefreshMessage,
  buildSelectedDeleteMessage,
  buildSessionImportMessage,
  areEntryIdsContiguous,
  extractHistoryViewSettings,
  resolveSelectedEntryIds,
  selectAllEntryIds,
  selectAllSessionIds,
  selectHistoryViewSettings,
  toggleSelectedEntryId,
  toggleSelectedSessionId,
} from "./history-view-state";
import { readBlobTextWithProgress } from "./blob-read";

const EXPORT_FORMATS: ExportFormat[] = [
  "txt",
  "srt",
  "vtt",
  "json",
  "md",
  "csv",
];
const HISTORY_PAGE_SIZE = 200;

function parseTagInput(value: string): string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
        .map((tag) => tag.slice(0, 80)),
    ),
  ].slice(0, 50);
}

function parseLabelInput(value: string): string[] {
  return parseTagInput(value).slice(0, 20);
}

function formatTagInput(tags: string[] | undefined): string {
  return (tags ?? []).join(", ");
}

function resolveSpeakerLabel(
  session: SessionRecord,
  entry: SubtitleEntry,
): string {
  if (entry.speakerLabel?.trim()) {
    return entry.speakerLabel.trim();
  }
  const channel = entry.speakerChannel ?? "unknown";
  const label = session.speakerLabels?.[channel]?.trim();
  if (label) {
    return label;
  }
  switch (channel) {
    case "primary":
      return "발언자 A";
    case "secondary":
      return "발언자 B";
    default:
      return "알 수 없음";
  }
}

function computeSplitTime(
  startMs: number,
  endMs: number,
  index: number,
  total: number,
): string {
  const span = Math.max(1, endMs - startMs);
  return new Date(startMs + Math.floor((span * index) / total)).toISOString();
}

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

function extractCancelledImportSummary(
  error: unknown,
): SessionImportSummary | null {
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

function canReopenSourceUrl(
  sourceUrl: string | null | undefined,
): sourceUrl is string {
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

  return window.confirm(
    `저장하지 않은 메모가 있습니다. ${actionLabel} 전에 변경 내용을 버릴까요?`,
  );
}

export default function App() {
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const longTaskAbortControllerRef = useRef<AbortController | null>(null);
  const refreshMessageRef = useRef<string | undefined>(undefined);
  const preserveMessageOnRefreshRef = useRef(false);
  const selectedIdRef = useRef("");
  const checkedIdsRef = useRef<string[]>([]);
  const noteDraftRef = useRef("");
  const tagDraftRef = useRef("");
  const categoryDraftRef = useRef("");
  const previousSelectedSessionRef = useRef<SessionRecord | null>(null);
  const [pageSessions, setPageSessions] = useState<SessionRecord[]>([]);
  const [totalSessionCount, setTotalSessionCount] = useState(0);
  const [selectedSession, setSelectedSession] = useState<SessionRecord | null>(
    null,
  );
  const [selectedId, setSelectedId] = useState<string>("");
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [checkedEntryIds, setCheckedEntryIds] = useState<string[]>([]);
  const [message, setMessage] = useState("기록을 불러오는 중입니다.");
  const [searchQuery, setSearchQuery] = useState("");
  const [globalSearchQuery, setGlobalSearchQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [showHighlightedOnly, setShowHighlightedOnly] = useState(false);
  const [showStarredOnly, setShowStarredOnly] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [categoryDraft, setCategoryDraft] = useState("");
  const [speakerPrimaryDraft, setSpeakerPrimaryDraft] = useState("");
  const [speakerSecondaryDraft, setSpeakerSecondaryDraft] = useState("");
  const [speakerUnknownDraft, setSpeakerUnknownDraft] = useState("");
  const [editingEntryId, setEditingEntryId] = useState("");
  const [editingEntryText, setEditingEntryText] = useState("");
  const [editingEntrySpeakerLabel, setEditingEntrySpeakerLabel] = useState("");
  const [editingEntryNote, setEditingEntryNote] = useState("");
  const [editingEntryLabels, setEditingEntryLabels] = useState("");
  const [splitEntryId, setSplitEntryId] = useState("");
  const [splitDraft, setSplitDraft] = useState("");
  const [timeRangeFrom, setTimeRangeFrom] = useState("");
  const [timeRangeTo, setTimeRangeTo] = useState("");
  const [sessionPage, setSessionPage] = useState(1);
  const [recentCopyLineCount, setRecentCopyLineCount] = useState(5);
  const [filenamePattern, setFilenamePattern] = useState(
    DEFAULT_EXTENSION_SETTINGS.filenamePattern,
  );
  const [txtExportTimestampsEnabled, setTxtExportTimestampsEnabled] = useState(
    DEFAULT_EXTENSION_SETTINGS.txtExportTimestampsEnabled,
  );
  const [txtExportSpeakerEnabled, setTxtExportSpeakerEnabled] = useState(
    DEFAULT_EXTENSION_SETTINGS.txtExportSpeakerEnabled,
  );
  const [txtExportEntryNotesEnabled, setTxtExportEntryNotesEnabled] = useState(
    DEFAULT_EXTENSION_SETTINGS.txtExportEntryNotesEnabled,
  );
  const [reloadKey, setReloadKey] = useState(0);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [longTask, setLongTask] = useState<HistoryLongTaskState | null>(null);
  const [searchResultMap, setSearchResultMap] = useState<
    Map<string, SessionSearchResult>
  >(() => new Map());

  const filteredEntries = useMemo(() => {
    const baseEntries = showHighlightedOnly
      ? (selectedSession?.entries ?? []).filter((entry) => entry.highlighted)
      : (selectedSession?.entries ?? []);
    return filterEntriesByQuery(baseEntries, searchQuery);
  }, [searchQuery, selectedSession, showHighlightedOnly]);
  const checkedIdSet = useMemo(() => new Set(checkedIds), [checkedIds]);
  const checkedEntryIdSet = useMemo(
    () => new Set(checkedEntryIds),
    [checkedEntryIds],
  );
  const pageCount = Math.max(
    1,
    Math.ceil(totalSessionCount / HISTORY_PAGE_SIZE),
  );
  const selectedEntries = useMemo(
    () =>
      selectedSession?.entries.filter((entry) =>
        checkedEntryIdSet.has(entry.id),
      ) ?? [],
    [checkedEntryIdSet, selectedSession],
  );
  const currentPageSessionsChecked =
    pageSessions.length > 0 &&
    pageSessions.every((session) => checkedIdSet.has(session.id));
  const allVisibleEntriesChecked =
    filteredEntries.length > 0 &&
    filteredEntries.every((entry) => checkedEntryIdSet.has(entry.id));
  const hasUnsavedNote = selectedSession
    ? noteDraft !== selectedSession.note
    : noteDraft.trim().length > 0;
  const hasUnsavedMetadata = selectedSession
    ? tagDraft !== formatTagInput(selectedSession.tags) ||
      categoryDraft !== (selectedSession.category ?? "") ||
      speakerPrimaryDraft !== (selectedSession.speakerLabels?.primary ?? "") ||
      speakerSecondaryDraft !==
        (selectedSession.speakerLabels?.secondary ?? "") ||
      speakerUnknownDraft !== (selectedSession.speakerLabels?.unknown ?? "")
    : false;
  const hasUnsavedSessionDraft = hasUnsavedNote || hasUnsavedMetadata;
  const searchModeActive =
    Boolean(globalSearchQuery.trim()) ||
    Boolean(tagFilter.trim()) ||
    Boolean(categoryFilter.trim()) ||
    showHighlightedOnly;
  const actionButtonsDisabled = busyAction !== null;
  const jsonTaskButtonsDisabled = busyAction !== null || longTask !== null;
  const heroMessage = longTask?.message ?? message;
  const longTaskProgressLabel =
    longTask && longTask.total > 0
      ? `${Math.min(longTask.completed, longTask.total)} / ${longTask.total}`
      : null;
  const highlightedEntries = useMemo(
    () => selectedSession?.entries.filter((entry) => entry.highlighted) ?? [],
    [selectedSession],
  );
  const selectedEstimatedBytes = useMemo(
    () =>
      getUtf8ByteLength(
        (selectedSession?.entries ?? []).map((entry) => entry.text).join("\n"),
      ),
    [selectedSession],
  );
  const timeRange = useMemo<NonNullable<SessionExportOptions["timeRange"]>>(
    () => ({
      from: timeRangeFrom.trim() || undefined,
      to: timeRangeTo.trim() || undefined,
    }),
    [timeRangeFrom, timeRangeTo],
  );
  const timeRangeEntries = useMemo(
    () =>
      selectedSession
        ? (filterSessionEntriesByTimeRange(
            selectedSession.entries,
            timeRange,
          ) ?? [])
        : [],
    [selectedSession, timeRange],
  );
  const timeRangeActive = Boolean(timeRange.from || timeRange.to);

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
    setTagDraft(formatTagInput(selectedSession?.tags));
    setCategoryDraft(selectedSession?.category ?? "");
    setSpeakerPrimaryDraft(selectedSession?.speakerLabels?.primary ?? "");
    setSpeakerSecondaryDraft(selectedSession?.speakerLabels?.secondary ?? "");
    setSpeakerUnknownDraft(selectedSession?.speakerLabels?.unknown ?? "");
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
    tagDraftRef.current = tagDraft;
  }, [tagDraft]);

  useEffect(() => {
    categoryDraftRef.current = categoryDraft;
  }, [categoryDraft]);

  useEffect(() => {
    if (!hasUnsavedSessionDraft) {
      return;
    }

    const handler = (event: BeforeUnloadEvent): void => {
      // Modern browsers ignore the message text but still show their own
      // confirmation when `returnValue` is set. The guard only fires while a
      // dirty draft is present so navigation/reload during normal browsing is
      // unaffected.
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handler);
    return () => {
      window.removeEventListener("beforeunload", handler);
    };
  }, [hasUnsavedSessionDraft]);

  useEffect(() => {
    const previousSelectedSession = previousSelectedSessionRef.current;
    const selectedSessionIdChanged =
      previousSelectedSession?.id !== selectedSession?.id;

    if (selectedSessionIdChanged) {
      setNoteDraft(selectedSession?.note ?? "");
      setTagDraft(formatTagInput(selectedSession?.tags));
      setCategoryDraft(selectedSession?.category ?? "");
      setSpeakerPrimaryDraft(selectedSession?.speakerLabels?.primary ?? "");
      setSpeakerSecondaryDraft(selectedSession?.speakerLabels?.secondary ?? "");
      setSpeakerUnknownDraft(selectedSession?.speakerLabels?.unknown ?? "");
      setEditingEntryId("");
      setEditingEntryText("");
      setEditingEntrySpeakerLabel("");
      setEditingEntryNote("");
      setEditingEntryLabels("");
      setSplitEntryId("");
      setSplitDraft("");
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

  useEffect(
    () => () => {
      longTaskAbortControllerRef.current?.abort();
      longTaskAbortControllerRef.current = null;
    },
    [],
  );

  useEffect(() => {
    setSessionPage(1);
  }, [
    globalSearchQuery,
    tagFilter,
    categoryFilter,
    showHighlightedOnly,
    showStarredOnly,
  ]);

  useEffect(() => {
    let active = true;
    const messageOnSuccess = refreshMessageRef.current;
    const preserveMessage = preserveMessageOnRefreshRef.current;
    refreshMessageRef.current = undefined;
    preserveMessageOnRefreshRef.current = false;

    void (async () => {
      try {
        const pageResult = searchModeActive
          ? await searchSessions({
              query: globalSearchQuery,
              tag: tagFilter,
              category: categoryFilter,
              highlightedOnly: showHighlightedOnly,
              page: sessionPage,
              pageSize: HISTORY_PAGE_SIZE,
              starredOnly: showStarredOnly,
            })
          : await listSessionsPage({
              page: sessionPage,
              pageSize: HISTORY_PAGE_SIZE,
              starredOnly: showStarredOnly,
            });
        if (!active) {
          return;
        }

        const nextSearchResults =
          "results" in pageResult ? pageResult.results : [];
        const nextPageSessions =
          "results" in pageResult
            ? nextSearchResults.map((result) => result.session)
            : pageResult.sessions;
        setPageSessions(nextPageSessions);
        setSearchResultMap(
          nextSearchResults.length
            ? new Map(
                nextSearchResults.map((result) => [result.session.id, result]),
              )
            : new Map(),
        );
        setTotalSessionCount(pageResult.totalCount);
        if (pageResult.page !== sessionPage) {
          setSessionPage(pageResult.page);
        }

        if (checkedIdsRef.current.length > 0) {
          const existingCheckedSessions = await loadSessionsByIds(
            checkedIdsRef.current,
          );
          if (!active) {
            return;
          }
          setCheckedIds(existingCheckedSessions.map((session) => session.id));
        }

        let nextSelectedId =
          selectedIdRef.current || nextPageSessions[0]?.id || "";
        let nextSelectedSession =
          nextPageSessions.find((session) => session.id === nextSelectedId) ??
          null;

        if (!nextSelectedSession && nextSelectedId) {
          const loadedSelectedSession = await loadSession(nextSelectedId);
          if (!active) {
            return;
          }
          if (
            loadedSelectedSession &&
            (!showStarredOnly || loadedSelectedSession.starred)
          ) {
            nextSelectedSession = loadedSelectedSession;
          }
        }

        if (!nextSelectedSession && nextPageSessions.length > 0) {
          nextSelectedSession = nextPageSessions[0];
          nextSelectedId = nextSelectedSession.id;
        }

        if (!nextSelectedSession) {
          nextSelectedId = "";
        }

        setSelectedId(nextSelectedId);
        setSelectedSession(nextSelectedSession);

        if (!preserveMessage) {
          setMessage(
            messageOnSuccess ??
              buildHistoryRefreshMessage(pageResult.totalCount),
          );
        }
      } catch (error: unknown) {
        if (!active) {
          return;
        }
        setMessage(
          error instanceof Error
            ? error.message
            : "기록 목록을 읽지 못했습니다.",
        );
      }
    })();

    return () => {
      active = false;
    };
  }, [
    reloadKey,
    sessionPage,
    showStarredOnly,
    searchModeActive,
    globalSearchQuery,
    tagFilter,
    categoryFilter,
    showHighlightedOnly,
  ]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (!hasUnsavedSessionDraft) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedSessionDraft]);

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
        setTxtExportSpeakerEnabled(nextSettings.txtExportSpeakerEnabled);
        setTxtExportEntryNotesEnabled(nextSettings.txtExportEntryNotesEnabled);
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
        const nextSettings = extractHistoryViewSettings(
          changes[EXTENSION_STORAGE_KEY].newValue,
        );
        setRecentCopyLineCount(nextSettings.recentCopyLineCount);
        setFilenamePattern(nextSettings.filenamePattern);
        setTxtExportTimestampsEnabled(nextSettings.txtExportTimestampsEnabled);
        setTxtExportSpeakerEnabled(nextSettings.txtExportSpeakerEnabled);
        setTxtExportEntryNotesEnabled(nextSettings.txtExportEntryNotesEnabled);
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
    if (hasUnsavedSessionDraft && !confirmDiscardUnsavedNote("목록 새로고침")) {
      setMessage("새로고침을 취소했습니다.");
      return;
    }

    if (hasUnsavedSessionDraft) {
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
      setMessage(
        error instanceof Error ? error.message : "기록 삭제에 실패했습니다.",
      );
    }
  };

  const deleteSessionIds = async (
    ids: string[],
  ): Promise<{
    deletedCount: number;
    failedCount: number;
  }> => {
    const results = await Promise.allSettled(
      ids.map((id) => deleteSession(id)),
    );
    return results.reduce(
      (summary, result) => ({
        deletedCount:
          summary.deletedCount + (result.status === "fulfilled" ? 1 : 0),
        failedCount:
          summary.failedCount + (result.status === "rejected" ? 1 : 0),
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
      const result = await deleteSessionIds(
        targetSessions.map((session) => session.id),
      );
      setCheckedIds([]);
      requestRefresh(
        buildSelectedDeleteMessage(
          targetSessions.length,
          result.deletedCount,
          result.failedCount,
        ),
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "선택 삭제에 실패했습니다.",
      );
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
        ? current.filter(
            (id) => !pageSessions.some((session) => session.id === id),
          )
        : [...new Set([...current, ...selectAllSessionIds(pageSessions)])],
    );
  };

  const handleToggleFavorite = async (
    session: SessionRecord,
  ): Promise<void> => {
    try {
      await updateSessionMetadata(session.id, {
        starred: !session.starred,
        pinnedAt: session.starred ? null : new Date().toISOString(),
      });
      requestRefresh(
        session.starred
          ? "즐겨찾기를 해제했습니다."
          : "즐겨찾기에 추가했습니다.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "즐겨찾기 저장에 실패했습니다.",
      );
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
      requestRefresh(
        noteDraft.trim() ? "메모를 저장했습니다." : "메모를 비웠습니다.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "메모 저장에 실패했습니다.",
      );
    }
  };

  const handleSaveSessionMetadata = async (): Promise<void> => {
    if (!selectedSession) {
      return;
    }

    try {
      await updateSessionMetadata(selectedSession.id, {
        note: noteDraft,
        tags: parseTagInput(tagDraft),
        category: categoryDraft.trim(),
        speakerLabels: {
          primary: speakerPrimaryDraft.trim(),
          secondary: speakerSecondaryDraft.trim(),
          unknown: speakerUnknownDraft.trim(),
        },
      });
      requestRefresh("세션 메타데이터를 저장했습니다.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "세션 메타데이터 저장에 실패했습니다.",
      );
    }
  };

  const persistSelectedEntries = async (
    entries: SubtitleEntry[],
    successMessage: string,
  ): Promise<void> => {
    if (!selectedSession) {
      return;
    }
    const updated = await updateSessionContent(selectedSession.id, { entries });
    setSelectedSession(updated);
    setCheckedEntryIds((current) =>
      resolveSelectedEntryIds(current, updated.entries),
    );
    requestRefresh(successMessage, { preserveMessage: false });
  };

  const handleToggleEntryHighlight = async (entryId: string): Promise<void> => {
    if (!selectedSession) {
      return;
    }
    await persistSelectedEntries(
      selectedSession.entries.map((entry) =>
        entry.id === entryId
          ? { ...cloneEntry(entry), highlighted: !entry.highlighted }
          : entry,
      ),
      "중요 표시를 저장했습니다.",
    );
  };

  const beginEditEntry = (entry: SubtitleEntry): void => {
    setEditingEntryId(entry.id);
    setEditingEntryText(entry.text);
    setEditingEntrySpeakerLabel(entry.speakerLabel ?? "");
    setEditingEntryNote(entry.entryNote ?? "");
    setEditingEntryLabels(formatTagInput(entry.labels));
  };

  const cancelEditEntry = (): void => {
    setEditingEntryId("");
    setEditingEntryText("");
    setEditingEntrySpeakerLabel("");
    setEditingEntryNote("");
    setEditingEntryLabels("");
  };

  const handleSaveEntryEdit = async (): Promise<void> => {
    if (!selectedSession || !editingEntryId) {
      return;
    }
    const text = editingEntryText.trim();
    if (!text) {
      setMessage("자막 내용은 비워둘 수 없습니다.");
      return;
    }
    await persistSelectedEntries(
      selectedSession.entries.map((entry) =>
        entry.id === editingEntryId
          ? {
              ...cloneEntry(entry),
              originalText: entry.originalText ?? entry.text,
              text,
              speakerLabel: editingEntrySpeakerLabel.trim() || undefined,
              entryNote: editingEntryNote.trim() || undefined,
              labels: parseLabelInput(editingEntryLabels),
            }
          : entry,
      ),
      "자막 수정 내용을 저장했습니다.",
    );
    cancelEditEntry();
  };

  const handleDeleteSelectedEntries = async (): Promise<void> => {
    if (!selectedSession || !selectedEntries.length) {
      return;
    }
    if (
      !window.confirm(`선택한 자막 ${selectedEntries.length}개를 삭제할까요?`)
    ) {
      setMessage("선택 항목 삭제를 취소했습니다.");
      return;
    }
    const selectedIdSet = new Set(selectedEntries.map((entry) => entry.id));
    await persistSelectedEntries(
      selectedSession.entries.filter((entry) => !selectedIdSet.has(entry.id)),
      `선택한 자막 ${selectedEntries.length}개를 삭제했습니다.`,
    );
  };

  const handleMergeSelectedEntries = async (): Promise<void> => {
    if (!selectedSession || selectedEntries.length < 2) {
      setMessage("병합할 자막을 2개 이상 선택하세요.");
      return;
    }
    if (
      !areEntryIdsContiguous(
        selectedSession.entries,
        selectedEntries.map((entry) => entry.id),
      )
    ) {
      setMessage("연속된 자막만 병합할 수 있습니다.");
      return;
    }
    const selectedIdSet = new Set(selectedEntries.map((entry) => entry.id));
    const orderedSelected = selectedSession.entries.filter((entry) =>
      selectedIdSet.has(entry.id),
    );
    const first = orderedSelected[0];
    const last = orderedSelected[orderedSelected.length - 1];
    const merged: SubtitleEntry = {
      ...cloneEntry(first),
      id: createId("subtitle"),
      text: orderedSelected.map((entry) => entry.text).join(" "),
      originalText: orderedSelected
        .map((entry) => entry.originalText ?? entry.text)
        .join("\n"),
      endTime: last.endTime,
      highlighted: orderedSelected.some((entry) => entry.highlighted),
      entryNote: orderedSelected
        .map((entry) => entry.entryNote)
        .filter(Boolean)
        .join("\n"),
      labels: [
        ...new Set(orderedSelected.flatMap((entry) => entry.labels ?? [])),
      ],
      sourceEntryIds: orderedSelected.flatMap(
        (entry) => entry.sourceEntryIds ?? [entry.id],
      ),
    };
    const nextEntries: SubtitleEntry[] = [];
    let inserted = false;
    selectedSession.entries.forEach((entry) => {
      if (!selectedIdSet.has(entry.id)) {
        nextEntries.push(entry);
        return;
      }
      if (!inserted) {
        nextEntries.push(merged);
        inserted = true;
      }
    });
    await persistSelectedEntries(
      nextEntries,
      `선택한 자막 ${orderedSelected.length}개를 병합했습니다.`,
    );
    setCheckedEntryIds([merged.id]);
  };

  const handleSplitSelectedEntry = async (): Promise<void> => {
    if (!selectedSession || selectedEntries.length !== 1) {
      setMessage("분할할 자막 1개를 선택하세요.");
      return;
    }
    const target = selectedEntries[0];
    setSplitEntryId(target.id);
    setSplitDraft(target.text);
    setMessage("분할할 위치마다 줄바꿈을 넣은 뒤 분할 저장을 누르세요.");
  };

  const handleCancelSplitEntry = (): void => {
    setSplitEntryId("");
    setSplitDraft("");
    setMessage("자막 분할을 취소했습니다.");
  };

  const handleSaveSplitEntry = async (): Promise<void> => {
    if (!selectedSession || !splitEntryId) {
      return;
    }
    const target = selectedSession.entries.find(
      (entry) => entry.id === splitEntryId,
    );
    if (!target) {
      setMessage("분할할 자막을 찾지 못했습니다.");
      return;
    }
    const parts = splitDraft
      .split(/\r?\n/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length < 2) {
      setMessage("두 줄 이상으로 입력해야 분할할 수 있습니다.");
      return;
    }
    const startMs = Date.parse(target.startTime || target.timestamp);
    const endMs = Date.parse(target.endTime || target.timestamp);
    const safeStart = Number.isFinite(startMs) ? startMs : Date.now();
    const safeEnd =
      Number.isFinite(endMs) && endMs > safeStart
        ? endMs
        : safeStart + parts.length * 1000;
    const splitEntries = parts.map((text, index) => ({
      ...cloneEntry(target),
      id: createId("subtitle"),
      text,
      originalText: target.originalText ?? target.text,
      startTime: computeSplitTime(safeStart, safeEnd, index, parts.length),
      timestamp: computeSplitTime(safeStart, safeEnd, index, parts.length),
      endTime: computeSplitTime(safeStart, safeEnd, index + 1, parts.length),
      sourceEntryIds: target.sourceEntryIds ?? [target.id],
    }));
    await persistSelectedEntries(
      selectedSession.entries.flatMap((entry) =>
        entry.id === target.id ? splitEntries : [entry],
      ),
      `자막 1개를 ${splitEntries.length}개로 분할했습니다.`,
    );
    setCheckedEntryIds(splitEntries.map((entry) => entry.id));
    setSplitEntryId("");
    setSplitDraft("");
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
      setMessage(
        error instanceof Error
          ? error.message
          : "원본 페이지를 열지 못했습니다.",
      );
    }
  };

  const handleExport = async (
    format: ExportFormat,
    entries?: SessionRecord["entries"],
    exportOptions: Pick<SessionExportOptions, "timeRange"> = {},
  ): Promise<void> => {
    if (!selectedSession) {
      return;
    }

    try {
      const payload = await exportSessionData(selectedSession, format, {
        entries,
        filenamePattern,
        txtExportTimestampsEnabled,
        txtExportSpeakerEnabled,
        txtExportEntryNotesEnabled,
        timeRange: exportOptions.timeRange,
      });
      const isPartialExport = Boolean(
        entries?.length || exportOptions.timeRange,
      );
      if (
        !isPartialExport &&
        getUtf8ByteLength(payload.content) >
          SINGLE_SESSION_EXPORT_WARNING_BYTES &&
        !window.confirm(
          `${payload.filename} 파일이 커서 브라우저 메시지 한계로 저장에 실패할 수 있습니다. 계속 시도할까요?\n\n실패하면 이 화면에서 필요한 항목만 체크한 뒤 선택 저장을 사용해 주세요.`,
        )
      ) {
        setMessage("파일 저장을 취소했습니다.");
        return;
      }
      const response = await sendRuntimeMessage({
        type: "DOWNLOAD_REQUEST",
        filename: payload.filename,
        content: payload.content,
        mimeType: payload.mimeType,
      });
      if (!response.ok) {
        setMessage(
          mapDownloadErrorMessage(
            response.error,
            isPartialExport ? "partial" : "single-session",
          ) || "파일 저장을 시작하지 못했습니다.",
        );
        return;
      }

      if (entries?.length) {
        setMessage(
          `선택한 ${entries.length}줄 ${getExportFormatLabel(format)} 저장을 시작했습니다.`,
        );
        return;
      }

      if (exportOptions.timeRange) {
        setMessage(
          `시간 범위 ${payload.format.toUpperCase()} 저장을 시작했습니다.`,
        );
        return;
      }

      setMessage(`${getExportFormatLabel(format)} 파일 저장을 시작했습니다.`);
    } catch (error) {
      setMessage(
        resolveDownloadErrorMessage(
          error,
          "파일 저장을 시작하지 못했습니다.",
          entries?.length ? "partial" : "single-session",
        ),
      );
    }
  };

  const handleCopy = async (text: string, label: string): Promise<void> => {
    try {
      await copyTextToClipboard(text);
      setMessage(label);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "텍스트 복사에 실패했습니다.",
      );
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
        current.filter(
          (id) => !filteredEntries.some((entry) => entry.id === id),
        ),
      );
      return;
    }

    handleSelectVisibleEntries();
  };

  const handleSelectSession = (sessionId: string): void => {
    if (
      sessionId !== selectedSession?.id &&
      hasUnsavedSessionDraft &&
      !confirmDiscardUnsavedNote("세션 전환")
    ) {
      setMessage("세션 전환을 취소했습니다.");
      return;
    }

    const nextSelectedSession =
      pageSessions.find((session) => session.id === sessionId) ?? null;
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

      const response = await sendRuntimeMessage({
        type: "DOWNLOAD_REQUEST",
        filename: backupExport.payload.filename,
        content: backupExport.payload.content,
        mimeType: backupExport.payload.mimeType,
      });
      if (!response.ok) {
        setMessage(
          mapDownloadErrorMessage(response.error, "library") ||
            "전체 JSON 백업에 실패했습니다.",
        );
        return;
      }

      setMessage(
        `저장된 기록 ${backupExport.sessionCount}건의 JSON 백업을 시작했습니다.`,
      );
    } catch (error) {
      if (isAbortError(error)) {
        setMessage("전체 JSON 백업을 취소했습니다.");
        return;
      }

      setMessage(
        resolveDownloadErrorMessage(
          error,
          "전체 JSON 백업에 실패했습니다.",
          "library",
        ),
      );
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
      assertSessionLibraryTransferSizeWithinLimit(
        getUtf8ByteLength(fileText),
        "JSON 가져오기",
      );

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

        if (
          cancelledSummaryData.addedCount > 0 ||
          cancelledSummaryData.updatedCount > 0
        ) {
          requestRefresh(cancelledMessage);
        } else {
          setMessage(cancelledMessage);
        }
        return;
      }

      setMessage(
        error instanceof Error
          ? error.message
          : "JSON 가져오기에 실패했습니다.",
      );
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
              if (
                hasUnsavedSessionDraft &&
                !confirmDiscardUnsavedNote("필터 변경")
              ) {
                setMessage("필터 변경을 취소했습니다.");
                return;
              }
              if (hasUnsavedSessionDraft) {
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
                  {longTaskProgressLabel ? (
                    <span>진행: {longTaskProgressLabel}</span>
                  ) : null}
                  {longTask.cancelRequested ? (
                    <span className="hero-status-cancel-note">
                      취소 요청을 처리하고 있습니다.
                    </span>
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
        <div className="search-row">
          <input
            className="search-input"
            type="search"
            value={globalSearchQuery}
            onChange={(event) => setGlobalSearchQuery(event.target.value)}
            placeholder="전체 기록에서 제목, 메모, 자막 찾기"
          />
          <input
            className="search-input"
            type="search"
            value={tagFilter}
            onChange={(event) => setTagFilter(event.target.value)}
            placeholder="태그 필터"
          />
          <input
            className="search-input"
            type="search"
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
            placeholder="카테고리 필터"
          />
          <button
            className={`secondary ${showHighlightedOnly ? "active-toggle" : ""}`}
            onClick={() => setShowHighlightedOnly((current) => !current)}
            disabled={actionButtonsDisabled}
          >
            {showHighlightedOnly ? "전체 자막 보기" : "중요 표시만"}
          </button>
        </div>
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
              현재 필터 {totalSessionCount}개 / 현재 페이지{" "}
              {pageSessions.length}개 / 선택 {checkedIds.length}개
            </span>
            <div className="session-list-actions">
              <button
                className="secondary"
                onClick={handleToggleCheckAll}
                disabled={actionButtonsDisabled || !pageSessions.length}
              >
                {currentPageSessionsChecked
                  ? "현재 페이지 선택 해제"
                  : "현재 페이지 전체 선택"}
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
                  <strong>{session.committeeName || session.title}</strong>
                  <span>{formatDate(session.startedAt)}</span>
                  <span>
                    {session.subtitleCount}문장 / {session.charCount}자
                  </span>
                  {searchResultMap.get(session.id)?.firstHit ? (
                    <small>
                      검색 {searchResultMap.get(session.id)?.matchCount}건:{" "}
                      {searchResultMap
                        .get(session.id)
                        ?.firstHit?.text.slice(0, 60)}
                    </small>
                  ) : null}
                  {session.category ? (
                    <small>카테고리: {session.category}</small>
                  ) : null}
                  {session.tags?.length ? (
                    <small>태그: {session.tags.join(", ")}</small>
                  ) : null}
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
                onClick={() =>
                  setSessionPage((current) => Math.max(1, current - 1))
                }
                disabled={actionButtonsDisabled || sessionPage <= 1}
              >
                이전 페이지
              </button>
              <span>
                {sessionPage} / {pageCount}
              </span>
              <button
                className="secondary"
                onClick={() =>
                  setSessionPage((current) => Math.min(pageCount, current + 1))
                }
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
                  <h2>
                    {selectedSession.committeeName || selectedSession.title}
                  </h2>
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
                    {selectedSession.starred
                      ? "즐겨찾기 해제"
                      : "즐겨찾기 추가"}
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
                    disabled={
                      actionButtonsDisabled ||
                      !canReopenSourceUrl(selectedSession.sourceUrl)
                    }
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
                <div>
                  <dt>추정 크기</dt>
                  <dd>
                    {selectedEstimatedBytes.toLocaleString("ko-KR")} bytes
                  </dd>
                </div>
              </dl>

              <div className="note-card">
                <div className="section-row">
                  <strong>세션 메모</strong>
                  <div className="note-meta">
                    <span>
                      {noteDraft.length} / {SESSION_NOTE_MAX_LENGTH}자
                    </span>
                    <span
                      className={`note-status ${hasUnsavedNote ? "dirty" : ""}`}
                    >
                      {hasUnsavedNote ? "저장되지 않음" : "저장됨"}
                    </span>
                  </div>
                </div>
                <textarea
                  className="note-input"
                  value={noteDraft}
                  onChange={(event) =>
                    setNoteDraft(
                      event.target.value.slice(0, SESSION_NOTE_MAX_LENGTH),
                    )
                  }
                  placeholder="이 기록에 대한 메모를 남겨두세요."
                  rows={4}
                  maxLength={SESSION_NOTE_MAX_LENGTH}
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
                    disabled={
                      actionButtonsDisabled ||
                      noteDraft === selectedSession.note
                    }
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

              <div className="note-card">
                <div className="section-row">
                  <strong>분류 / 발언자</strong>
                  <div className="note-meta">
                    <span
                      className={`note-status ${hasUnsavedMetadata ? "dirty" : ""}`}
                    >
                      {hasUnsavedMetadata ? "저장되지 않음" : "저장됨"}
                    </span>
                  </div>
                </div>
                <input
                  className="search-input"
                  type="text"
                  value={categoryDraft}
                  onChange={(event) => setCategoryDraft(event.target.value)}
                  placeholder="카테고리"
                />
                <input
                  className="search-input"
                  type="text"
                  value={tagDraft}
                  onChange={(event) => setTagDraft(event.target.value)}
                  placeholder="태그를 쉼표로 구분해 입력"
                />
                <div className="copy-row">
                  <input
                    className="search-input"
                    type="text"
                    value={speakerPrimaryDraft}
                    onChange={(event) =>
                      setSpeakerPrimaryDraft(event.target.value)
                    }
                    placeholder="발언자 A 라벨"
                  />
                  <input
                    className="search-input"
                    type="text"
                    value={speakerSecondaryDraft}
                    onChange={(event) =>
                      setSpeakerSecondaryDraft(event.target.value)
                    }
                    placeholder="발언자 B 라벨"
                  />
                  <input
                    className="search-input"
                    type="text"
                    value={speakerUnknownDraft}
                    onChange={(event) =>
                      setSpeakerUnknownDraft(event.target.value)
                    }
                    placeholder="알 수 없음 라벨"
                  />
                </div>
                <div className="note-actions">
                  <button
                    onClick={() =>
                      runBusyHistoryAction(
                        "save_metadata",
                        handleSaveSessionMetadata,
                        "세션 메타데이터 저장에 실패했습니다.",
                        "세션 메타데이터를 저장하고 있습니다.",
                      )
                    }
                    disabled={actionButtonsDisabled || !hasUnsavedSessionDraft}
                  >
                    메타데이터 저장
                  </button>
                  <button
                    className="secondary"
                    onClick={discardUnsavedNoteDraft}
                    disabled={actionButtonsDisabled || !hasUnsavedSessionDraft}
                  >
                    변경 되돌리기
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
                  보이는 항목 {filteredEntries.length}개 / 선택{" "}
                  {selectedEntries.length}개
                </span>
                <div className="selection-actions">
                  <button
                    className="secondary"
                    onClick={handleToggleVisibleEntries}
                    disabled={actionButtonsDisabled || !filteredEntries.length}
                  >
                    {allVisibleEntriesChecked
                      ? "보이는 항목 선택 해제"
                      : "보이는 항목 전체 선택"}
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
                        buildCopyText(selectedSession.entries, {
                          selectedIds: checkedEntryIds,
                        }),
                        `선택한 ${selectedEntries.length}줄을 복사했습니다.`,
                      )
                    }
                    disabled={actionButtonsDisabled || !selectedEntries.length}
                  >
                    선택한 항목 복사
                  </button>
                  <button
                    className="secondary"
                    onClick={() =>
                      setCheckedEntryIds(
                        filteredEntries
                          .filter((entry) => entry.highlighted)
                          .map((entry) => entry.id),
                      )
                    }
                    disabled={
                      actionButtonsDisabled ||
                      !filteredEntries.some((entry) => entry.highlighted)
                    }
                  >
                    중요 항목 선택
                  </button>
                  <button
                    className="secondary"
                    onClick={() =>
                      runBusyHistoryAction(
                        "merge_entries",
                        handleMergeSelectedEntries,
                        "자막 병합에 실패했습니다.",
                        "선택한 자막을 병합하고 있습니다.",
                      )
                    }
                    disabled={
                      actionButtonsDisabled || selectedEntries.length < 2
                    }
                  >
                    선택 병합
                  </button>
                  <button
                    className="secondary"
                    onClick={() =>
                      runBusyHistoryAction(
                        "split_entry",
                        handleSplitSelectedEntry,
                        "자막 분할에 실패했습니다.",
                        "선택한 자막을 분할하고 있습니다.",
                      )
                    }
                    disabled={
                      actionButtonsDisabled || selectedEntries.length !== 1
                    }
                  >
                    선택 분할
                  </button>
                  <button
                    className="secondary"
                    onClick={() =>
                      runBusyHistoryAction(
                        "delete_entries",
                        handleDeleteSelectedEntries,
                        "선택 항목 삭제에 실패했습니다.",
                        "선택한 자막을 삭제하고 있습니다.",
                      )
                    }
                    disabled={actionButtonsDisabled || !selectedEntries.length}
                  >
                    선택 삭제
                  </button>
                </div>
              </div>

              <p className="section-heading">내보내기</p>
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
                      disabled={
                        actionButtonsDisabled || !selectedEntries.length
                      }
                    >
                      선택 {format.toUpperCase()}
                    </button>
                  ))}
                </div>

                <div className="export-row partial-export-row">
                  {EXPORT_FORMATS.map((format) => (
                    <button
                      key={`highlighted_${format}`}
                      className="secondary"
                      onClick={() =>
                        runBusyHistoryAction(
                          `export_highlighted_${format}`,
                          () => handleExport(format, highlightedEntries),
                          `중요 ${format.toUpperCase()} 저장을 시작하지 못했습니다.`,
                          `중요 ${format.toUpperCase()} 저장을 준비하고 있습니다.`,
                        )
                      }
                      disabled={
                        actionButtonsDisabled || !highlightedEntries.length
                      }
                    >
                      중요 {format.toUpperCase()}
                    </button>
                  ))}
                </div>

                <div className="note-card">
                  <div className="section-row">
                    <strong>시간 범위 저장</strong>
                    <span>
                      {timeRangeActive
                        ? `${timeRangeEntries.length}개 항목`
                        : "시작/종료 중 하나 이상을 입력하세요."}
                    </span>
                  </div>
                  <div className="copy-row">
                    <input
                      className="search-input"
                      type="datetime-local"
                      value={timeRangeFrom}
                      onChange={(event) => setTimeRangeFrom(event.target.value)}
                      aria-label="시간 범위 시작"
                    />
                    <input
                      className="search-input"
                      type="datetime-local"
                      value={timeRangeTo}
                      onChange={(event) => setTimeRangeTo(event.target.value)}
                      aria-label="시간 범위 종료"
                    />
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => {
                        setTimeRangeFrom("");
                        setTimeRangeTo("");
                      }}
                      disabled={actionButtonsDisabled || !timeRangeActive}
                    >
                      범위 비우기
                    </button>
                  </div>
                  <div className="export-row partial-export-row">
                    {EXPORT_FORMATS.map((format) => (
                      <button
                        key={`range_${format}`}
                        className="secondary"
                        onClick={() =>
                          runBusyHistoryAction(
                            `export_range_${format}`,
                            () =>
                              handleExport(format, undefined, { timeRange }),
                            `시간 범위 ${format.toUpperCase()} 저장을 시작하지 못했습니다.`,
                            `시간 범위 ${format.toUpperCase()} 저장을 준비하고 있습니다.`,
                          )
                        }
                        disabled={
                          actionButtonsDisabled ||
                          !timeRangeActive ||
                          !timeRangeEntries.length
                        }
                      >
                        범위 {format.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <p className="section-heading">복사</p>
              <div className="copy-row">
                <button
                  onClick={() =>
                    void handleCopy(
                      buildCopyText(selectedSession.entries, {
                        limit: recentCopyLineCount,
                      }),
                      `최근 ${recentCopyLineCount}줄을 복사했습니다.`,
                    )
                  }
                  disabled={
                    actionButtonsDisabled || !selectedSession.entries.length
                  }
                >
                  최근 {recentCopyLineCount}줄 복사
                </button>
                <button
                  onClick={() =>
                    void handleCopy(
                      buildCopyText(selectedSession.entries, {
                        query: searchQuery,
                      }),
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
                      buildCopyText(selectedSession.entries),
                      "전체 내용을 복사했습니다.",
                    )
                  }
                  disabled={
                    actionButtonsDisabled || !selectedSession.entries.length
                  }
                >
                  전체 내용 복사
                </button>
              </div>

              <p className="section-heading">
                자막 항목 {filteredEntries.length} /{" "}
                {selectedSession.entries.length}개
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
                        <time>
                          {formatDate(entry.startTime)} ·{" "}
                          {resolveSpeakerLabel(selectedSession, entry)}
                          {entry.highlighted ? " · 중요" : ""}
                        </time>
                        {editingEntryId === entry.id ? (
                          <>
                            <textarea
                              className="note-input"
                              value={editingEntryText}
                              onChange={(event) =>
                                setEditingEntryText(event.target.value)
                              }
                              rows={3}
                            />
                            <div className="copy-row">
                              <input
                                className="search-input"
                                type="text"
                                value={editingEntrySpeakerLabel}
                                onChange={(event) =>
                                  setEditingEntrySpeakerLabel(
                                    event.target.value,
                                  )
                                }
                                placeholder="entry 발언자 라벨"
                              />
                              <input
                                className="search-input"
                                type="text"
                                value={editingEntryLabels}
                                onChange={(event) =>
                                  setEditingEntryLabels(event.target.value)
                                }
                                placeholder="라벨을 쉼표로 구분"
                              />
                            </div>
                            <textarea
                              className="note-input"
                              value={editingEntryNote}
                              onChange={(event) =>
                                setEditingEntryNote(event.target.value)
                              }
                              rows={2}
                              placeholder="entry 메모"
                            />
                            <div className="note-actions">
                              <button
                                onClick={() =>
                                  runBusyHistoryAction(
                                    `edit_${entry.id}`,
                                    handleSaveEntryEdit,
                                    "자막 수정에 실패했습니다.",
                                    "자막 수정 내용을 저장하고 있습니다.",
                                  )
                                }
                                disabled={actionButtonsDisabled}
                              >
                                수정 저장
                              </button>
                              <button
                                className="secondary"
                                onClick={cancelEditEntry}
                                disabled={actionButtonsDisabled}
                              >
                                취소
                              </button>
                            </div>
                          </>
                        ) : (
                          <p>{entry.text}</p>
                        )}
                        {splitEntryId === entry.id ? (
                          <div className="split-editor">
                            <strong>자막 분할</strong>
                            <textarea
                              className="note-input"
                              value={splitDraft}
                              onChange={(event) =>
                                setSplitDraft(event.target.value)
                              }
                              rows={4}
                              placeholder="각 줄이 새 자막 항목이 됩니다."
                            />
                            <div className="note-actions">
                              <button
                                onClick={() =>
                                  runBusyHistoryAction(
                                    `split_save_${entry.id}`,
                                    handleSaveSplitEntry,
                                    "자막 분할에 실패했습니다.",
                                    "자막 분할 내용을 저장하고 있습니다.",
                                  )
                                }
                                disabled={actionButtonsDisabled}
                              >
                                분할 저장
                              </button>
                              <button
                                className="secondary"
                                onClick={handleCancelSplitEntry}
                                disabled={actionButtonsDisabled}
                              >
                                분할 취소
                              </button>
                            </div>
                          </div>
                        ) : null}
                        {entry.entryNote ? (
                          <small>{entry.entryNote}</small>
                        ) : null}
                        {entry.labels?.length ? (
                          <small>라벨: {entry.labels.join(", ")}</small>
                        ) : null}
                        <div className="note-actions">
                          <button
                            className="secondary"
                            onClick={() =>
                              runBusyHistoryAction(
                                `highlight_${entry.id}`,
                                () => handleToggleEntryHighlight(entry.id),
                                "중요 표시 저장에 실패했습니다.",
                              )
                            }
                            disabled={actionButtonsDisabled}
                          >
                            {entry.highlighted ? "중요 해제" : "중요 표시"}
                          </button>
                          <button
                            className="secondary"
                            onClick={() => {
                              beginEditEntry(entry);
                            }}
                            disabled={actionButtonsDisabled}
                          >
                            수정/메타데이터
                          </button>
                        </div>
                      </article>
                    </div>
                  ))
                ) : (
                  <div className="empty-card">
                    {searchQuery
                      ? "찾는 내용이 없습니다."
                      : "이 기록에 자막이 없습니다."}
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
