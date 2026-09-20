/** 패널 셸/레이아웃(패널, 헤더, 스크롤) — PANEL_STYLE 분할 파트. */
export const shellStyle = `  .panel {
    width: min(520px, calc(100vw - 24px));
    height: calc(100vh - 24px);
    display: flex;
    flex-direction: column;
    gap: 12px;
    box-sizing: border-box;
    padding: 14px;
    overflow: hidden;
    border-radius: var(--radius-lg);
    border: 1px solid rgba(255, 255, 255, 0.6);
    background:
      radial-gradient(circle at top right, rgba(24, 119, 182, 0.16), transparent 38%),
      linear-gradient(180deg, rgba(251, 253, 255, 0.99), rgba(240, 246, 252, 0.99));
    box-shadow: var(--shadow-panel);
  }

  .collapsed-tab {
    writing-mode: vertical-rl;
    text-orientation: mixed;
    min-height: 156px;
    border: 0;
    border-radius: 18px 0 0 18px;
    background: var(--navy-800);
    color: #ffffff;
    font: inherit;
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.03em;
    cursor: pointer;
    padding: 14px 10px;
    box-shadow: 0 18px 34px rgba(17, 44, 82, 0.22);
    margin-left: auto;
    display: none;
  }

  .collapsed .panel {
    display: none;
  }

  .collapsed .collapsed-tab {
    display: block;
  }

  .header,
  .header-actions,
  .action-row,
  .footer-actions,
  .section-header,
  .section-meta,
  .preview-header,
  .stat-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .header,
  .footer-actions,
  .section-header,
  .preview-header {
    justify-content: space-between;
  }

  .header {
    flex-shrink: 0;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--line-soft);
  }

  .panel-scroll {
    min-height: 0;
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 12px;
    overflow: auto;
    overscroll-behavior: contain;
    padding-right: 2px;
    scrollbar-gutter: stable both-edges;
  }

  .header-actions {
    flex-wrap: nowrap;
  }

  .action-row {
    flex-wrap: wrap;
  }
`;
