/** 푸터/캡처/내보내기/버튼 — PANEL_STYLE 분할 파트. */
export const controlsStyle = `  .action-row button,
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

  .capture-row {
    display: grid;
    grid-template-columns: 1fr;
  }

  .capture-row button {
    width: 100%;
  }

  .capture-row .stop-action {
    background: #8c5200;
  }

  .capture-row .stop-action:hover:not(:disabled) {
    background: #713f00;
  }

  .txt-export-button {
    width: 100%;
  }

  .export-details {
    border: 1px solid var(--line-soft);
    border-radius: 10px;
    background: rgba(247, 250, 253, 0.72);
  }

  .export-details summary {
    cursor: pointer;
    padding: 9px 10px;
    color: var(--navy-600);
    font-size: 12px;
    font-weight: 700;
  }

  .export-details .export-row {
    padding: 0 8px 8px;
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
`;
