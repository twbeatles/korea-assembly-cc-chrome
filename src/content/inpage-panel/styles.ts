export const PANEL_STYLE = `
  :host {
    all: initial;
  }

  .host {
    --navy-900: #0f2a4a;
    --navy-800: #173f6e;
    --navy-700: #214568;
    --navy-600: #2e526f;
    --navy-500: #4d6580;
    --navy-400: #5a7088;
    --ink-900: #10263c;
    --ink-700: #18344f;
    --ink-500: #314b66;
    --tint-100: #f2f6fb;
    --tint-200: #eef3f9;
    --tint-300: #dfe8f4;
    --tint-400: #c6d4e6;
    --line-soft: rgba(20, 54, 90, 0.08);
    --line-strong: rgba(20, 54, 90, 0.14);
    --shadow-card: 0 12px 30px rgba(17, 44, 82, 0.12);
    --shadow-panel: 0 28px 60px rgba(17, 44, 82, 0.24);
    --radius-lg: 22px;
    --radius-md: 16px;
    --radius-sm: 12px;
    position: fixed;
    top: 12px;
    right: 12px;
    z-index: 2147483646;
    font-family: "Noto Sans KR", "Pretendard", "Malgun Gothic", sans-serif;
    color: var(--ink-900);
  }

  .panel {
    width: min(640px, calc(100vw - 24px));
    height: calc(100vh - 24px);
    display: flex;
    flex-direction: column;
    gap: 12px;
    box-sizing: border-box;
    padding: 16px 16px 14px;
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

  .eyebrow {
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

  .hero-card,
  .controls-card {
    border-radius: var(--radius-md);
    background: rgba(255, 255, 255, 0.62);
    border: 1px solid rgba(255, 255, 255, 0.7);
    box-shadow: var(--shadow-card);
    padding: 14px;
  }

  .hero-card {
    display: flex;
    flex-direction: column;
    flex: 1 0 auto;
    min-height: min(520px, calc(100vh - 300px));
    gap: 14px;
    overflow: hidden;
  }

  .controls-card {
    display: grid;
    gap: 12px;
    flex-shrink: 0;
  }

  .controls-card .group {
    display: grid;
    gap: 8px;
  }

  .controls-card .group + .group {
    padding-top: 12px;
    border-top: 1px dashed var(--line-soft);
  }

  .group-label {
    font-size: 10px;
    color: var(--navy-400);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    font-weight: 700;
  }

  .section-header,
  .preview-header {
    flex-shrink: 0;
  }

  .section-header.primary {
    align-items: flex-start;
    gap: 12px;
  }

  .speaker-toggle-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0 0 2px;
  }

  .speaker-toggle {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin: 0;
    padding: 3px 8px;
    border-radius: 999px;
    border: 1px solid var(--line-soft);
    background: rgba(255, 255, 255, 0.72);
    color: var(--navy-600, #35536e);
    font-size: 11px;
    font-weight: 600;
    line-height: 1.3;
    cursor: pointer;
    user-select: none;
  }

  .speaker-toggle:has(input:checked) {
    border-color: rgba(35, 124, 147, 0.45);
    background: rgba(35, 124, 147, 0.1);
    color: #17657a;
  }

  .speaker-toggle-input {
    width: 12px;
    height: 12px;
    margin: 0;
    accent-color: #237c93;
    cursor: pointer;
  }

  .section-copy,
  .preview-copy {
    min-width: 0;
  }

  .section-copy h2 {
    font-size: 24px;
    line-height: 1.15;
  }

  .preview-copy h2 {
    font-size: 13px;
    line-height: 1.2;
    color: var(--navy-600);
  }

  .section-copy p {
    max-width: 36ch;
  }

  .section-meta {
    min-width: 0;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .preview-section {
    display: flex;
    flex-direction: column;
    flex: 0 0 auto;
    gap: 8px;
    margin-top: 10px;
    padding: 10px 12px 12px;
    border-radius: 12px;
    background: linear-gradient(180deg, rgba(242, 246, 251, 0.94), rgba(235, 242, 249, 0.82));
    border: 1px solid rgba(20, 54, 90, 0.06);
  }

  .preview-header {
    align-items: flex-start;
    gap: 12px;
  }

  .preview-copy p {
    max-width: 32ch;
  }

  .preview-toggle {
    flex: 0 0 auto;
    white-space: nowrap;
    padding-inline: 14px;
  }

  .preview-box,
  .live-row-list {
    border-radius: 16px;
    background: #f2f6fb;
    border: 1px solid rgba(20, 54, 90, 0.06);
  }

  .live-row-shell {
    position: relative;
    flex: 1 1 auto;
    min-height: 320px;
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
    gap: 12px;
    padding: 14px;
    overflow: auto;
    scrollbar-gutter: stable both-edges;
    min-height: 320px;
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
    padding: 17px 18px;
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
    font-size: 21px;
    font-weight: 600;
    line-height: 1.7;
  }

  .empty-text {
    margin: 0;
    min-height: 240px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 10px;
    text-align: center;
    color: #35536e;
    font-size: 20px;
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

  .action-row button,
  .footer-actions button {
    flex: 1;
    min-width: 0;
  }

  .footer-actions {
    flex-wrap: wrap;
    flex-shrink: 0;
    padding-top: 10px;
    border-top: 1px solid var(--line-soft);
  }

  .footer-actions button {
    font-size: 12px;
    background: transparent;
    color: var(--navy-600);
    padding: 8px 10px;
    min-height: 36px;
  }

  .footer-actions button:hover:not(:disabled) {
    background: var(--tint-200);
    color: var(--navy-800);
  }

  .secondary-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .export-row {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 6px;
  }

  .export-row button {
    padding: 9px 4px;
    font-size: 12px;
    color: var(--ink-500);
    background: rgba(245, 248, 252, 0.92);
    border: 1px solid var(--line-soft);
    font-weight: 600;
  }

  .export-row button:hover:not(:disabled) {
    background: var(--tint-200);
    border-color: var(--line-strong);
  }

  /* Advanced actions: collapsible <details> */
  .advanced {
    border: 1px solid var(--line-soft);
    border-radius: var(--radius-sm);
    background: rgba(247, 250, 253, 0.7);
    overflow: hidden;
  }

  .advanced[open] {
    background: #ffffff;
  }

  .advanced summary {
    list-style: none;
    cursor: pointer;
    padding: 10px 12px;
    font-size: 12px;
    font-weight: 700;
    color: var(--navy-600);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    user-select: none;
  }

  .advanced summary::-webkit-details-marker {
    display: none;
  }

  .advanced summary::after {
    content: "▾";
    font-size: 11px;
    transition: transform 180ms ease;
    color: var(--navy-400);
  }

  .advanced[open] summary::after {
    transform: rotate(180deg);
  }

  .advanced-body {
    padding: 0 12px 12px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  button {
    border: 0;
    border-radius: var(--radius-sm);
    background: var(--navy-800);
    color: #ffffff;
    font: inherit;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    padding: 10px 12px;
    transition: background 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease;
  }

  button:hover:not(:disabled) {
    background: var(--navy-900);
    transform: translateY(-1px);
    box-shadow: 0 6px 14px rgba(15, 42, 74, 0.18);
  }

  .preview-toggle,
  button {
    min-height: 38px;
  }

  button.icon {
    width: auto;
    min-width: 0;
    padding: 7px 12px;
    font-size: 12px;
    min-height: 32px;
  }

  button.secondary {
    background: var(--tint-300);
    color: var(--ink-700);
  }

  button.secondary:hover:not(:disabled) {
    background: var(--tint-400);
    color: var(--navy-900);
  }

  button:disabled {
    cursor: not-allowed;
    opacity: 0.42;
    transform: none;
    box-shadow: none;
  }

  @media (max-width: 768px) {
    .host {
      top: 8px;
      right: 8px;
    }

    .panel {
      width: min(100vw - 16px, 100vw - 16px);
      max-height: calc(100vh - 16px);
      padding: 14px;
    }

    .preview-box {
      height: 84px;
    }

    .preview-scroll {
      font-size: 12px;
      padding: 12px 14px;
    }

    .preview-header,
    .section-header.primary {
      flex-direction: column;
      align-items: stretch;
    }

    .section-meta {
      justify-content: flex-start;
    }

    .live-row-shell,
    .live-row-list {
      min-height: 260px;
    }

    .live-row p,
    .empty-text {
      font-size: 17px;
    }
  }
`;
