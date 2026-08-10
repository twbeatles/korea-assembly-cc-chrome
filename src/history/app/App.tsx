import { useEffect, useMemo, useRef, useState } from "react";

import { createTab, sendRuntimeMessage } from "../../shared/chrome-api";
import { copyTextToClipboard, filterEntriesByQuery } from "../../shared/copy-utils";
import {
  resolveSessionLineageId,
  type ExportFormat,
  type SessionRecord,
} from "../../core/subtitle-models";
import {
  isSegmentedSessionRecord,
  mergeSessionSegments,
  sortSessionSegments,
} from "../../core/session-lineage";
import {
  cloneEntry,
  createId,
  type SubtitleEntry,
} from "../../core/subtitle-models";
import {
  DEFAULT_EXTENSION_SETTINGS,
  EXTENSION_STORAGE_KEY,
  SESSION_LIBRARY_REVISION_STORAGE_KEY,
} from "../../shared/constants";
import {
  mapDownloadErrorMessage,
  resolveDownloadErrorMessage,
} from "../../shared/download-errors";
import {
  assertSessionLibraryTransferSizeWithinLimit,
  parseSessionImportPayload,
} from "../../storage/session-backup";
import {
  getUtf8ByteLength,
} from "../../shared/byte-size";
import {
  buildSessionLibraryBackupExport,
  deleteAllSessions,
  deleteSessionLineage,
  getSessionLibraryOverview,
  importSessionRecords,
  listSessionLineagesPage,
  listSessionLineageSegments,
  searchSessionLineagesPage,
  updateSessionContent,
  updateSessionLineageMetadata,
  updateSessionMetadata,
} from "../../storage/session-store";
import type {
  SessionLineageSummary,
  SessionLongTaskKind,
  SessionLongTaskProgress,
} from "../../storage/types";
import { getSettings } from "../../storage/settings-store";
import {
  getExportFormatLabel,
} from "../../shared/ui-labels";
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
} from "../history-view-state";
import { readBlobTextWithProgress } from "../blob-read";
import { downloadPageBlobExport } from "../page-blob-download";
import {
  HISTORY_PAGE_SIZE,
  LARGE_LINEAGE_EXPORT_WARNING_BYTES,
  canReopenSourceUrl,
  computeSplitTime,
  confirmDeleteSession,
  confirmDeleteSessionLibrary,
  confirmDeleteSessions,
  confirmDiscardUnsavedNote,
  estimateSessionExportBytes,
  extractCancelledImportSummary,
  formatTagInput,
  isAbortError,
  parseLabelInput,
  parseTagInput,
} from "./helpers";
import { useHistoryLongTask } from "./hooks/useHistoryLongTask";
import { SessionListPanel } from "./sections/SessionListPanel";
import { HistoryHero } from "./sections/HistoryHero";
import { SessionDetailPanel } from "./sections/SessionDetailPanel";

