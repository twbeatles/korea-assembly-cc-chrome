/**
 * History 우측 세션 상세 패널 (presentational).
 * 상태·핸들러는 App 조립 루트에 두고 UI 만 분리한다.
 */
import type { ExportFormat, SessionRecord, SubtitleEntry } from "../../../core/subtitle-models";
import type { SessionLineageSummary } from "../../../storage/types";
import { SESSION_NOTE_MAX_LENGTH } from "../../../storage/session-store";
import { getExportFormatLabel } from "../../../shared/ui-labels";
import {
  EXPORT_FORMATS,
  canReopenSourceUrl,
  formatDate,
  getSessionSegmentLabel,
  resolveSpeakerLabel,
} from "../helpers";
import {
  formatSpeakerBadge,
  resolveSpeakerAccentColor,
} from "../../../core/exporters/speaker-label";
import { buildCopyText } from "../../../shared/copy-utils";

export interface SessionDetailPanelProps {
  selectedSession: SessionRecord | null;
  displaySession: SessionRecord | null;
  selectedLineageId: string;
  selectedLineageSummary: SessionLineageSummary | null;
  availableLineageSessions: SessionRecord[];
  lineageAggregateSession: SessionRecord | null;
  hasLineageSegments: boolean;
  showingLineageView: boolean;
  shouldShowSelectedSegmentLabel: boolean;
  lineageLoading: boolean;
  selectedEstimatedBytes: number;
  totalSessionCount: number;
  showStarredOnly: boolean;
  actionButtonsDisabled: boolean;
  noteDraft: string;
  tagDraft: string;
  categoryDraft: string;
  speakerPrimaryDraft: string;
  speakerSecondaryDraft: string;
  speakerUnknownDraft: string;
  hasUnsavedNote: boolean;
  hasUnsavedMetadata: boolean;
  hasUnsavedSessionDraft: boolean;
  searchQuery: string;
  filteredEntries: SubtitleEntry[];
  selectedEntries: SubtitleEntry[];
  checkedEntryIds: string[];
  checkedEntryIdSet: Set<string>;
  allVisibleEntriesChecked: boolean;
  shouldOfferSplitExport: boolean;
  exportTimeFrom: string;
  exportTimeTo: string;
  editingEntryId: string;
  editingEntryText: string;
  editingEntrySpeakerLabel: string;
  editingEntryNote: string;
  editingEntryLabels: string;
  splitEntryId: string;
  splitDraft: string;
  recentCopyLineCount: number;
  txtExportSpeakerEnabled: boolean;
  panelSpeakerHighlightEnabled: boolean;
  runBusyHistoryAction: (
    actionLabel: string,
    action: () => Promise<void>,
    fallbackMessage: string,
    busyMessage?: string,
  ) => void;
  setLineageViewEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setNoteDraft: React.Dispatch<React.SetStateAction<string>>;
  setTagDraft: React.Dispatch<React.SetStateAction<string>>;
  setCategoryDraft: React.Dispatch<React.SetStateAction<string>>;
  setSpeakerPrimaryDraft: React.Dispatch<React.SetStateAction<string>>;
  setSpeakerSecondaryDraft: React.Dispatch<React.SetStateAction<string>>;
  setSpeakerUnknownDraft: React.Dispatch<React.SetStateAction<string>>;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  setCheckedEntryIds: React.Dispatch<React.SetStateAction<string[]>>;
  setExportTimeFrom: React.Dispatch<React.SetStateAction<string>>;
  setExportTimeTo: React.Dispatch<React.SetStateAction<string>>;
  setEditingEntryText: React.Dispatch<React.SetStateAction<string>>;
  setEditingEntrySpeakerLabel: React.Dispatch<React.SetStateAction<string>>;
  setEditingEntryNote: React.Dispatch<React.SetStateAction<string>>;
  setEditingEntryLabels: React.Dispatch<React.SetStateAction<string>>;
  setSplitDraft: React.Dispatch<React.SetStateAction<string>>;
  handleToggleFavorite: (lineage: SessionLineageSummary) => Promise<void>;
  handleReopen: () => Promise<void>;
  handleDelete: () => Promise<void>;
  handleSelectLineageSegment: (sessionId: string) => void;
  handleSaveNote: () => Promise<void>;
  handleSaveSessionMetadata: () => Promise<void>;
  discardUnsavedNoteDraft: () => void;
  handleToggleVisibleEntries: () => void;
  handleCopy: (text: string, successMessage: string) => Promise<void>;
  handleExport: (format: ExportFormat, entries?: SubtitleEntry[]) => Promise<void>;
  handleSplitLineageExport: (format: ExportFormat) => Promise<void>;
  handleToggleEntryChecked: (entryId: string) => void;
  handleToggleEntryHighlight: (entryId: string) => Promise<void>;
  handleSaveEntryEdit: () => Promise<void>;
  handleDeleteSelectedEntries: () => Promise<void>;
  handleMergeSelectedEntries: () => Promise<void>;
  handleSplitSelectedEntry: () => void | Promise<void>;
  handleSaveSplitEntry: () => Promise<void>;
  handleCancelSplitEntry: () => void;
  beginEditEntry: (entry: SubtitleEntry) => void;
  cancelEditEntry: () => void;
}

