/** 실시간 미리보기/자막 행/알림 — PANEL_STYLE 분할 파트. */
export const liveStyle = `  .preview-box,
  .live-row-list {
    border-radius: 16px;
    background: #f2f6fb;
    border: 1px solid rgba(20, 54, 90, 0.06);
  }

  .live-row-shell {
    position: relative;
    flex: 1 1 auto;
    min-height: 250px;
    display: flex;
  }

  .preview-box {
    overflow: hidden;
    flex-shrink: 0;
    height: 72px;
    min-height: 0;
    opacity: 1;
    transition:
      height 180ms ease,
      opacity 180ms ease,
      border-color 180ms ease;
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
    scrollbar-gutter: stable both-edges;
    padding: 14px 16px;
    font-size: 13px;
    font-weight: 500;
    line-height: 1.55;
    white-space: pre-wrap;
    color: #18344f;
  }

  .live-row-list {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    overflow: auto;
    scrollbar-gutter: stable both-edges;
    min-height: 250px;
    background: linear-gradient(180deg, #f8fbff, #edf4fb);
  }

  .scroll-jump {
    position: absolute;
    right: 16px;
    bottom: 16px;
    z-index: 1;
    width: 44px;
    min-width: 44px;
    height: 44px;
    min-height: 44px;
    padding: 0;
    border-radius: 999px;
    background: rgba(23, 63, 110, 0.96);
    color: #ffffff;
    font-size: 22px;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 14px 24px rgba(17, 44, 82, 0.28);
  }

  .scroll-jump[hidden] {
    display: none;
  }

  .live-row {
    padding: 12px 14px;
    border-radius: 14px;
    background: #ffffff;
    border: 1px solid var(--line-soft);
    box-shadow: 0 10px 18px rgba(20, 54, 90, 0.06);
  }

  .live-row.speaker-highlight {
    border-left-width: 4px;
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
    display: block;
    margin-bottom: 4px;
    color: var(--navy-400);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .live-row .speaker-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.4em;
    margin: 0 0 6px;
    padding: 1px 7px;
    border-radius: 999px;
    background: rgba(20, 54, 90, 0.08);
    color: var(--navy-700, #1f3b57);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.02em;
    line-height: 1.4;
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
    margin: 0;
    color: var(--ink-900);
    font-size: 17px;
    font-weight: 600;
    line-height: 1.7;
  }

  .empty-text {
    margin: 0;
    min-height: 180px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 10px;
    text-align: center;
    color: #35536e;
    font-size: 16px;
    font-weight: 700;
    line-height: 1.7;
  }

  .section-count {
    padding: 6px 10px;
    background: #e8f0fa;
    color: var(--navy-600);
  }

  .notice {
    box-sizing: border-box;
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    background: rgba(227, 236, 247, 0.72);
    border: 1px solid var(--line-soft);
    font-size: 12px;
    color: var(--ink-500);
    line-height: 1.5;
    flex-shrink: 0;
  }

  .notice[hidden] {
    display: none;
  }
`;
