/** 헤더/타이틀/상태/통계 — PANEL_STYLE 분할 파트. */
export const headerStyle = `  .eyebrow {
    margin: 0 0 4px;
    color: var(--navy-400);
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .title-group h1,
  .section-header h2,
  .preview-copy h2 {
    margin: 0;
  }

  .title-group h1 {
    font-size: 18px;
    letter-spacing: -0.005em;
  }

  .title-group p:last-child,
  .section-copy p,
  .preview-copy p {
    margin: 4px 0 0;
    color: var(--navy-500);
    font-size: 12px;
    line-height: 1.45;
  }

  .status-badge,
  .header-count,
  .mode-badge,
  .section-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 700;
    line-height: 1;
  }

  .status-badge {
    min-width: 64px;
    padding: 6px 10px;
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
    animation: status-running-pulse 2.2s ease-in-out infinite;
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
    0%, 100% { box-shadow: 0 0 0 0 rgba(24, 95, 42, 0.32); }
    50% { box-shadow: 0 0 0 6px rgba(24, 95, 42, 0); }
  }

  .header-count {
    padding: 6px 10px;
    background: var(--tint-200);
    color: var(--navy-500);
  }

  .mode-badge {
    padding: 5px 10px;
    background: var(--tint-200);
    color: var(--navy-600);
  }

  .stat-row {
    flex-wrap: wrap;
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    background: rgba(255, 255, 255, 0.7);
    border: 1px solid var(--line-soft);
    flex-shrink: 0;
  }

  .stat {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1 1 78px;
    min-width: 70px;
  }

  .stat-label {
    font-size: 10px;
    color: var(--navy-400);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .stat-value {
    font-size: 14px;
    font-weight: 700;
    color: var(--ink-700);
  }

  .stat + .stat {
    border-left: 1px solid var(--line-soft);
    padding-left: 10px;
  }
`;