export function SessionDetailPanel(props: SessionDetailPanelProps) {
  const {
    selectedSession,
    displaySession,
    selectedLineageId,
    selectedLineageSummary,
    availableLineageSessions,
    lineageAggregateSession,
    hasLineageSegments,
    showingLineageView,
    shouldShowSelectedSegmentLabel,
    lineageLoading,
    selectedEstimatedBytes,
    totalSessionCount,
    showStarredOnly,
    actionButtonsDisabled,
    noteDraft,
    tagDraft,
    categoryDraft,
    speakerPrimaryDraft,
    speakerSecondaryDraft,
    speakerUnknownDraft,
    hasUnsavedNote,
    hasUnsavedMetadata,
    hasUnsavedSessionDraft,
    searchQuery,
    filteredEntries,
    selectedEntries,
    checkedEntryIds,
    checkedEntryIdSet,
    allVisibleEntriesChecked,
    shouldOfferSplitExport,
    exportTimeFrom,
    exportTimeTo,
    editingEntryId,
    editingEntryText,
    editingEntrySpeakerLabel,
    editingEntryNote,
    editingEntryLabels,
    splitEntryId,
    splitDraft,
    recentCopyLineCount,
    txtExportSpeakerEnabled,
    panelSpeakerHighlightEnabled,
    runBusyHistoryAction,
    setLineageViewEnabled,
    setNoteDraft,
    setTagDraft,
    setCategoryDraft,
    setSpeakerPrimaryDraft,
    setSpeakerSecondaryDraft,
    setSpeakerUnknownDraft,
    setSearchQuery,
    setCheckedEntryIds,
    setExportTimeFrom,
    setExportTimeTo,
    setEditingEntryText,
    setEditingEntrySpeakerLabel,
    setEditingEntryNote,
    setEditingEntryLabels,
    setSplitDraft,
    handleToggleFavorite,
    handleReopen,
    handleDelete,
    handleSelectLineageSegment,
    handleSaveNote,
    handleSaveSessionMetadata,
    discardUnsavedNoteDraft,
    handleToggleVisibleEntries,
    handleCopy,
    handleExport,
    handleSplitLineageExport,
    handleToggleEntryChecked,
    handleToggleEntryHighlight,
    handleSaveEntryEdit,
    handleDeleteSelectedEntries,
    handleMergeSelectedEntries,
    handleSplitSelectedEntry,
    handleSaveSplitEntry,
    handleCancelSplitEntry,
    beginEditEntry,
    cancelEditEntry,
  } = props;

  return (
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
                        `favorite_${selectedLineageId}`,
                        () =>
                          selectedLineageSummary
                            ? handleToggleFavorite(selectedLineageSummary)
                            : Promise.resolve(undefined),
                        "즐겨찾기 저장에 실패했습니다.",
                        selectedLineageSummary?.starred
                          ? "즐겨찾기 해제를 저장하고 있습니다."
                          : "즐겨찾기를 저장하고 있습니다.",
                      )
                    }
                    disabled={actionButtonsDisabled}
                  >
                    {selectedLineageSummary?.starred ? "즐겨찾기 해제" : "즐겨찾기 추가"}
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
                <div>
                  <dt>추정 크기</dt>
                  <dd>
                    {selectedEstimatedBytes.toLocaleString("ko-KR")} bytes
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
                    disabled={actionButtonsDisabled || noteDraft === (selectedLineageSummary?.note ?? selectedSession.note)}
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
                  placeholder={showingLineageView ? "연속 캡처 전체에서 내용 찾기" : "이 기록 안에서 내용 찾기"}
                />
                <span>
                  {filteredEntries.length} / {displaySession?.entries.length ?? 0}개
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
                        buildCopyText(displaySession?.entries ?? [], {
                          selectedIds: checkedEntryIds,
                          includeSpeaker: txtExportSpeakerEnabled,
                          session: displaySession,
                        }),
                        `${showingLineageView ? "연속 캡처 전체에서 " : ""}선택한 ${selectedEntries.length}줄을 복사했습니다.`,
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
                        () => Promise.resolve(handleSplitSelectedEntry()),
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

              <p className="section-heading">
                내보내기 {showingLineageView ? "(연속 캡처 전체)" : "(현재 세그먼트)"}
              </p>
              <div className="export-group">
                <div className="export-time-range">
                  <label>
                    시작 시각
                    <input
                      type="datetime-local"
                      value={exportTimeFrom}
                      onChange={(event) => setExportTimeFrom(event.target.value)}
                      disabled={actionButtonsDisabled}
                      step={1}
                    />
                  </label>
                  <label>
                    종료 시각
                    <input
                      type="datetime-local"
                      value={exportTimeTo}
                      onChange={(event) => setExportTimeTo(event.target.value)}
                      disabled={actionButtonsDisabled}
                      step={1}
                    />
                  </label>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      setExportTimeFrom("");
                      setExportTimeTo("");
                    }}
                    disabled={
                      actionButtonsDisabled || (!exportTimeFrom && !exportTimeTo)
                    }
                  >
                    시간 범위 지우기
                  </button>
                </div>
                <p className="settings-section-note">
                  비워 두면 전체 구간을 내보냅니다. 선택 항목 내보내기에도 같은 시간 필터가
                  적용됩니다.
                </p>
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

                {shouldOfferSplitExport ? (
                  <div className="warning-box">
                    이 연속 캡처는 예상 내보내기 크기가 커서 브라우저 다운로드 제한에 걸릴 수 있습니다. 분할 저장을 사용하면 세그먼트별 파일로 저장합니다.
                  </div>
                ) : null}

                {showingLineageView ? (
                  <div className="export-row partial-export-row">
                    {EXPORT_FORMATS.map((format) => (
                      <button
                        key={`split_${format}`}
                        className="secondary"
                        onClick={() =>
                          runBusyHistoryAction(
                            `split_export_${format}`,
                            () => handleSplitLineageExport(format),
                            `분할 ${format.toUpperCase()} 저장을 시작하지 못했습니다.`,
                            `분할 ${format.toUpperCase()} 저장을 준비하고 있습니다.`,
                          )
                        }
                        disabled={actionButtonsDisabled || !hasLineageSegments}
                      >
                        분할 {format.toUpperCase()}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <p className="section-heading">
                복사 {showingLineageView ? "(연속 캡처 전체)" : "(현재 세그먼트)"}
              </p>
              <div className="copy-row">
                <button
                  onClick={() =>
                    void handleCopy(
                      buildCopyText(displaySession?.entries ?? [], {
                        limit: recentCopyLineCount,
                        includeSpeaker: txtExportSpeakerEnabled,
                        session: displaySession,
                      }),
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
                      buildCopyText(displaySession?.entries ?? [], {
                        query: searchQuery,
                        includeSpeaker: txtExportSpeakerEnabled,
                        session: displaySession,
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
                      buildCopyText(displaySession?.entries ?? [], {
                        includeSpeaker: txtExportSpeakerEnabled,
                        session: displaySession,
                      }),
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
                      <article
                        className={[
                          "entry-card",
                          panelSpeakerHighlightEnabled
                            ? `speaker-highlight speaker-${entry.speakerChannel ?? "unknown"}`
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        style={
                          panelSpeakerHighlightEnabled
                            ? {
                                borderLeftColor:
                                  resolveSpeakerAccentColor(
                                    entry.speakerColor,
                                    entry.speakerChannel,
                                  ) || undefined,
                              }
                            : undefined
                        }
                      >
                        <time>
                          {panelSpeakerHighlightEnabled ? (
                            <span
                              className="speaker-badge"
                              aria-hidden="true"
                            >
                              {formatSpeakerBadge(entry.speakerChannel)}
                            </span>
                          ) : null}
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
  );
}