export default function App() {
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const longTaskAbortControllerRef = useRef<AbortController | null>(null);
  const {
    longTask,
    beginLongTask,
    updateLongTaskProgress: applyLongTaskProgress,
    requestLongTaskCancel,
    endLongTask,
  } = useHistoryLongTask();
  const refreshMessageRef = useRef<string | undefined>(undefined);
  const preserveMessageOnRefreshRef = useRef(false);
  const selectedIdRef = useRef("");
  const checkedIdsRef = useRef<string[]>([]);
  const noteDraftRef = useRef("");
  const tagDraftRef = useRef("");
  const categoryDraftRef = useRef("");
  const previousSelectedSessionRef = useRef<SessionRecord | null>(null);
  const [pageLineages, setPageLineages] = useState<SessionLineageSummary[]>([]);
  const [totalSessionCount, setTotalSessionCount] = useState(0);
  const [selectedSession, setSelectedSession] = useState<SessionRecord | null>(null);
  const [selectedLineageSummary, setSelectedLineageSummary] =
    useState<SessionLineageSummary | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [checkedEntryIds, setCheckedEntryIds] = useState<string[]>([]);
  const [lineageSessions, setLineageSessions] = useState<SessionRecord[]>([]);
  const [lineageLoading, setLineageLoading] = useState(false);
  const [lineageViewEnabled, setLineageViewEnabled] = useState(false);
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
  /** 시간 범위 export (datetime-local 값, 비우면 전체) */
  const [exportTimeFrom, setExportTimeFrom] = useState("");
  const [exportTimeTo, setExportTimeTo] = useState("");
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
  const [panelSpeakerHighlightEnabled, setPanelSpeakerHighlightEnabled] = useState(
    DEFAULT_EXTENSION_SETTINGS.panelSpeakerHighlightEnabled,
  );
  const [reloadKey, setReloadKey] = useState(0);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const selectedLineageId =
    selectedLineageSummary?.lineageId ??
    (selectedSession
      ? resolveSessionLineageId(selectedSession.id, selectedSession.lineageId)
      : "");
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
  const displayExportEstimateBytes = useMemo(
    () =>
      displaySession
        ? estimateSessionExportBytes(
            displaySession,
            txtExportTimestampsEnabled,
            txtExportSpeakerEnabled,
          )
        : 0,
    [displaySession, txtExportTimestampsEnabled, txtExportSpeakerEnabled],
  );
  const filteredEntries = useMemo(
    () => filterEntriesByQuery(displaySession?.entries ?? [], searchQuery),
    [displaySession, searchQuery],
  );
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
    () => displaySession?.entries.filter((entry) => checkedEntryIdSet.has(entry.id)) ?? [],
    [checkedEntryIdSet, displaySession],
  );
  const currentPageSessionsChecked =
    pageLineages.length > 0 && pageLineages.every((lineage) => checkedIdSet.has(lineage.lineageId));
  const allVisibleEntriesChecked =
    filteredEntries.length > 0 &&
    filteredEntries.every((entry) => checkedEntryIdSet.has(entry.id));
  const hasUnsavedNote =
    selectedSession
      ? noteDraft !== (selectedLineageSummary?.note ?? selectedSession.note)
      : noteDraft.trim().length > 0;
  const hasUnsavedMetadata = selectedSession
    ? tagDraft !== formatTagInput(selectedSession.tags) ||
      categoryDraft !== (selectedSession.category ?? "") ||
      speakerPrimaryDraft !== (selectedSession.speakerLabels?.primary ?? "") ||
      speakerSecondaryDraft !== (selectedSession.speakerLabels?.secondary ?? "") ||
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
  const showingLineageView = lineageViewEnabled && hasLineageSegments && !!lineageAggregateSession;
  const shouldOfferSplitExport =
    showingLineageView && displayExportEstimateBytes > LARGE_LINEAGE_EXPORT_WARNING_BYTES;
  const selectedEstimatedBytes = displayExportEstimateBytes;
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
    applyLongTaskProgress(progress);
  };

  const clearLongTaskState = (
    _kind: SessionLongTaskKind,
    controller: AbortController,
  ): void => {
    if (longTaskAbortControllerRef.current === controller) {
      longTaskAbortControllerRef.current = null;
    }
    // longTask 클로저 스테일에 의존하지 않고 항상 종료
    endLongTask();
  };

  const handleCancelLongTask = (): void => {
    if (!longTaskAbortControllerRef.current || !longTask || longTask.cancelRequested) {
      return;
    }
    requestLongTaskCancel();
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
    setNoteDraft(selectedLineageSummary?.note ?? selectedSession?.note ?? "");
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
      setNoteDraft(selectedLineageSummary?.note ?? selectedSession?.note ?? "");
    } else if (
      previousSelectedSession &&
      selectedSession &&
      noteDraftRef.current === previousSelectedSession.note
    ) {
      setNoteDraft(selectedLineageSummary?.note ?? selectedSession.note);
    }
    previousSelectedSessionRef.current = selectedSession;
  }, [selectedLineageSummary, selectedSession]);

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

        const nextSessions = sessions.length ? sessions : [selectedSession];
        setLineageSessions(nextSessions);
        const hydratedSelectedSession =
          nextSessions.find((session) => session.id === selectedSession.id) ?? null;
        if (
          selectedSession.entries.length === 0 &&
          hydratedSelectedSession &&
          hydratedSelectedSession.entries.length > 0
        ) {
          setSelectedSession((current) =>
            current?.id === hydratedSelectedSession.id ? hydratedSelectedSession : current,
          );
        }
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
    } else if (!lineageLoading && availableLineageSessions.length > 1) {
      setLineageViewEnabled(true);
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
          ? await searchSessionLineagesPage({
              page: sessionPage,
              pageSize: HISTORY_PAGE_SIZE,
              starredOnly: showStarredOnly,
              query: globalSearchQuery,
              tag: tagFilter,
              category: categoryFilter,
              highlightedOnly: showHighlightedOnly,
            })
          : await listSessionLineagesPage({
              page: sessionPage,
              pageSize: HISTORY_PAGE_SIZE,
              starredOnly: showStarredOnly,
            });
        if (!active) {
          return;
        }

        setPageLineages(pageResult.lineages);
        setTotalSessionCount(pageResult.totalCount);
        if (pageResult.page !== sessionPage) {
          setSessionPage(pageResult.page);
        }

        if (checkedIdsRef.current.length > 0) {
          const visibleLineageIds = new Set(pageResult.lineages.map((lineage) => lineage.lineageId));
          setCheckedIds((current) => current.filter((lineageId) => visibleLineageIds.has(lineageId)));
        }

        let nextSelectedId = selectedIdRef.current || pageResult.lineages[0]?.lineageId || "";
        let nextSelectedLineage =
          pageResult.lineages.find((lineage) => lineage.lineageId === nextSelectedId) ?? null;

        if (!nextSelectedLineage && pageResult.lineages.length > 0) {
          nextSelectedLineage = pageResult.lineages[0];
          nextSelectedId = nextSelectedLineage.lineageId;
        }

        if (!nextSelectedLineage) {
          nextSelectedId = "";
        }

        setSelectedId(nextSelectedId);
        setSelectedLineageSummary(nextSelectedLineage);
        setSelectedSession(nextSelectedLineage?.representativeSession ?? null);

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
        setPanelSpeakerHighlightEnabled(nextSettings.panelSpeakerHighlightEnabled);
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
        setPanelSpeakerHighlightEnabled(nextSettings.panelSpeakerHighlightEnabled);
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
    if (!selectedLineageId || !selectedSession) {
      return;
    }
    if (!confirmDeleteSession(selectedSession)) {
      setMessage("기록 삭제를 취소했습니다.");
      return;
    }

    try {
      await deleteSessionLineage(selectedLineageId);
      requestRefresh("선택한 기록을 삭제했습니다.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "기록 삭제에 실패했습니다.",
      );
    }
  };

  const deleteLineageIds = async (
    lineageIds: string[],
  ): Promise<{
    deletedCount: number;
    failedCount: number;
  }> => {
    const results = await Promise.allSettled(
      lineageIds.map((lineageId) => deleteSessionLineage(lineageId)),
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

    const targetLineages = pageLineages.filter((lineage) =>
      checkedIds.includes(lineage.lineageId),
    );
    if (!targetLineages.length) {
      setCheckedIds([]);
      requestRefresh(undefined, { preserveMessage: true });
      return;
    }

    if (
      !confirmDeleteSessions(
        targetLineages.map((lineage) => lineage.representativeSession),
        "선택한 회의",
      )
    ) {
      setMessage("선택 삭제를 취소했습니다.");
      return;
    }

    try {
      const result = await deleteLineageIds(targetLineages.map((lineage) => lineage.lineageId));
      setCheckedIds([]);
      requestRefresh(
        buildSelectedDeleteMessage(
          targetLineages.length,
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
        ? current.filter((id) => !pageLineages.some((lineage) => lineage.lineageId === id))
        : [
            ...new Set([
              ...current,
              ...selectAllSessionIds(
                pageLineages.map((lineage) => ({ id: lineage.lineageId })),
              ),
            ]),
          ],
    );
  };

  const handleToggleFavorite = async (lineage: SessionLineageSummary): Promise<void> => {
    try {
      await updateSessionLineageMetadata(lineage.lineageId, {
        starred: !lineage.starred,
        pinnedAt: lineage.starred ? null : new Date().toISOString(),
      });
      requestRefresh(
        lineage.starred ? "즐겨찾기를 해제했습니다." : "즐겨찾기에 추가했습니다.",
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
    if (!selectedLineageId) {
      return;
    }

    try {
      await updateSessionLineageMetadata(selectedLineageId, {
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

  const resolveExportTimeRange = ():
    | { from?: string; to?: string }
    | undefined => {
    const fromLocal = exportTimeFrom.trim();
    const toLocal = exportTimeTo.trim();
    if (!fromLocal && !toLocal) {
      return undefined;
    }
    // datetime-local 은 로컬 시각 문자열이므로 Date 로 파싱해 ISO 로 보낸다.
    const fromIso = fromLocal ? new Date(fromLocal).toISOString() : undefined;
    const toIso = toLocal ? new Date(toLocal).toISOString() : undefined;
    if (fromIso && Number.isNaN(Date.parse(fromIso))) {
      throw new Error("시작 시각 형식이 올바르지 않습니다.");
    }
    if (toIso && Number.isNaN(Date.parse(toIso))) {
      throw new Error("종료 시각 형식이 올바르지 않습니다.");
    }
    return { from: fromIso, to: toIso };
  };

  const handleExport = async (
    format: ExportFormat,
    entries?: SessionRecord["entries"],
  ): Promise<void> => {
    if (!selectedSession || !displaySession) {
      return;
    }

    const isPartialExport = Boolean(entries?.length);
    let timeRange: { from?: string; to?: string } | undefined;
    try {
      timeRange = resolveExportTimeRange();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "시간 범위가 올바르지 않습니다.");
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
            txtExportSpeakerEnabled,
            entryIds: entries?.map((entry) => entry.id),
            timeRange,
          })
        : await sendRuntimeMessage({
            type: "DOWNLOAD_SESSION_EXPORT",
            sessionId: selectedSession.id,
            format,
            filenamePattern,
            txtExportTimestampsEnabled,
            txtExportSpeakerEnabled,
            entryIds: entries?.map((entry) => entry.id),
            timeRange,
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
      setMessage(
        resolveDownloadErrorMessage(
          error,
          "파일 저장을 시작하지 못했습니다.",
          entries?.length ? "partial" : "single-session",
        ),
      );
    }
  };

  const handleSplitLineageExport = async (format: ExportFormat): Promise<void> => {
    if (!selectedLineageId || availableLineageSessions.length <= 1) {
      return;
    }

    try {
      const segments = sortSessionSegments(availableLineageSessions);
      for (const [index, segment] of segments.entries()) {
        const response = await sendRuntimeMessage({
          type: "DOWNLOAD_SESSION_EXPORT",
          sessionId: segment.id,
          format,
          filenamePattern,
          txtExportTimestampsEnabled,
          txtExportSpeakerEnabled,
          filenameSuffix: `segment-${String(index + 1).padStart(3, "0")}`,
        });
        if (!response.ok) {
          setMessage(
            mapDownloadErrorMessage(response.error) ||
              `세그먼트 ${index + 1} 저장을 시작하지 못했습니다.`,
          );
          return;
        }
      }

      setMessage(
        `연속 캡처 ${segments.length}개 세그먼트의 ${getExportFormatLabel(format)} 분할 저장을 시작했습니다.`,
      );
    } catch (error) {
      setMessage(resolveDownloadErrorMessage(error, "분할 저장을 시작하지 못했습니다."));
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

  const handleSelectSession = (lineageId: string): void => {
    if (lineageId !== selectedLineageId && hasUnsavedNote && !confirmDiscardUnsavedNote("세션 전환")) {
      setMessage("세션 전환을 취소했습니다.");
      return;
    }

    const nextSelectedLineage = pageLineages.find((lineage) => lineage.lineageId === lineageId) ?? null;
    setSelectedId(lineageId);
    setSelectedLineageSummary(nextSelectedLineage);
    setSelectedSession(nextSelectedLineage?.representativeSession ?? null);
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

    setSelectedId(resolveSessionLineageId(nextSelectedSession.id, nextSelectedSession.lineageId));
    setSelectedSession(nextSelectedSession);
  };

  const handleToggleEntryChecked = (entryId: string): void => {
    setCheckedEntryIds((current) => toggleSelectedEntryId(current, entryId));
  };

  const handleBackupAll = async (): Promise<void> => {
    if (jsonTaskButtonsDisabled) {
      return;
    }

    const controller = beginLongTask(
      "backup",
      "전체 JSON 백업을 준비하고 있습니다.",
    );
    longTaskAbortControllerRef.current = controller;

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

    const controller = beginLongTask("import", "JSON 파일을 읽고 있습니다.");
    longTaskAbortControllerRef.current = controller;
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
      <HistoryHero
        heroMessage={heroMessage}
        longTask={longTask}
        longTaskProgressLabel={longTaskProgressLabel}
        showStarredOnly={showStarredOnly}
        showHighlightedOnly={showHighlightedOnly}
        actionButtonsDisabled={actionButtonsDisabled}
        jsonTaskButtonsDisabled={jsonTaskButtonsDisabled}
        hasUnsavedSessionDraft={hasUnsavedSessionDraft}
        globalSearchQuery={globalSearchQuery}
        tagFilter={tagFilter}
        categoryFilter={categoryFilter}
        importInputRef={importInputRef}
        onRefresh={() =>
          runBusyHistoryAction(
            "refresh",
            handleRefreshClick,
            "기록 목록을 다시 읽지 못했습니다.",
            "기록 목록을 다시 불러오고 있습니다.",
          )
        }
        onToggleStarredOnly={() => {
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
        onBackupAll={() => void handleBackupAll()}
        onImportClick={handleImportClick}
        onCancelLongTask={handleCancelLongTask}
        onGlobalSearchChange={setGlobalSearchQuery}
        onTagFilterChange={setTagFilter}
        onCategoryFilterChange={setCategoryFilter}
        onToggleHighlightedOnly={() =>
          setShowHighlightedOnly((current) => !current)
        }
        onImportChange={(event) => void handleImportChange(event)}
      />

      <section className="layout">
        <SessionListPanel
          pageLineages={pageLineages}
          totalSessionCount={totalSessionCount}
          checkedIds={checkedIds}
          checkedIdSet={checkedIdSet}
          selectedLineageId={selectedLineageId}
          sessionPage={sessionPage}
          pageCount={pageCount}
          currentPageSessionsChecked={currentPageSessionsChecked}
          showStarredOnly={showStarredOnly}
          actionButtonsDisabled={actionButtonsDisabled}
          onToggleCheckAll={handleToggleCheckAll}
          onToggleChecked={handleToggleChecked}
          onSelectSession={handleSelectSession}
          onToggleFavorite={handleToggleFavorite}
          onDeleteChecked={() =>
            runBusyHistoryAction(
              "delete_checked",
              handleDeleteChecked,
              "선택 삭제에 실패했습니다.",
              "선택한 기록을 삭제하고 있습니다.",
            )
          }
          onDeleteAll={() =>
            runBusyHistoryAction(
              "delete_all",
              handleDeleteAll,
              "전체 삭제에 실패했습니다.",
              "저장된 기록 전체 삭제를 진행하고 있습니다.",
            )
          }
          onPageChange={setSessionPage}
          runBusy={runBusyHistoryAction}
        />

        <SessionDetailPanel
          selectedSession={selectedSession}
          displaySession={displaySession}
          selectedLineageId={selectedLineageId}
          selectedLineageSummary={selectedLineageSummary}
          availableLineageSessions={availableLineageSessions}
          lineageAggregateSession={lineageAggregateSession}
          hasLineageSegments={hasLineageSegments}
          showingLineageView={showingLineageView}
          shouldShowSelectedSegmentLabel={shouldShowSelectedSegmentLabel}
          lineageLoading={lineageLoading}
          selectedEstimatedBytes={selectedEstimatedBytes}
          totalSessionCount={totalSessionCount}
          showStarredOnly={showStarredOnly}
          actionButtonsDisabled={actionButtonsDisabled}
          noteDraft={noteDraft}
          tagDraft={tagDraft}
          categoryDraft={categoryDraft}
          speakerPrimaryDraft={speakerPrimaryDraft}
          speakerSecondaryDraft={speakerSecondaryDraft}
          speakerUnknownDraft={speakerUnknownDraft}
          hasUnsavedNote={hasUnsavedNote}
          hasUnsavedMetadata={hasUnsavedMetadata}
          hasUnsavedSessionDraft={hasUnsavedSessionDraft}
          searchQuery={searchQuery}
          filteredEntries={filteredEntries}
          selectedEntries={selectedEntries}
          checkedEntryIds={checkedEntryIds}
          checkedEntryIdSet={checkedEntryIdSet}
          allVisibleEntriesChecked={allVisibleEntriesChecked}
          shouldOfferSplitExport={shouldOfferSplitExport}
          exportTimeFrom={exportTimeFrom}
          exportTimeTo={exportTimeTo}
          editingEntryId={editingEntryId}
          editingEntryText={editingEntryText}
          editingEntrySpeakerLabel={editingEntrySpeakerLabel}
          editingEntryNote={editingEntryNote}
          editingEntryLabels={editingEntryLabels}
          splitEntryId={splitEntryId}
          splitDraft={splitDraft}
          recentCopyLineCount={recentCopyLineCount}
          txtExportSpeakerEnabled={txtExportSpeakerEnabled}
          panelSpeakerHighlightEnabled={panelSpeakerHighlightEnabled}
          runBusyHistoryAction={runBusyHistoryAction}
          setLineageViewEnabled={setLineageViewEnabled}
          setNoteDraft={setNoteDraft}
          setTagDraft={setTagDraft}
          setCategoryDraft={setCategoryDraft}
          setSpeakerPrimaryDraft={setSpeakerPrimaryDraft}
          setSpeakerSecondaryDraft={setSpeakerSecondaryDraft}
          setSpeakerUnknownDraft={setSpeakerUnknownDraft}
          setSearchQuery={setSearchQuery}
          setCheckedEntryIds={setCheckedEntryIds}
          setExportTimeFrom={setExportTimeFrom}
          setExportTimeTo={setExportTimeTo}
          setEditingEntryText={setEditingEntryText}
          setEditingEntrySpeakerLabel={setEditingEntrySpeakerLabel}
          setEditingEntryNote={setEditingEntryNote}
          setEditingEntryLabels={setEditingEntryLabels}
          setSplitDraft={setSplitDraft}
          handleToggleFavorite={handleToggleFavorite}
          handleReopen={handleReopen}
          handleDelete={handleDelete}
          handleSelectLineageSegment={handleSelectLineageSegment}
          handleSaveNote={handleSaveNote}
          handleSaveSessionMetadata={handleSaveSessionMetadata}
          discardUnsavedNoteDraft={discardUnsavedNoteDraft}
          handleToggleVisibleEntries={handleToggleVisibleEntries}
          handleCopy={handleCopy}
          handleExport={handleExport}
          handleSplitLineageExport={handleSplitLineageExport}
          handleToggleEntryChecked={handleToggleEntryChecked}
          handleToggleEntryHighlight={handleToggleEntryHighlight}
          handleSaveEntryEdit={handleSaveEntryEdit}
          handleDeleteSelectedEntries={handleDeleteSelectedEntries}
          handleMergeSelectedEntries={handleMergeSelectedEntries}
          handleSplitSelectedEntry={handleSplitSelectedEntry}
          handleSaveSplitEntry={handleSaveSplitEntry}
          handleCancelSplitEntry={handleCancelSplitEntry}
          beginEditEntry={beginEditEntry}
          cancelEditEntry={cancelEditEntry}
        />
      </section>
    </main>
  );
}
