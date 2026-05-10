import type { CaptureStatus, ExportFormat } from "../core/subtitle-models";
import type { CaptureMode, LivePanelRow } from "../core/live-capture";
import type { StatusSnapshot } from "../shared/message-types";
import { getCaptureStatusLabel, getExportFormatLabel, UI_TEXT } from "../shared/ui-labels";

export const IN_PAGE_PANEL_HOST_ID = "assembly-subtitle-panel-host";
const SCROLL_FOLLOW_THRESHOLD_PX = 24;

const PANEL_STYLE = `
  :host {
    all: initial;
  }

  .host {
    position: fixed;
    top: 12px;
    right: 12px;
    z-index: 2147483646;
    font-family: "Noto Sans KR", "Pretendard", "Malgun Gothic", sans-serif;
    color: #142537;
  }

  .panel {
    width: min(560px, calc(100vw - 24px));
    height: calc(100vh - 24px);
    display: flex;
    flex-direction: column;
    gap: 12px;
    box-sizing: border-box;
    padding: 16px 16px 14px;
    overflow: hidden;
    border-radius: 24px;
    border: 1px solid rgba(255, 255, 255, 0.6);
    background:
      radial-gradient(circle at top right, rgba(24, 119, 182, 0.18), transparent 34%),
      linear-gradient(180deg, rgba(251, 253, 255, 0.99), rgba(240, 246, 252, 0.99));
    box-shadow: 0 28px 60px rgba(17, 44, 82, 0.24);
  }

  .collapsed-tab {
    writing-mode: vertical-rl;
    text-orientation: mixed;
    min-height: 156px;
    border: 0;
    border-radius: 18px 0 0 18px;
    background: #173f6e;
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
  .preview-header {
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
    color: #5a7088;
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
    font-size: 20px;
  }

  .title-group p:last-child,
  .section-copy p,
  .preview-copy p {
    margin: 6px 0 0;
    color: #4d6580;
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
    font-size: 12px;
    font-weight: 700;
  }

  .status-badge {
    min-width: 72px;
    padding: 6px 10px;
    background: #dce7f5;
    color: #214568;
  }

  .status-badge.running {
    background: #dff4e2;
    color: #185f2a;
  }

  .status-badge.stopped {
    background: #fff0d5;
    color: #8c5200;
  }

  .status-badge.error {
    background: #ffe0df;
    color: #9b211b;
  }

  .header-count {
    padding: 6px 10px;
    background: #eef3f9;
    color: #536b83;
  }

  .mode-badge {
    padding: 6px 10px;
    background: #eff4fb;
    color: #34516d;
  }

  .hero-card,
  .controls-card {
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.6);
    border: 1px solid rgba(255, 255, 255, 0.7);
    box-shadow: inset 0 2px 10px rgba(255, 255, 255, 0.5);
    padding: 14px;
  }

  .hero-card {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
    gap: 12px;
    overflow: hidden;
  }

  .controls-card {
    display: grid;
    gap: 10px;
    flex-shrink: 0;
  }

  .section-header,
  .preview-header {
    flex-shrink: 0;
  }

  .section-header.primary {
    align-items: flex-start;
    gap: 12px;
  }

  .section-copy,
  .preview-copy {
    min-width: 0;
  }

  .section-copy h2 {
    font-size: 22px;
    line-height: 1.1;
  }

  .preview-copy h2 {
    font-size: 14px;
    line-height: 1.2;
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
    gap: 8px;
    padding: 10px 12px 12px;
    border-radius: 18px;
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
    min-height: 0;
    display: flex;
  }

  .preview-box {
    overflow: hidden;
    flex-shrink: 0;
    height: 96px;
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
    min-height: 0;
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
    padding: 14px 16px;
    border-radius: 14px;
    background: #ffffff;
    border: 1px solid rgba(20, 54, 90, 0.08);
    box-shadow: 0 10px 18px rgba(20, 54, 90, 0.06);
  }

  .live-row time {
    display: block;
    margin-bottom: 4px;
    color: #5a7088;
    font-size: 11px;
  }

  .live-row p {
    margin: 0;
    color: #10263c;
    font-size: 18px;
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
    font-size: 18px;
    font-weight: 700;
    line-height: 1.7;
  }

  .section-count {
    padding: 6px 10px;
    background: #e8f0fa;
    color: #2e526f;
  }

  .notice {
    box-sizing: border-box;
    min-height: calc(1.5em * 2 + 20px);
    padding: 10px 12px;
    border-radius: 14px;
    background: rgba(227, 236, 247, 0.72);
    font-size: 13px;
    color: #314b66;
    line-height: 1.5;
    flex-shrink: 0;
  }

  .action-row button,
  .footer-actions button {
    flex: 1;
    min-width: 0;
  }

  .footer-actions {
    flex-wrap: wrap;
    flex-shrink: 0;
  }

  .export-row {
    display: flex;
    gap: 6px;
  }

  .export-row button {
    flex: 1;
    padding: 8px 4px;
    font-size: 12px;
    color: #314b66;
    background: #f5f8fc;
    border: 1px solid rgba(20, 54, 90, 0.08);
  }

  .export-row button:hover:not(:disabled) {
    background: #eef3f9;
  }

  button {
    border: 0;
    border-radius: 12px;
    background: #173f6e;
    color: #ffffff;
    font: inherit;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    padding: 10px 12px;
  }

  .preview-toggle,
  button {
    min-height: 40px;
  }

  button.icon {
    width: auto;
    min-width: 0;
    padding: 8px 12px;
  }

  button.secondary {
    background: #dfe8f4;
    color: #18344f;
  }

  button:disabled {
    cursor: not-allowed;
    opacity: 0.45;
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

    .live-row-list {
      min-height: 220px;
    }

    .live-row p,
    .empty-text {
      font-size: 15px;
    }
  }
`;

