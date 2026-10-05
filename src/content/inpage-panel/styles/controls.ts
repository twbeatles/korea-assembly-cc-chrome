/** 푸터/캡처/내보내기/버튼 — PANEL_STYLE 분할 파트. */
export const controlsStyle = `  .action-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }

  .action-grid .stop-action {
    background: #8c5200;
  }

  .action-grid .stop-action:hover:not(:disabled) {
    background: #713f00;
  }

  .export-details,
  .advanced {
    border-top: 1px solid var(--line-soft);
  }

  .export-details summary,
  .advanced summary {
    cursor: pointer;
    padding: 6px 2px;
    color: var(--navy-600);
    font-size: 12px;
    font-weight: 600;
    user-select: none;
  }

  .export-row {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 4px;
    padding-bottom: 6px;
  }

  .advanced-body {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    padding-bottom: 6px;
  }

  .footer-actions {
    flex-shrink: 0;
    justify-content: center;
    gap: 2px;
    padding-top: 6px;
    border-top: 1px solid var(--line-soft);
  }

  button {
    border: 0;
    border-radius: var(--radius-sm);
    background: var(--navy-800);
    color: #ffffff;
    font: inherit;
    font-size: 12.5px;
    font-weight: 700;
    cursor: pointer;
    padding: 8px 10px;
    min-height: 34px;
    transition: background 0.15s ease;
  }

  button[hidden] {
    display: none;
  }

  button:hover:not(:disabled) {
    background: var(--navy-900);
  }

  button:focus-visible,
  summary:focus-visible,
  input:focus-visible {
    outline: 2px solid #2f7fd1;
    outline-offset: 2px;
  }

  button.secondary,
  .export-row button {
    background: var(--tint-300);
    color: var(--ink-700);
  }

  button.secondary:hover:not(:disabled),
  .export-row button:hover:not(:disabled) {
    background: var(--tint-400);
    color: var(--navy-900);
  }

  .export-row button {
    padding: 6px 2px;
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  button.link,
  .footer-actions button {
    background: transparent;
    color: var(--navy-600);
    font-size: 12px;
    font-weight: 600;
    padding: 4px 8px;
    min-height: 28px;
  }

  button.link:hover:not(:disabled),
  .footer-actions button:hover:not(:disabled) {
    background: var(--tint-200);
    color: var(--navy-900);
  }

  button:disabled {
    cursor: not-allowed;
    opacity: 0.42;
  }
`;
