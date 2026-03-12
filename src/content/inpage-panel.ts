import type { CaptureStatus, ExportFormat } from "../core/subtitle-models";
import type { CaptureMode, LivePanelRow } from "../core/live-capture";
import type { StatusSnapshot } from "../shared/message-types";
import { getCaptureStatusLabel, getExportFormatLabel, UI_TEXT } from "../shared/ui-labels";

export const IN_PAGE_PANEL_HOST_ID = "assembly-subtitle-panel-host";

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
    width: min(468px, calc(100vw - 24px));
    max-height: calc(100vh - 24px);
    display: grid;
    gap: 12px;
    box-sizing: border-box;
    padding: 16px 16px 14px;
    overflow: hidden auto;
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
  .hero-header,
  .section-header {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .header,
  .footer-actions,
  .hero-header,
  .section-header {
    justify-content: space-between;
  }

  .header-actions,
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
  .hero-copy h2,
  .section-header h2 {
    margin: 0;
  }

  .title-group h1 {
    font-size: 20px;
  }

  .title-group p:last-child,
  .hero-copy p {
    margin: 6px 0 0;
    color: #4d6580;
    font-size: 12px;
    line-height: 1.45;
  }

  .status-badge,
  .header-count,
  .mode-badge {
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
  .controls-card,
  .section-card {
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.6);
    border: 1px solid rgba(255, 255, 255, 0.7); box-shadow: inset 0 2px 10px rgba(255, 255, 255, 0.5);
    padding: 14px;
  }

  .hero-card,
  .controls-card {
    display: grid;
    gap: 10px;
  }

  .preview-box,
  .live-row-list {
    border-radius: 16px;
    background: #f2f6fb;
    border: 1px solid rgba(20, 54, 90, 0.06);
  }

  .preview-box {
    height: 132px;
    overflow: hidden;
  }

  .preview-scroll {
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    overflow: auto;
    scrollbar-gutter: stable both-edges;
    padding: 16px 18px;
    font-size: 14px;
    font-weight: 500;
    line-height: 1.6;
    white-space: pre-wrap;
    color: #18344f;
  }

  .live-row-list {
    display: grid;
    gap: 10px;
    padding: 12px;
    max-height: min(36vh, 320px);
    overflow: auto;
    scrollbar-gutter: stable both-edges;
  }

  .live-row {
    padding: 10px 12px;
    border-radius: 12px;
    background: #ffffff;
    border: 1px solid rgba(20, 54, 90, 0.08);
  }

  .live-row time,
  .live-row time {
    display: block;
    margin-bottom: 4px;
    color: #5a7088;
    font-size: 11px;
  }

  .live-row p,
  .empty-text {
    margin: 0;
    color: #10263c;
    font-weight: 500;
    line-height: 1.6;
  }

  .notice {
    padding: 10px 12px;
    border-radius: 14px;
    background: rgba(227, 236, 247, 0.72);
    font-size: 13px;
    color: #314b66;
    line-height: 1.5;
  }

  .action-row button,
  .footer-actions button {
    flex: 1;
    min-width: 0;
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
      height: 112px;
    }

    .preview-scroll {
      font-size: 13px;
      padding: 14px 16px;
    }
  }
