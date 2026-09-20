/** 반응형(좁은 화면) — PANEL_STYLE 분할 파트. */
export const responsiveStyle = `  @media (max-width: 768px) {
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
  }`;
