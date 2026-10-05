/** 헤더/타이틀/상태/통계 — PANEL_STYLE 분할 파트. */
export const headerStyle = `  .title-group h1,
  .section-header h2,
  .preview-copy h2 {
    margin: 0;
  }

  .title-group {
    min-width: 0;
  }

  .title-group h1 {
    font-size: 14px;
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .status-badge,
  .mode-badge,
  .section-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 700;
    line-height: 1;
    white-space: nowrap;
  }

  .status-badge {
    padding: 5px 9px;
    background: var(--tint-300);
    color: var(--navy-700);
    gap: 5px;
  }

  .status-badge::before {
    content: "";
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: currentColor;
    opacity: 0.7;
  }

  .status-badge.running {
    background: #dff4e2;
    color: #185f2a;
  }

  .status-badge.running::before {
    opacity: 1;
    animation: status-running-pulse 1.8s ease-in-out infinite;
  }

  .status-badge.stopped {
    background: #fff0d5;
    color: #8c5200;
  }

  .status-badge.error {
    background: #ffe0df;
    color: #9b211b;
  }

  @keyframes status-running-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  @media (prefers-reduced-motion: reduce) {
    .status-badge.running::before {
      animation: none;
    }
  }

  .mode-badge[hidden] {
    display: none;
  }

  .mode-badge,
  .section-count {
    padding: 4px 8px;
    background: var(--tint-200);
    color: var(--navy-600);
  }

  .stat-row {
    flex-wrap: wrap;
    flex-shrink: 0;
    gap: 4px 12px;
    font-size: 12px;
    color: var(--navy-500);
  }

  .stat {
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
  }

  .stat-value {
    font-weight: 700;
    color: var(--ink-700);
    font-variant-numeric: tabular-nums;
  }
`;
