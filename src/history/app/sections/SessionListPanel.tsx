/**
 * History 좌측 세션(lineage) 목록 패널
 */
import type { SessionLineageSummary } from "../../../storage/types";
import { getPersistedStatusLabel } from "../../../shared/ui-labels";
import { formatDate } from "../helpers";
import { HISTORY_PAGE_SIZE } from "../helpers";

export interface SessionListPanelProps {
  pageLineages: SessionLineageSummary[];
  totalSessionCount: number;
  checkedIds: string[];
  checkedIdSet: Set<string>;
  selectedLineageId: string;
  sessionPage: number;
  pageCount: number;
  currentPageSessionsChecked: boolean;
  showStarredOnly: boolean;
  actionButtonsDisabled: boolean;
  onToggleCheckAll: () => void;
  onToggleChecked: (lineageId: string) => void;
  onSelectSession: (lineageId: string) => void;
  onToggleFavorite: (lineage: SessionLineageSummary) => void | Promise<void>;
  onDeleteChecked: () => void;
  onDeleteAll: () => void;
  onPageChange: (page: number) => void;
  runBusy: (
    actionLabel: string,
    action: () => Promise<void>,
    fallbackMessage: string,
    busyMessage?: string,
  ) => void;
}

export function SessionListPanel(props: SessionListPanelProps) {
  const {
    pageLineages,
    totalSessionCount,
    checkedIds,
    checkedIdSet,
    selectedLineageId,
    sessionPage,
    pageCount,
    currentPageSessionsChecked,
    showStarredOnly,
    actionButtonsDisabled,
    onToggleCheckAll,
    onToggleChecked,
    onSelectSession,
    onToggleFavorite,
    onDeleteChecked,
    onDeleteAll,
    onPageChange,
    runBusy,
  } = props;

  return (
    <aside className="session-list">
      <div className="session-list-toolbar">
        <span>
          현재 필터 {totalSessionCount}개 / 현재 페이지 {pageLineages.length}개 / 선택{" "}
          {checkedIds.length}개
        </span>
        <div className="session-list-actions">
          <button
            className="secondary"
            onClick={onToggleCheckAll}
            disabled={actionButtonsDisabled || !pageLineages.length}
          >
            {currentPageSessionsChecked
              ? "현재 페이지 선택 해제"
              : "현재 페이지 전체 선택"}
          </button>
          <button
            className="secondary"
            onClick={onDeleteChecked}
            disabled={actionButtonsDisabled || !checkedIds.length}
          >
            선택 삭제
          </button>
          <button
            className="secondary"
            onClick={onDeleteAll}
            disabled={actionButtonsDisabled || !totalSessionCount}
          >
            전체 삭제
          </button>
        </div>
      </div>
      {pageLineages.length ? (
        pageLineages.map((lineage) => (
          <div key={lineage.lineageId} className="session-item-row">
            <label className="session-check">
              <input
                type="checkbox"
                checked={checkedIdSet.has(lineage.lineageId)}
                onChange={() => onToggleChecked(lineage.lineageId)}
                disabled={actionButtonsDisabled}
                aria-label={`${lineage.committeeName || lineage.title} 선택`}
              />
            </label>
            <button
              type="button"
              className={`favorite-toggle ${lineage.starred ? "active" : ""}`}
              onClick={() =>
                runBusy(
                  `favorite_${lineage.lineageId}`,
                  async () => {
                    await onToggleFavorite(lineage);
                  },
                  "즐겨찾기 저장에 실패했습니다.",
                  lineage.starred
                    ? "즐겨찾기 해제를 저장하고 있습니다."
                    : "즐겨찾기를 저장하고 있습니다.",
                )
              }
              disabled={actionButtonsDisabled}
              aria-label={
                lineage.starred
                  ? `${lineage.committeeName || lineage.title} 즐겨찾기 해제`
                  : `${lineage.committeeName || lineage.title} 즐겨찾기 추가`
              }
            >
              {lineage.starred ? "★" : "☆"}
            </button>
            <button
              className={`session-item ${selectedLineageId === lineage.lineageId ? "active" : ""}`}
              onClick={() => onSelectSession(lineage.lineageId)}
              disabled={actionButtonsDisabled}
            >
              <div className="session-item-heading">
                <strong>{lineage.committeeName || lineage.title}</strong>
                {lineage.segmentCount > 1 ? (
                  <span className="segment-badge">세그먼트 {lineage.segmentCount}개</span>
                ) : null}
              </div>
              <span>{formatDate(lineage.startedAt)}</span>
              <span>
                {lineage.subtitleCount}문장 / {lineage.charCount}자
              </span>
              <small>{getPersistedStatusLabel(lineage.status)}</small>
              {lineage.note.trim() ? <small>메모 있음</small> : null}
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
            onClick={() => onPageChange(Math.max(1, sessionPage - 1))}
            disabled={actionButtonsDisabled || sessionPage <= 1}
          >
            이전 페이지
          </button>
          <span>
            {sessionPage} / {pageCount}
          </span>
          <button
            className="secondary"
            onClick={() => onPageChange(Math.min(pageCount, sessionPage + 1))}
            disabled={actionButtonsDisabled || sessionPage >= pageCount}
          >
            다음 페이지
          </button>
        </div>
      ) : null}
    </aside>
  );
}
