import {
  deleteAllSessions,
  getSessionLibraryOverview,
} from "../../storage/session-store";
import {
  buildDeleteAllFailureMessage,
  buildDeleteAllSuccessMessage,
} from "../history-view-state";
import { confirmDeleteSessionLibrary, confirmDiscardUnsavedNote } from "./helpers";
import { useHistoryLibrary } from "./hooks/useHistoryLibrary";
import { useHistoryDetail } from "./hooks/useHistoryDetail";
import { useHistoryEntries } from "./hooks/useHistoryEntries";
import { useHistoryTransfer } from "./hooks/useHistoryTransfer";
import { SessionListPanel } from "./sections/SessionListPanel";
import { HistoryHero } from "./sections/HistoryHero";
import { SessionDetailPanel } from "./sections/SessionDetailPanel";

/**
 * History 상태·핸들러 조립 루트.
 * 목록/상세/엔트리/입출력 도메인은 hooks/ 가 소유하고,
 * App 은 도메인을 가로지르는 전환 가드와 화면 조립만 담당한다.
 */
export default function App() {
  const library = useHistoryLibrary();
  const detail = useHistoryDetail({
    selectedSession: library.selectedSession,
    setSelectedSession: library.setSelectedSession,
    selectedLineageSummary: library.selectedLineageSummary,
    requestRefresh: library.requestRefresh,
    setMessage: library.setMessage,
  });
  const entries = useHistoryEntries({
    selectedSession: library.selectedSession,
    setSelectedSession: library.setSelectedSession,
    displaySession: detail.displaySession,
    searchQuery: detail.searchQuery,
    captureInProgress: detail.captureInProgress,
    setMessage: library.setMessage,
    requestRefresh: library.requestRefresh,
  });
  const transfer = useHistoryTransfer({
    selectedSession: library.selectedSession,
    displaySession: detail.displaySession,
    selectedLineageId: library.selectedLineageId,
    availableLineageSessions: detail.availableLineageSessions,
    showingLineageView: detail.showingLineageView,
    filenamePattern: detail.filenamePattern,
    txtExportTimestampsEnabled: detail.txtExportTimestampsEnabled,
    txtExportSpeakerEnabled: detail.txtExportSpeakerEnabled,
    isBusy: () => library.busyAction !== null,
    setMessage: library.setMessage,
    requestRefresh: library.requestRefresh,
  });

  const heroMessage = transfer.longTask?.message ?? library.message;
  const longTaskProgressLabel =
    transfer.longTask && transfer.longTask.total > 0
      ? `${Math.min(transfer.longTask.completed, transfer.longTask.total)} / ${transfer.longTask.total}`
      : null;
  const jsonTaskButtonsDisabled =
    library.busyAction !== null || transfer.longTask !== null;

  const handleRefreshClick = async (): Promise<void> => {
    if (detail.hasUnsavedSessionDraft && !(await confirmDiscardUnsavedNote("목록 새로고침"))) {
      library.setMessage("새로고침을 취소했습니다.");
      return;
    }

    if (detail.hasUnsavedSessionDraft) {
      detail.discardUnsavedNoteDraft();
    }

    library.requestRefresh();
  };

  const handleSelectSession = (lineageId: string): void => {
    void (async () => {
      if (
        lineageId !== library.selectedLineageId &&
        detail.hasUnsavedNote &&
        !(await confirmDiscardUnsavedNote("세션 전환"))
      ) {
        library.setMessage("세션 전환을 취소했습니다.");
        return;
      }

      const nextSelectedLineage =
        library.pageLineages.find((lineage) => lineage.lineageId === lineageId) ?? null;
      library.setSelectedId(lineageId);
      library.setSelectedLineageSummary(nextSelectedLineage);
      library.setSelectedSession(nextSelectedLineage?.representativeSession ?? null);
    })();
  };

  const handleSelectLineageSegment = (sessionId: string): void => {
    void (async () => {
      if (
        sessionId !== library.selectedSession?.id &&
        detail.hasUnsavedNote &&
        !(await confirmDiscardUnsavedNote("세그먼트 전환"))
      ) {
        library.setMessage("세그먼트 전환을 취소했습니다.");
        return;
      }

      const nextSelectedSession =
        detail.availableLineageSessions.find((session) => session.id === sessionId) ?? null;
      if (!nextSelectedSession) {
        return;
      }

      library.setSelectedSession(nextSelectedSession);
    })();
  };

  const handleDeleteAll = async (): Promise<void> => {
    try {
      const overview = await getSessionLibraryOverview();
      if (!overview.totalCount) {
        library.requestRefresh();
        return;
      }
      if (
        !(await confirmDeleteSessionLibrary(
          overview,
          "이 확인 이후에 새로 저장된 기록도 함께 삭제될 수 있습니다.",
        ))
      ) {
        library.setMessage("전체 삭제를 취소했습니다.");
        return;
      }

      await deleteAllSessions();
      detail.setSearchQuery("");
      library.setCheckedIds([]);
      entries.setCheckedEntryIds([]);
      library.requestRefresh(buildDeleteAllSuccessMessage(overview.totalCount));
    } catch (error) {
      library.requestRefresh(
        buildDeleteAllFailureMessage(
          error instanceof Error ? `(${error.message})` : undefined,
        ),
      );
    }
  };

  return (
    <main className="history-shell">
      <HistoryHero
        heroMessage={heroMessage}
        longTask={transfer.longTask}
        longTaskProgressLabel={longTaskProgressLabel}
        showStarredOnly={library.showStarredOnly}
        showHighlightedOnly={library.showHighlightedOnly}
        actionButtonsDisabled={library.actionButtonsDisabled}
        jsonTaskButtonsDisabled={jsonTaskButtonsDisabled}
        hasUnsavedSessionDraft={detail.hasUnsavedSessionDraft}
        globalSearchQuery={library.globalSearchQuery}
        tagFilter={library.tagFilter}
        categoryFilter={library.categoryFilter}
        importInputRef={transfer.importInputRef}
        onRefresh={() =>
          library.runBusyHistoryAction(
            "refresh",
            handleRefreshClick,
            "기록 목록을 다시 읽지 못했습니다.",
            "기록 목록을 다시 불러오고 있습니다.",
          )
        }
        onToggleStarredOnly={() => {
          void (async () => {
            if (
              detail.hasUnsavedSessionDraft &&
              !(await confirmDiscardUnsavedNote("필터 변경"))
            ) {
              library.setMessage("필터 변경을 취소했습니다.");
              return;
            }
            if (detail.hasUnsavedSessionDraft) {
              detail.discardUnsavedNoteDraft();
            }
            library.setShowStarredOnly((current) => !current);
          })();
        }}
        onBackupAll={() => void transfer.handleBackupAll()}
        onImportClick={transfer.handleImportClick}
        onCancelLongTask={transfer.handleCancelLongTask}
        onGlobalSearchChange={library.setGlobalSearchQuery}
        onTagFilterChange={library.setTagFilter}
        onCategoryFilterChange={library.setCategoryFilter}
        onToggleHighlightedOnly={() =>
          library.setShowHighlightedOnly((current) => !current)
        }
        onImportChange={(event) => void transfer.handleImportChange(event)}
      />

      <section className="layout">
        <SessionListPanel
          pageLineages={library.pageLineages}
          totalSessionCount={library.totalSessionCount}
          checkedIds={library.checkedIds}
          checkedIdSet={library.checkedIdSet}
          selectedLineageId={library.selectedLineageId}
          sessionPage={library.sessionPage}
          pageCount={library.pageCount}
          currentPageSessionsChecked={library.currentPageSessionsChecked}
          showStarredOnly={library.showStarredOnly}
          actionButtonsDisabled={library.actionButtonsDisabled}
          onToggleCheckAll={library.handleToggleCheckAll}
          onToggleChecked={library.handleToggleChecked}
          onSelectSession={handleSelectSession}
          onToggleFavorite={library.handleToggleFavorite}
          onDeleteChecked={() =>
            library.runBusyHistoryAction(
              "delete_checked",
              library.handleDeleteChecked,
              "선택 삭제에 실패했습니다.",
              "선택한 기록을 삭제하고 있습니다.",
            )
          }
          onDeleteAll={() =>
            library.runBusyHistoryAction(
              "delete_all",
              handleDeleteAll,
              "전체 삭제에 실패했습니다.",
              "저장된 기록 전체 삭제를 진행하고 있습니다.",
            )
          }
          onPageChange={library.setSessionPage}
          runBusy={library.runBusyHistoryAction}
        />

        <SessionDetailPanel
          selectedSession={library.selectedSession}
          displaySession={detail.displaySession}
          selectedLineageId={library.selectedLineageId}
          selectedLineageSummary={library.selectedLineageSummary}
          availableLineageSessions={detail.availableLineageSessions}
          lineageAggregateSession={detail.lineageAggregateSession}
          hasLineageSegments={detail.hasLineageSegments}
          showingLineageView={detail.showingLineageView}
          shouldShowSelectedSegmentLabel={detail.shouldShowSelectedSegmentLabel}
          lineageLoading={detail.lineageLoading}
          selectedEstimatedBytes={detail.selectedEstimatedBytes}
          totalSessionCount={library.totalSessionCount}
          showStarredOnly={library.showStarredOnly}
          actionButtonsDisabled={library.actionButtonsDisabled}
          captureInProgress={detail.captureInProgress}
          noteDraft={detail.noteDraft}
          tagDraft={detail.tagDraft}
          categoryDraft={detail.categoryDraft}
          speakerPrimaryDraft={detail.speakerPrimaryDraft}
          speakerSecondaryDraft={detail.speakerSecondaryDraft}
          speakerUnknownDraft={detail.speakerUnknownDraft}
          hasUnsavedNote={detail.hasUnsavedNote}
          hasUnsavedMetadata={detail.hasUnsavedMetadata}
          hasUnsavedSessionDraft={detail.hasUnsavedSessionDraft}
          searchQuery={detail.searchQuery}
          filteredEntries={entries.filteredEntries}
          selectedEntries={entries.selectedEntries}
          checkedEntryIds={entries.checkedEntryIds}
          checkedEntryIdSet={entries.checkedEntryIdSet}
          allVisibleEntriesChecked={entries.allVisibleEntriesChecked}
          shouldOfferSplitExport={detail.shouldOfferSplitExport}
          exportTimeFrom={transfer.exportTimeFrom}
          exportTimeTo={transfer.exportTimeTo}
          editingEntryId={entries.editingEntryId}
          editingEntryText={entries.editingEntryText}
          editingEntrySpeakerLabel={entries.editingEntrySpeakerLabel}
          editingEntryNote={entries.editingEntryNote}
          editingEntryLabels={entries.editingEntryLabels}
          splitEntryId={entries.splitEntryId}
          splitDraft={entries.splitDraft}
          recentCopyLineCount={detail.recentCopyLineCount}
          txtExportSpeakerEnabled={detail.txtExportSpeakerEnabled}
          panelSpeakerHighlightEnabled={detail.panelSpeakerHighlightEnabled}
          runBusyHistoryAction={library.runBusyHistoryAction}
          setLineageViewEnabled={detail.setLineageViewEnabled}
          setNoteDraft={detail.setNoteDraft}
          setTagDraft={detail.setTagDraft}
          setCategoryDraft={detail.setCategoryDraft}
          setSpeakerPrimaryDraft={detail.setSpeakerPrimaryDraft}
          setSpeakerSecondaryDraft={detail.setSpeakerSecondaryDraft}
          setSpeakerUnknownDraft={detail.setSpeakerUnknownDraft}
          setSearchQuery={detail.setSearchQuery}
          setCheckedEntryIds={entries.setCheckedEntryIds}
          setExportTimeFrom={transfer.setExportTimeFrom}
          setExportTimeTo={transfer.setExportTimeTo}
          setEditingEntryText={entries.setEditingEntryText}
          setEditingEntrySpeakerLabel={entries.setEditingEntrySpeakerLabel}
          setEditingEntryNote={entries.setEditingEntryNote}
          setEditingEntryLabels={entries.setEditingEntryLabels}
          setSplitDraft={entries.setSplitDraft}
          handleToggleFavorite={library.handleToggleFavorite}
          handleReopen={transfer.handleReopen}
          handleDelete={library.handleDelete}
          handleSelectLineageSegment={handleSelectLineageSegment}
          handleSaveNote={detail.handleSaveNote}
          handleSaveSessionMetadata={detail.handleSaveSessionMetadata}
          discardUnsavedNoteDraft={detail.discardUnsavedNoteDraft}
          handleToggleVisibleEntries={entries.handleToggleVisibleEntries}
          handleCopy={transfer.handleCopy}
          handleExport={transfer.handleExport}
          handleSplitLineageExport={transfer.handleSplitLineageExport}
          handleToggleEntryChecked={entries.handleToggleEntryChecked}
          handleToggleEntryHighlight={entries.handleToggleEntryHighlight}
          handleSaveEntryEdit={entries.handleSaveEntryEdit}
          handleDeleteSelectedEntries={entries.handleDeleteSelectedEntries}
          handleMergeSelectedEntries={entries.handleMergeSelectedEntries}
          handleSplitSelectedEntry={entries.handleSplitSelectedEntry}
          handleSaveSplitEntry={entries.handleSaveSplitEntry}
          handleCancelSplitEntry={entries.handleCancelSplitEntry}
          beginEditEntry={entries.beginEditEntry}
          cancelEditEntry={entries.cancelEditEntry}
        />
      </section>
    </main>
  );
}
