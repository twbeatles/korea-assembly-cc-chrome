/** 패널 셸/레이아웃(패널, 헤더, 스크롤) — PANEL_STYLE 분할 파트. */
export const shellStyle = `  .panel {
    width: min(400px, calc(100vw - 24px));
    height: calc(100vh - 24px);
    display: flex;
    flex-direction: column;
    gap: 10px;
    box-sizing: border-box;
    padding: 12px;
    overflow: hidden;
    border-radius: var(--radius-lg);
    border: 1px solid var(--line-strong);
    background: #fbfcfe;
    box-shadow: var(--shadow-panel);
  }

  .collapsed-tab {
    writing-mode: vertical-rl;
    text-orientation: mixed;
    min-height: 96px;
    border: 0;
    border-radius: 10px 0 0 10px;
    background: var(--navy-800);
    color: #ffffff;
    font: inherit;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.03em;
    cursor: pointer;
    padding: 10px 7px;
    box-shadow: 0 8px 20px rgba(17, 44, 82, 0.22);
    margin-left: auto;
    margin-right: -12px;
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
  .section-header,
  .preview-header {
    justify-content: space-between;
  }

  .header {
    flex-shrink: 0;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--line-soft);
  }

  .panel-scroll {
    min-height: 0;
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 8px;
    overflow: auto;
    overscroll-behavior: contain;
  }

  .header-actions {
    flex-wrap: nowrap;
  }
`;