export interface InPagePanelState {
  visible: boolean;
  collapsed: boolean;
  previewCollapsed: boolean;
  autoScroll: boolean;
  status: CaptureStatus;
  statusLabel: string;
  committeeName: string;
  startedAt: string | null;
  lastPersistedAt: string | null;
  previewText: string;
  livePreviewText: string;
  liveRows: LivePanelRow[];
  captureMode: CaptureMode;
  subtitleCount: number;
  charCount: number;
  recentCopyLineCount: number;
  notice: string;
  hasPersistableContent: boolean;
  canClearSession: boolean;
  showNotice: boolean;
  healthLabel: string;
  healthHint: string;
  estimatedBytes: number;
  sizeWarning: string;
  canHighlightLatestEntry: boolean;
}

export interface InPagePanelActions {
  onStartCapture: () => void;
  onStopCapture: () => void;
  onClearSession: () => void;
  onSaveSession: () => void;
  onSaveAndStartNewSession?: () => void;
  onHighlightLatestEntry?: () => void;
  onExport: (format: ExportFormat) => void;
  onCopyRecent: () => void;
  onOpenHistory: () => void;
  onOpenOptions: () => void;
  onOpenDiagnostics: () => void;
  onExpand: () => void;
  onCollapse: () => void;
  onTogglePreviewCollapsed: () => void;
}

export interface InPagePanelController {
  update: (state: InPagePanelState) => void;
  destroy: () => void;
}

function formatDate(value: string | null | number): string {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString("ko-KR");
}

function formatCaptureMode(mode: CaptureMode): string {
  switch (mode) {
    case "structured":
      return "수집된 자막";
    case "fallback":
      return "실시간 자막";
    default:
      return "준비 중";
  }
}

function createLiveRowCard(row: LivePanelRow): HTMLElement {
  const article = document.createElement("article");
  article.className = "live-row";
  article.dataset.rowKey = row.key;

  const time = document.createElement("time");
  time.textContent = formatDate(row.updatedAt);

  const text = document.createElement("p");
  text.textContent = row.text;

  article.append(time, text);
  return article;
}

