/** 디자인 토큰(:host, .host 변수) — PANEL_STYLE 분할 파트. */
export const tokensStyle = `  :host {
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
    --tint-100: #f5f8fc;
    --tint-200: #eef3f9;
    --tint-300: #dfe8f4;
    --tint-400: #c6d4e6;
    --line-soft: rgba(20, 54, 90, 0.1);
    --line-strong: rgba(20, 54, 90, 0.18);
    --shadow-panel: 0 12px 32px rgba(17, 44, 82, 0.18);
    --radius-lg: 14px;
    --radius-md: 10px;
    --radius-sm: 8px;
    position: fixed;
    top: 12px;
    right: 12px;
    z-index: 2147483646;
    font-family: "Noto Sans KR", "Pretendard", "Malgun Gothic", sans-serif;
    color: var(--ink-900);
  }
`;
