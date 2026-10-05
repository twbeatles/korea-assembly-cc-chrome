/** 실시간 미리보기/자막 행/알림 — PANEL_STYLE 분할 파트. */
export const liveStyle = `  .preview-box,
  .live-row-list {
    border-radius: var(--radius-md);
    background: #ffffff;
    border: 1px solid var(--line-soft);
  }

  .live-row-shell {
    position: relative;
    flex: 1 1 0;
    min-height: 120px;
    display: flex;
  }

  .preview-box {
    overflow: hidden;
    flex-shrink: 0;
    height: 58px;
    min-height: 0;
    background: var(--tint-100);
    transition: height 160ms ease, opacity 160ms ease;
  }

  .preview-section.collapsed .preview-box {
    height: 0;
    opacity: 0;
    border-color: transparent;
  }

  .preview-section.collapsed .preview-scroll {
    padding-top: 0;
    padding-bottom: 0;
  }

  .preview-scroll {
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    overflow: auto;
    padding: 8px 10px;
    font-size: 12px;
    line-height: 1.5;
    white-space: pre-wrap;
    color: var(--ink-500);
  }

  .live-row-list {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    overflow: auto;
    min-height: 0;
  }

  .scroll-jump {
    position: absolute;
    right: 12px;
    bottom: 10px;
    z-index: 1;
    width: 32px;
    min-width: 32px;
    height: 32px;
    min-height: 32px;
    padding: 0;
    border-radius: 999px;
    font-size: 15px;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 6px 14px rgba(17, 44, 82, 0.25);
  }

  .scroll-jump[hidden] {
    display: none;
  }

  .live-row {
    padding: 8px 10px;
    border-bottom: 1px solid var(--line-soft);
  }

  .live-row:last-child {
    border-bottom: 0;
  }

  .live-row.speaker-highlight {
    border-left-width: 3px;
    border-left-style: solid;
  }

  .live-row.speaker-primary {
    border-left-color: #237c93;
  }

  .live-row.speaker-secondary {
    border-left-color: #1e1e1e;
  }

  .live-row.speaker-unknown {
    border-left-color: var(--line-soft);
  }

  .live-row time {
    margin-right: 6px;
    color: var(--navy-400);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .live-row .speaker-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.4em;
    padding: 0 6px;
    border-radius: 999px;
    background: rgba(20, 54, 90, 0.08);
    color: var(--navy-700);
    font-size: 10px;
    font-weight: 700;
    line-height: 1.5;
  }

  .live-row.speaker-primary .speaker-badge {
    background: rgba(35, 124, 147, 0.14);
    color: #17657a;
  }

  .live-row.speaker-secondary .speaker-badge {
    background: rgba(30, 30, 30, 0.1);
    color: #2a2a2a;
  }

  .live-row p {
    margin: 2px 0 0;
    color: var(--ink-900);
    font-size: 14px;
    line-height: 1.6;
    word-break: keep-all;
    overflow-wrap: anywhere;
  }

  .empty-text {
    margin: auto;
    padding: 16px;
    text-align: center;
    color: var(--navy-500);
    font-size: 13px;
    line-height: 1.6;
  }

  .notice {
    box-sizing: border-box;
    padding: 7px 10px;
    border-radius: var(--radius-sm);
    background: var(--tint-200);
    border-left: 3px solid var(--navy-400);
    font-size: 12px;
    color: var(--ink-500);
    line-height: 1.5;
    flex-shrink: 0;
  }

  .notice[hidden] {
    display: none;
  }
`;
