/** 카드/섹션/스피커 토글 — PANEL_STYLE 분할 파트. */
export const sectionsStyle = `  .hero-card,
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
    min-height: min(420px, calc(100vh - 286px));
    gap: 10px;
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
`;