function createButton(
  label: string,
  handler: () => void,
  className?: string,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  if (className) {
    button.className = className;
  }
  button.addEventListener("click", handler);
  return button;
}

function buildPreviewSignature(previewText: string): string {
  return previewText;
}

function buildLiveRowsSignature(rows: LivePanelRow[]): string {
  return rows.map((row) => `${row.key}|${row.text}|${row.updatedAt}`).join("||");
}

function getScrollBottomDistance(container: HTMLElement): number {
  return Math.max(container.scrollHeight - container.clientHeight - container.scrollTop, 0);
}

function isScrollNearBottom(
  container: HTMLElement,
  threshold = SCROLL_FOLLOW_THRESHOLD_PX,
): boolean {
  return getScrollBottomDistance(container) <= threshold;
}

function scrollToBottom(container: HTMLElement): void {
  container.scrollTop = container.scrollHeight;
}

export function buildInPagePanelState(
  snapshot: StatusSnapshot,
  options: {
    collapsed: boolean;
    previewCollapsed: boolean;
    notice: string;
    showNotice: boolean;
    autoScroll: boolean;
    recentCopyLineCount: number;
    livePreviewText: string;
    liveRows: LivePanelRow[];
    canClearSession: boolean;
  },
): InPagePanelState {
  return {
    visible: snapshot.connected,
    collapsed: options.collapsed,
    previewCollapsed: options.previewCollapsed,
    autoScroll: options.autoScroll,
    status: snapshot.status,
    statusLabel: getCaptureStatusLabel(snapshot.status),
    committeeName: snapshot.committeeName || snapshot.title || UI_TEXT.appName,
    startedAt: snapshot.startedAt,
    lastPersistedAt: snapshot.lastPersistedAt,
    previewText: snapshot.previewText,
    livePreviewText: options.livePreviewText || snapshot.previewText,
    liveRows: options.liveRows,
    captureMode: snapshot.diagnostics.captureMode,
    subtitleCount: snapshot.subtitleCount,
    charCount: snapshot.charCount,
    recentCopyLineCount: options.recentCopyLineCount,
    notice: options.notice,
    hasPersistableContent: snapshot.hasPersistableContent,
    canClearSession: options.canClearSession,
    showNotice: options.showNotice,
    healthLabel: snapshot.diagnostics.healthLabel ?? "-",
    healthHint: snapshot.diagnostics.healthHint ?? "",
    estimatedBytes: snapshot.diagnostics.estimatedBytes ?? 0,
    sizeWarning: snapshot.diagnostics.sizeWarning ?? "",
    canHighlightLatestEntry: snapshot.recentEntries.some((entry) => !entry.highlighted),
  };
}

