/**
 * History 상단 히어로: 제목, 새로고침/필터/백업, 장기 작업 상태, 검색
 */
import type { HistoryLongTaskState } from "../helpers";
import { getLongTaskPhaseLabel } from "../helpers";

export interface HistoryHeroProps {
  heroMessage: string;
  longTask: HistoryLongTaskState | null;
  longTaskProgressLabel: string | null;
  showStarredOnly: boolean;
  showHighlightedOnly: boolean;
  actionButtonsDisabled: boolean;
  jsonTaskButtonsDisabled: boolean;
  hasUnsavedSessionDraft: boolean;
  globalSearchQuery: string;
  tagFilter: string;
  categoryFilter: string;
  importInputRef: React.RefObject<HTMLInputElement | null> | React.MutableRefObject<HTMLInputElement | null>;
  onRefresh: () => void;
  onToggleStarredOnly: () => void;
  onBackupAll: () => void;
  onImportClick: () => void;
  onCancelLongTask: () => void;
  onGlobalSearchChange: (value: string) => void;
  onTagFilterChange: (value: string) => void;
  onCategoryFilterChange: (value: string) => void;
  onToggleHighlightedOnly: () => void;
  onImportChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

export function HistoryHero(props: HistoryHeroProps) {
  const {
    heroMessage,
    longTask,
    longTaskProgressLabel,
    showStarredOnly,
    showHighlightedOnly,
    actionButtonsDisabled,
    jsonTaskButtonsDisabled,
    globalSearchQuery,
    tagFilter,
    categoryFilter,
    importInputRef,
    onRefresh,
    onToggleStarredOnly,
    onBackupAll,
    onImportClick,
    onCancelLongTask,
    onGlobalSearchChange,
    onTagFilterChange,
    onCategoryFilterChange,
    onToggleHighlightedOnly,
    onImportChange,
  } = props;

  return (
    <header className="hero">
      <div>
        <p className="eyebrow">기록 보기</p>
        <h1>저장된 자막 기록</h1>
      </div>
      <div className="hero-actions">
        <button onClick={onRefresh} disabled={actionButtonsDisabled}>
          목록 새로고침
        </button>
        <button
          className={`secondary ${showStarredOnly ? "active-toggle" : ""}`}
          onClick={onToggleStarredOnly}
          disabled={actionButtonsDisabled}
        >
          {showStarredOnly ? "전체 보기" : "즐겨찾기만 보기"}
        </button>
        <button
          className="secondary"
          onClick={onBackupAll}
          disabled={jsonTaskButtonsDisabled}
        >
          전체 JSON 백업
        </button>
        <button
          className="secondary"
          onClick={onImportClick}
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
              onClick={onCancelLongTask}
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
          onChange={(event) => onGlobalSearchChange(event.target.value)}
          placeholder="전체 기록에서 제목, 메모, 자막 찾기"
        />
        <input
          className="search-input"
          type="search"
          value={tagFilter}
          onChange={(event) => onTagFilterChange(event.target.value)}
          placeholder="태그 필터"
        />
        <input
          className="search-input"
          type="search"
          value={categoryFilter}
          onChange={(event) => onCategoryFilterChange(event.target.value)}
          placeholder="카테고리 필터"
        />
        <button
          className={`secondary ${showHighlightedOnly ? "active-toggle" : ""}`}
          onClick={onToggleHighlightedOnly}
          disabled={actionButtonsDisabled}
        >
          {showHighlightedOnly ? "전체 자막 보기" : "중요 표시만"}
        </button>
      </div>
      <input
        ref={importInputRef as React.Ref<HTMLInputElement>}
        className="hidden-file-input"
        type="file"
        accept=".json,application/json"
        disabled={jsonTaskButtonsDisabled}
        onChange={onImportChange}
      />
    </header>
  );
}
