/** 자막 영역/미리보기/컨트롤 묶음 — PANEL_STYLE 분할 파트. */
export const sectionsStyle = `  .hero-card {
    display: flex;
    flex-direction: column;
    flex: 1 1 0;
    min-height: 220px;
    gap: 6px;
  }

  .controls-card {
    display: grid;
    gap: 6px;
    flex-shrink: 0;
  }

  .section-header,
  .preview-header {
    flex-shrink: 0;
  }

  .section-copy,
  .preview-copy {
    min-width: 0;
  }

  .section-copy h2,
  .preview-copy h2 {
    font-size: 12px;
    font-weight: 700;
    line-height: 1.2;
    color: var(--navy-600);
  }

  .section-meta {
    min-width: 0;
    gap: 4px;
  }

  .preview-section {
    display: flex;
    flex-direction: column;
    flex: 0 0 auto;
    gap: 4px;
  }

  .preview-toggle {
    flex: 0 0 auto;
    white-space: nowrap;
  }

  .option-row {
    display: flex;
    flex-shrink: 0;
    flex-wrap: wrap;
    gap: 4px 14px;
  }

  .speaker-toggle {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin: 0;
    color: var(--ink-500);
    font-size: 12px;
    line-height: 1.4;
    cursor: pointer;
    user-select: none;
  }

  .speaker-toggle-input {
    width: 14px;
    height: 14px;
    margin: 0;
    accent-color: #237c93;
    cursor: pointer;
  }
`;