export function createInPagePanel(actions: InPagePanelActions): InPagePanelController {
  const existingHost = document.getElementById(IN_PAGE_PANEL_HOST_ID);
  existingHost?.remove();

  const host = document.createElement("div");
  host.id = IN_PAGE_PANEL_HOST_ID;
  const shadowRoot = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = PANEL_STYLE;

  const wrapper = document.createElement("div");
  wrapper.className = "host";

  const collapsedTab = createButton(UI_TEXT.expand, actions.onExpand, "collapsed-tab");
  const panel = document.createElement("section");
  panel.className = "panel";

  const header = document.createElement("div");
  header.className = "header";
  const titleGroup = document.createElement("div");
  titleGroup.className = "title-group";
  const title = document.createElement("h1");
  title.textContent = UI_TEXT.appName;
  titleGroup.append(title);

  const headerCount = document.createElement("span");
  headerCount.className = "header-count";
  const healthBadge = document.createElement("span");
  healthBadge.className = "mode-badge";
  const statusBadge = document.createElement("span");
  statusBadge.className = "status-badge";
  const headerActions = document.createElement("div");
  headerActions.className = "header-actions";
  const collapseButton = createButton(UI_TEXT.collapse, actions.onCollapse, "secondary icon");
  headerActions.append(headerCount, healthBadge, statusBadge, collapseButton);
  header.append(titleGroup, headerActions);

  const heroCard = document.createElement("section");
  heroCard.className = "hero-card";
  const modeBadge = document.createElement("span");
  modeBadge.className = "mode-badge";

  const liveRowHeader = document.createElement("div");
  liveRowHeader.className = "section-header primary";
  const liveRowCopy = document.createElement("div");
  liveRowCopy.className = "section-copy";
  const liveRowTitle = document.createElement("h2");
  liveRowTitle.textContent = UI_TEXT.screenSubtitles;
  const liveRowHint = document.createElement("p");
  liveRowHint.textContent = "방금 수집된 자막을 더 큰 글씨로 바로 확인합니다.";
  liveRowCopy.append(liveRowTitle, liveRowHint);
  const liveRowMeta = document.createElement("div");
  liveRowMeta.className = "section-meta";
  const liveRowCount = document.createElement("span");
  liveRowCount.className = "section-count";
  liveRowMeta.append(modeBadge, liveRowCount);
  liveRowHeader.append(liveRowCopy, liveRowMeta);

  const liveRowList = document.createElement("div");
  liveRowList.className = "live-row-list";
  liveRowList.setAttribute("role", "log");
  liveRowList.setAttribute("aria-live", "polite");
  liveRowList.setAttribute("aria-relevant", "additions text");
  const liveRowEmpty = document.createElement("p");
  liveRowEmpty.className = "empty-text";
  liveRowEmpty.textContent = "화면에서 자막을 찾으면 수집된 자막이 이곳에 누적됩니다.";
  liveRowList.append(liveRowEmpty);
  const liveRowShell = document.createElement("div");
  liveRowShell.className = "live-row-shell";
  const liveRowJumpButton = createButton(
    "↓",
    () => {
      scrollToBottom(liveRowList);
      syncLiveRowJumpButton();
    },
    "scroll-jump",
  );
  liveRowJumpButton.setAttribute("aria-label", "수집된 자막 맨 아래로 이동");
  liveRowJumpButton.hidden = true;
  liveRowShell.append(liveRowList, liveRowJumpButton);

  const previewSection = document.createElement("section");
  previewSection.className = "preview-section";
  const previewHeader = document.createElement("div");
  previewHeader.className = "preview-header";
  const previewCopy = document.createElement("div");
  previewCopy.className = "preview-copy";
  const previewTitle = document.createElement("h2");
  previewTitle.textContent = UI_TEXT.livePreview;
  const previewHint = document.createElement("p");
  previewHint.textContent = "지금 화면에서 감지한 최신 자막 흐름을 보조로 표시합니다.";
  previewCopy.append(previewTitle, previewHint);
  const previewToggle = createButton("실시간 내용 접기", actions.onTogglePreviewCollapsed, "secondary preview-toggle");
  previewToggle.setAttribute("aria-expanded", "true");
  previewHeader.append(previewCopy, previewToggle);

  const previewBox = document.createElement("div");
  previewBox.className = "preview-box";
  previewBox.setAttribute("role", "status");
  previewBox.setAttribute("aria-live", "polite");
  previewBox.setAttribute("aria-atomic", "true");
  const previewScroll = document.createElement("div");
  previewScroll.className = "preview-scroll";
  previewBox.append(previewScroll);
  previewSection.append(previewHeader, previewBox);

  heroCard.append(liveRowHeader, liveRowShell, previewSection);

  const controlsCard = document.createElement("section");
  controlsCard.className = "controls-card";
  const primaryActions = document.createElement("div");
  primaryActions.className = "action-row";
  const startButton = createButton(UI_TEXT.startCapture, actions.onStartCapture);
  const stopButton = createButton(UI_TEXT.stopCapture, actions.onStopCapture);
  const copyRecentButton = createButton(UI_TEXT.copyRecent, actions.onCopyRecent, "secondary");
  primaryActions.append(startButton, stopButton, copyRecentButton);

  const exportRow = document.createElement("div");
  exportRow.className = "export-row";
  const exportButtons = (["txt", "srt", "vtt", "json"] as ExportFormat[]).map((format) => {
    const button = createButton(getExportFormatLabel(format), () => actions.onExport(format));
    exportRow.append(button);
    return button;
  });

  const secondaryActions = document.createElement("div");
  secondaryActions.className = "action-row";
  const clearButton = createButton(UI_TEXT.clearSession, actions.onClearSession, "secondary");
  const saveButton = createButton(UI_TEXT.saveSession, actions.onSaveSession, "secondary");
  const highlightLatestButton = createButton(
    "최신 중요 표시",
    actions.onHighlightLatestEntry ?? (() => undefined),
    "secondary",
  );
  const rolloverButton = createButton(
    "중간 저장 후 새 세션",
    actions.onSaveAndStartNewSession ?? (() => undefined),
    "secondary",
  );
  secondaryActions.append(clearButton, saveButton, highlightLatestButton, rolloverButton);
  controlsCard.append(primaryActions, exportRow, secondaryActions);

  const notice = document.createElement("div");
  notice.className = "notice";
  notice.setAttribute("role", "status");
  notice.setAttribute("aria-live", "polite");
  notice.setAttribute("aria-atomic", "true");
  notice.setAttribute("aria-hidden", "true");
  notice.hidden = true;

  const footer = document.createElement("div");
  footer.className = "footer-actions";
  const historyButton = createButton(UI_TEXT.openHistory, actions.onOpenHistory, "secondary");
  const optionsButton = createButton(UI_TEXT.openOptions, actions.onOpenOptions, "secondary");
  const diagnosticsButton = createButton(
    UI_TEXT.openDiagnostics,
    actions.onOpenDiagnostics,
    "secondary",
  );
  footer.append(historyButton, diagnosticsButton, optionsButton);

  const panelScroll = document.createElement("div");
  panelScroll.className = "panel-scroll";
  panelScroll.append(heroCard, notice, controlsCard, footer);

  panel.append(header, panelScroll);
  wrapper.append(collapsedTab, panel);
  shadowRoot.append(style, wrapper);
  (document.body || document.documentElement).appendChild(host);

  const emptyPreviewText = "자막이 잡히면 이곳에 실시간으로 표시됩니다.";
  const liveRowNodes = new Map<string, HTMLElement>();
  let renderedNotice = "";
  let renderedShowNotice: boolean | null = null;
  let renderedCollapsed = false;
  let renderedPreviewCollapsed: boolean | null = null;
  let renderedPreviewSignature = "";
  let renderedLiveRowsSignature = "";
  const syncLiveRowJumpButton = (hasRows = liveRowNodes.size > 0): void => {
    const shouldShow = hasRows && !isScrollNearBottom(liveRowList);
    liveRowJumpButton.hidden = !shouldShow;
    liveRowJumpButton.setAttribute("aria-hidden", String(!shouldShow));
  };

  liveRowList.addEventListener("scroll", () => {
    syncLiveRowJumpButton();
  });

  return {
    update(nextState) {
      const liveRowsWereNearBottom = isScrollNearBottom(liveRowList);

      host.style.display = nextState.visible ? "block" : "none";

      if (renderedCollapsed !== nextState.collapsed) {
        wrapper.classList.toggle("collapsed", nextState.collapsed);
        renderedCollapsed = nextState.collapsed;
      }

      if (renderedPreviewCollapsed !== nextState.previewCollapsed) {
        previewSection.classList.toggle("collapsed", nextState.previewCollapsed);
        previewBox.setAttribute("aria-hidden", String(nextState.previewCollapsed));
        previewToggle.textContent = nextState.previewCollapsed
          ? "실시간 내용 펼치기"
          : "실시간 내용 접기";
        previewToggle.setAttribute("aria-expanded", String(!nextState.previewCollapsed));
        renderedPreviewCollapsed = nextState.previewCollapsed;
      }

      statusBadge.textContent = nextState.statusLabel;
      statusBadge.className = `status-badge ${nextState.status}`;
      headerCount.textContent = `자막 ${nextState.subtitleCount}줄`;
      healthBadge.textContent = `건강도 ${nextState.healthLabel}`;
      healthBadge.title = nextState.sizeWarning || nextState.healthHint;
      modeBadge.textContent = formatCaptureMode(nextState.captureMode);
      liveRowCount.textContent = `${nextState.liveRows.length}개`;
      copyRecentButton.textContent = `최근 ${nextState.recentCopyLineCount}줄 복사`;

      const nextPreviewText =
        nextState.livePreviewText.trim() || nextState.previewText.trim() || emptyPreviewText;
      const nextPreviewSignature = buildPreviewSignature(nextPreviewText);
      const previewChanged = renderedPreviewSignature !== nextPreviewSignature;
      if (previewChanged) {
        previewScroll.textContent = nextPreviewText;
        renderedPreviewSignature = nextPreviewSignature;
      }

      const nextLiveRowsSignature = buildLiveRowsSignature(nextState.liveRows);
      const liveRowsChanged = renderedLiveRowsSignature !== nextLiveRowsSignature;
      if (liveRowsChanged) {
        if (!nextState.liveRows.length) {
          liveRowNodes.forEach((node) => node.remove());
          liveRowNodes.clear();
          liveRowList.replaceChildren(liveRowEmpty);
        } else {
          if (liveRowEmpty.parentElement === liveRowList) {
            liveRowEmpty.remove();
          }

          nextState.liveRows.forEach((row) => {
            let node = liveRowNodes.get(row.key);
            if (!node) {
              node = createLiveRowCard(row);
              liveRowNodes.set(row.key, node);
            }

            const timeNode = node.querySelector("time");
            const textNode = node.querySelector("p");
            const nextTime = formatDate(row.updatedAt);
            if (timeNode && timeNode.textContent !== nextTime) {
              timeNode.textContent = nextTime;
            }
            if (textNode && textNode.textContent !== row.text) {
              textNode.textContent = row.text;
            }

            liveRowList.appendChild(node);
          });

          [...liveRowNodes.keys()].forEach((key) => {
            if (nextState.liveRows.some((row) => row.key === key)) {
              return;
            }
            const node = liveRowNodes.get(key);
            node?.remove();
            liveRowNodes.delete(key);
          });
        }
        renderedLiveRowsSignature = nextLiveRowsSignature;
      }

      const nextNotice = nextState.sizeWarning || nextState.notice;
      if (renderedNotice !== nextNotice) {
        notice.textContent = nextNotice;
        notice.dataset.message = nextNotice;
        renderedNotice = nextNotice;
      }

      const nextShowNotice = nextState.showNotice || Boolean(nextState.sizeWarning);
      if (renderedShowNotice !== nextShowNotice) {
        notice.hidden = !nextShowNotice;
        notice.setAttribute("aria-hidden", String(!nextShowNotice));
        renderedShowNotice = nextShowNotice;
      }

      startButton.style.display = nextState.status === "running" ? "none" : "";
      stopButton.style.display = nextState.status === "running" ? "" : "none";
      clearButton.disabled = !nextState.canClearSession;
      saveButton.disabled = !nextState.hasPersistableContent;
      highlightLatestButton.disabled = !nextState.canHighlightLatestEntry;
      rolloverButton.disabled = nextState.status !== "running" || !nextState.hasPersistableContent;
      copyRecentButton.disabled = !nextState.hasPersistableContent;
      exportButtons.forEach((button) => {
        button.disabled = !nextState.hasPersistableContent;
      });

      if (!nextState.collapsed && nextState.autoScroll) {
        if (previewChanged && !nextState.previewCollapsed) {
          previewScroll.scrollTop = previewScroll.scrollHeight;
        }
        if (liveRowsChanged && liveRowsWereNearBottom) {
          scrollToBottom(liveRowList);
        }
      }

      syncLiveRowJumpButton(nextState.liveRows.length > 0);
    },
    destroy() {
      host.remove();
    },
  };
}
