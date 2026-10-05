/** 반응형(좁은 화면) — PANEL_STYLE 분할 파트. */
export const responsiveStyle = `  @media (max-width: 768px) {
    .host {
      top: 8px;
      right: 8px;
    }

    .panel {
      width: calc(100vw - 16px);
      height: calc(100vh - 16px);
    }

    .collapsed-tab {
      margin-right: -8px;
    }
  }`;
