import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { SessionRecord } from "../../../core/subtitle-models";
import { resolveSessionLineageId } from "../../../core/subtitle-models";
import {
  deleteSessionLineage,
  listSessionLineagesPage,
  searchSessionLineagesPage,
  updateSessionLineageMetadata,
} from "../../../storage/session-store";
import type { SessionLineageSummary } from "../../../storage/types";
import {
  buildHistoryRefreshMessage,
  buildSelectedDeleteMessage,
} from "../../history-view-state";
import {
  toggleSelectedSessionId,
  selectAllSessionIds,
} from "../../history-view-state";
import { HISTORY_PAGE_SIZE } from "../helpers";
import {
  confirmDeleteSession,
  confirmDeleteSessions,
} from "../helpers";

/**
 * 기록 목록 도메인 (단일 책임: 목록 페이징·선택·라이브러리 액션).
 * 상세 도메인과는 setter/콜백으로만 연결된다.
 */
export function useHistoryLibrary() {
  const selectedIdRef = useRef("");
  const checkedIdsRef = useRef<string[]>([]);
  const refreshMessageRef = useRef<string | undefined>(undefined);
  const preserveMessageOnRefreshRef = useRef(false);
  const [pageLineages, setPageLineages] = useState<SessionLineageSummary[]>([]);
  const [totalSessionCount, setTotalSessionCount] = useState(0);
  const [selectedSession, setSelectedSession] = useState<SessionRecord | null>(null);
  const [selectedLineageSummary, setSelectedLineageSummary] =
    useState<SessionLineageSummary | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [sessionPage, setSessionPage] = useState(1);
  const [message, setMessage] = useState("기록을 불러오는 중입니다.");
  const [globalSearchQuery, setGlobalSearchQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [showHighlightedOnly, setShowHighlightedOnly] = useState(false);
  const [showStarredOnly, setShowStarredOnly] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const selectedLineageId =
    selectedLineageSummary?.lineageId ??
    (selectedSession
      ? resolveSessionLineageId(selectedSession.id, selectedSession.lineageId)
      : "");
  const checkedIdSet = useMemo(() => new Set(checkedIds), [checkedIds]);
  const pageCount = Math.max(
    1,
    Math.ceil(totalSessionCount / HISTORY_PAGE_SIZE),
  );
  const currentPageSessionsChecked =
    pageLineages.length > 0 && pageLineages.every((lineage) => checkedIdSet.has(lineage.lineageId));
  const searchModeActive =
    Boolean(globalSearchQuery.trim()) ||
    Boolean(tagFilter.trim()) ||
    Boolean(categoryFilter.trim()) ||
    showHighlightedOnly;
  const actionButtonsDisabled = busyAction !== null;

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

  const requestRefresh = useCallback(
    (
      messageOnSuccess?: string,
      options: {
        preserveMessage?: boolean;
      } = {},
    ): void => {
      refreshMessageRef.current = messageOnSuccess;
      preserveMessageOnRefreshRef.current = options.preserveMessage ?? false;
      setReloadKey((current) => current + 1);
    },
    [],
  );

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    checkedIdsRef.current = checkedIds;
  }, [checkedIds]);

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

  const handleDelete = async (): Promise<void> => {
    if (!selectedLineageId || !selectedSession) {
      return;
    }
    if (!(await confirmDeleteSession(selectedSession))) {
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
      !(await confirmDeleteSessions(
        targetLineages.map((lineage) => lineage.representativeSession),
        "선택한 회의",
      ))
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

  return {
    pageLineages,
    totalSessionCount,
    selectedSession,
    setSelectedSession,
    selectedLineageSummary,
    selectedLineageId,
    selectedId,
    setSelectedId,
    setSelectedLineageSummary,
    checkedIds,
    setCheckedIds,
    checkedIdSet,
    sessionPage,
    setSessionPage,
    pageCount,
    currentPageSessionsChecked,
    message,
    setMessage,
    globalSearchQuery,
    setGlobalSearchQuery,
    tagFilter,
    setTagFilter,
    categoryFilter,
    setCategoryFilter,
    showHighlightedOnly,
    setShowHighlightedOnly,
    showStarredOnly,
    setShowStarredOnly,
    busyAction,
    actionButtonsDisabled,
    searchModeActive,
    runBusyHistoryAction,
    requestRefresh,
    handleDelete,
    handleDeleteChecked,
    handleToggleChecked,
    handleToggleCheckAll,
    handleToggleFavorite,
  };
}