`;

export interface InPagePanelState {
  visible: boolean;
  collapsed: boolean;
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
}

export interface InPagePanelActions {
  onStartCapture: () => void;
  onStopCapture: () => void;
  onClearSession: () => void;
  onSaveSession: () => void;
  onExport: (format: ExportFormat) => void;
  onCopyRecent: () => void;
  onOpenHistory: () => void;
  onOpenOptions: () => void;
  onExpand: () => void;
  onCollapse: () => void;
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
      return "화면 자막";
    case "fallback":
      return "자막 찾는 중";
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

export function buildInPagePanelState(
  snapshot: StatusSnapshot,
  options: {
    collapsed: boolean;
    notice: string;
    autoScroll: boolean;
    recentCopyLineCount: number;
    livePreviewText: string;
    liveRows: LivePanelRow[];
    captureMode: CaptureMode;
  },
): InPagePanelState {
  return {
    visible: snapshot.connected,
    collapsed: options.collapsed,
    autoScroll: options.autoScroll,
    status: snapshot.status,
    statusLabel: getCaptureStatusLabel(snapshot.status),
    committeeName: snapshot.committeeName || snapshot.title || UI_TEXT.appName,
    startedAt: snapshot.startedAt,
    lastPersistedAt: snapshot.lastPersistedAt,
    previewText: snapshot.previewText,
    livePreviewText: options.livePreviewText || snapshot.previewText,
    liveRows: options.liveRows,
    captureMode: options.captureMode,
    subtitleCount: snapshot.subtitleCount,
    charCount: snapshot.charCount,
    recentCopyLineCount: options.recentCopyLineCount,
    notice: options.notice,
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
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "바로 보기";
  const title = document.createElement("h1");
  title.textContent = UI_TEXT.appName;
  const subtitle = document.createElement("p");
  subtitle.textContent = "지금 보이는 자막을 바로 보여줍니다.";
  titleGroup.append(eyebrow, title, subtitle);

  const headerCount = document.createElement("span");
  headerCount.className = "header-count";
  const statusBadge = document.createElement("span");
  statusBadge.className = "status-badge";
  const headerActions = document.createElement("div");
  headerActions.className = "header-actions";
  const collapseButton = createButton(UI_TEXT.collapse, actions.onCollapse, "secondary icon");
  headerActions.append(headerCount, statusBadge, collapseButton);
  header.append(titleGroup, headerActions);

  const heroCard = document.createElement("section");
  heroCard.className = "hero-card";
  const heroHeader = document.createElement("div");
  heroHeader.className = "hero-header";
  const heroCopy = document.createElement("div");
  heroCopy.className = "hero-copy";
  const heroTitle = document.createElement("h2");
  heroTitle.textContent = UI_TEXT.livePreview;
  const heroHint = document.createElement("p");
  heroHint.textContent = "지금 화면에 보이는 자막을 먼저 보여줍니다.";
  heroCopy.append(heroTitle, heroHint);
  const modeBadge = document.createElement("span");
  modeBadge.className = "mode-badge";
  heroHeader.append(heroCopy, modeBadge);

  const previewBox = document.createElement("div");
  previewBox.className = "preview-box";
  previewBox.setAttribute("role", "status");
  previewBox.setAttribute("aria-live", "polite");
  previewBox.setAttribute("aria-atomic", "true");
  const previewScroll = document.createElement("div");
  previewScroll.className = "preview-scroll";
  previewBox.append(previewScroll);

  const liveRowHeader = document.createElement("div");
  liveRowHeader.className = "section-header";
  const liveRowTitle = document.createElement("h2");
  liveRowTitle.textContent = UI_TEXT.screenSubtitles;
  const liveRowCount = document.createElement("span");
  liveRowHeader.append(liveRowTitle, liveRowCount);

  const liveRowList = document.createElement("div");
  liveRowList.className = "live-row-list";
  liveRowList.setAttribute("role", "log");
  liveRowList.setAttribute("aria-live", "polite");
  liveRowList.setAttribute("aria-relevant", "additions text");
  const liveRowEmpty = document.createElement("p");
  liveRowEmpty.className = "empty-text";
  liveRowEmpty.textContent = "화면에서 자막을 찾으면 최근 자막이 이곳에 누적됩니다.";
  liveRowList.append(liveRowEmpty);

  heroCard.append(heroHeader, previewBox, liveRowHeader, liveRowList);

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
  secondaryActions.append(clearButton, saveButton);
  controlsCard.append(primaryActions, exportRow, secondaryActions);

  const notice = document.createElement("div");
  notice.className = "notice";
  notice.setAttribute("role", "status");
  notice.setAttribute("aria-live", "polite");
  notice.setAttribute("aria-atomic", "true");

  const footer = document.createElement("div");
  footer.className = "footer-actions";
  const historyButton = createButton(UI_TEXT.openHistory, actions.onOpenHistory, "secondary");
  const optionsButton = createButton(UI_TEXT.openOptions, actions.onOpenOptions, "secondary");
  footer.append(historyButton, optionsButton);

  panel.append(header, heroCard, notice, controlsCard, footer);
  wrapper.append(collapsedTab, panel);
  shadowRoot.append(style, wrapper);
  (document.body || document.documentElement).appendChild(host);

  const emptyPreviewText = "자막이 잡히면 이곳에 실시간으로 표시됩니다.";
  const liveRowNodes = new Map<string, HTMLElement>();
  let renderedNotice = "";
  let renderedCollapsed = false;
  let renderedPreviewSignature = "";
  let renderedLiveRowsSignature = "";

  return {
    update(nextState) {
      host.style.display = nextState.visible ? "block" : "none";

      if (renderedCollapsed !== nextState.collapsed) {
        wrapper.classList.toggle("collapsed", nextState.collapsed);
        renderedCollapsed = nextState.collapsed;
      }

      statusBadge.textContent = nextState.statusLabel;
      statusBadge.className = `status-badge ${nextState.status}`;
      headerCount.textContent = `모은 자막 ${nextState.subtitleCount}줄`;
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

      if (renderedNotice !== nextState.notice) {
        notice.textContent = nextState.notice;
        renderedNotice = nextState.notice;
      }

      const hasEntries = nextState.subtitleCount > 0;
      const hasPersistableContent =
        hasEntries ||
        nextState.liveRows.length > 0 ||
        Boolean(nextState.livePreviewText.trim()) ||
        Boolean(nextState.previewText.trim());
      startButton.style.display = nextState.status === "running" ? "none" : "";
      stopButton.style.display = nextState.status === "running" ? "" : "none";
      clearButton.disabled = !hasPersistableContent;
      saveButton.disabled = !hasPersistableContent;
      copyRecentButton.disabled = !hasPersistableContent;
      exportButtons.forEach((button) => {
        button.disabled = !hasPersistableContent;
      });

      if (!nextState.collapsed && nextState.autoScroll) {
        if (previewChanged) {
          previewScroll.scrollTop = previewScroll.scrollHeight;
        }
        if (liveRowsChanged) {
          liveRowList.scrollTop = liveRowList.scrollHeight;
        }
      }
    },
    destroy() {
      host.remove();
    },
  };
}
