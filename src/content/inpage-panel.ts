import type { CaptureStatus, ExportFormat, SubtitleEntry } from "../core/subtitle-models";
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
    border: 1px solid rgba(20, 54, 90, 0.16);
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
    background: rgba(255, 255, 255, 0.88);
    border: 1px solid rgba(20, 54, 90, 0.08);
    padding: 14px;
  }

  .hero-card,
  .controls-card {
    display: grid;
    gap: 10px;
  }

  .preview-box,
  .live-row-list,
  .entry-list {
    border-radius: 16px;
    background: #f2f6fb;
    border: 1px solid rgba(20, 54, 90, 0.06);
    overflow: auto;
  }

  .preview-box {
    padding: 16px 18px;
    font-size: 14px;
    font-weight: 500;
    line-height: 1.6;
    min-height: 60px;
    max-height: 140px;
    white-space: pre-wrap;
    color: #18344f;
  }

  .live-row-list,
  .entry-list {
    display: grid;
    gap: 10px;
    padding: 12px;
    max-height: min(36vh, 320px);
  }

  .live-row {
    padding: 10px 12px;
    border-radius: 12px;
    background: #ffffff;
    border: 1px solid rgba(20, 54, 90, 0.08);
  }

  .live-row time,
  .entry-card time {
    display: block;
    margin-bottom: 4px;
    color: #5a7088;
    font-size: 11px;
  }

  .live-row p,
  .entry-card p,
  .empty-text {
    margin: 0;
    color: #10263c;
    font-weight: 500;
    line-height: 1.6;
  }

  .entry-card {
    padding-bottom: 10px;
    border-bottom: 1px solid rgba(20, 54, 90, 0.08);
  }

  .entry-card:last-child {
    padding-bottom: 0;
    border-bottom: 0;
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
      font-size: 13px;
      min-height: 50px;
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
  recentEntries: SubtitleEntry[];
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
      return "구조화 감지";
    case "fallback":
      return "원문 fallback";
    default:
      return "대기 중";
  }
}

function createEntryCard(entry: SubtitleEntry): HTMLElement {
  const article = document.createElement("article");
  article.className = "entry-card";

  const time = document.createElement("time");
  time.textContent = formatDate(entry.startTime);

  const text = document.createElement("p");
  text.textContent = entry.text;

  article.append(time, text);
  return article;
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

function buildEntrySignature(entries: SubtitleEntry[]): string {
  return entries
    .map((entry) => `${entry.id}|${entry.text}|${entry.startTime}|${entry.endTime}`)
    .join("||");
}

function buildLiveSignature(rows: LivePanelRow[], previewText: string, captureMode: CaptureMode): string {
  return [
    captureMode,
    previewText,
    ...rows.map((row) => `${row.key}|${row.text}|${row.updatedAt}`),
  ].join("||");
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
    recentEntries: snapshot.recentEntries,
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
  subtitle.textContent = "실시간 감지 내용과 확정된 자막을 분리해 보여줍니다.";
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
  heroHint.textContent = "현재 화면에서 감지한 live row를 먼저 갱신합니다.";
  heroCopy.append(heroTitle, heroHint);
  const modeBadge = document.createElement("span");
  modeBadge.className = "mode-badge";
  heroHeader.append(heroCopy, modeBadge);

  const previewBox = document.createElement("div");
  previewBox.className = "preview-box";

  const liveRowHeader = document.createElement("div");
  liveRowHeader.className = "section-header";
  const liveRowTitle = document.createElement("h2");
  liveRowTitle.textContent = "현재 감지된 줄";
  const liveRowCount = document.createElement("span");
  liveRowHeader.append(liveRowTitle, liveRowCount);

  const liveRowList = document.createElement("div");
  liveRowList.className = "live-row-list";
  const liveRowEmpty = document.createElement("p");
  liveRowEmpty.className = "empty-text";
  liveRowEmpty.textContent = "구조화 row가 잡히면 이곳에 표시됩니다.";
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

  const listSection = document.createElement("section");
  listSection.className = "section-card";
  const listHeader = document.createElement("div");
  listHeader.className = "section-header";
  const listTitle = document.createElement("h2");
  listTitle.textContent = UI_TEXT.recentEntries;
  const listCount = document.createElement("span");
  listHeader.append(listTitle, listCount);
  const entryList = document.createElement("div");
  entryList.className = "entry-list";
  listSection.append(listHeader, entryList);

  const notice = document.createElement("div");
  notice.className = "notice";

  const footer = document.createElement("div");
  footer.className = "footer-actions";
  const historyButton = createButton(UI_TEXT.openHistory, actions.onOpenHistory, "secondary");
  const optionsButton = createButton(UI_TEXT.openOptions, actions.onOpenOptions, "secondary");
  footer.append(historyButton, optionsButton);

  panel.append(header, heroCard, listSection, notice, controlsCard, footer);
  wrapper.append(collapsedTab, panel);
  shadowRoot.append(style, wrapper);
  (document.body || document.documentElement).appendChild(host);

  const emptyPreviewText = "자막이 잡히면 이곳에 실시간으로 표시됩니다.";
  const liveRowNodes = new Map<string, HTMLElement>();
  let renderedNotice = "";
  let renderedCollapsed = false;
  let renderedListSignature = "";
  let renderedLiveSignature = "";

  return {
    update(nextState) {
      host.style.display = nextState.visible ? "block" : "none";

      if (renderedCollapsed !== nextState.collapsed) {
        wrapper.classList.toggle("collapsed", nextState.collapsed);
        renderedCollapsed = nextState.collapsed;
      }

      statusBadge.textContent = nextState.statusLabel;
      statusBadge.className = `status-badge ${nextState.status}`;
      headerCount.textContent = `${nextState.subtitleCount}문장`;
      modeBadge.textContent = formatCaptureMode(nextState.captureMode);
      liveRowCount.textContent = `${nextState.liveRows.length}개`;
      copyRecentButton.textContent = `최근 ${nextState.recentCopyLineCount}줄 복사`;

      const nextPreviewText =
        nextState.livePreviewText.trim() || nextState.previewText.trim() || emptyPreviewText;
      const nextLiveSignature = buildLiveSignature(
        nextState.liveRows,
        nextPreviewText,
        nextState.captureMode,
      );
      const liveChanged = renderedLiveSignature !== nextLiveSignature;
      if (liveChanged) {
        previewBox.textContent = nextPreviewText;

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

        renderedLiveSignature = nextLiveSignature;
      }

      if (renderedNotice !== nextState.notice) {
        notice.textContent = nextState.notice;
        renderedNotice = nextState.notice;
      }

      const nextListSignature = buildEntrySignature(nextState.recentEntries);
      const listChanged = renderedListSignature !== nextListSignature;
      listCount.textContent = `${nextState.recentEntries.length}개`;
      if (listChanged) {
        if (!nextState.recentEntries.length) {
          entryList.replaceChildren();
          const empty = document.createElement("p");
          empty.className = "empty-text";
          empty.textContent = "아직 모인 자막이 없습니다.";
          entryList.append(empty);
        } else {
          const currentNodes = Array.from(entryList.querySelectorAll(".entry-card"));

          nextState.recentEntries.forEach((entry, index) => {
            const existingNode = currentNodes[index];
            if (existingNode) {
              const timeNode = existingNode.querySelector("time");
              const textNode = existingNode.querySelector("p");
              const nextTime = formatDate(entry.startTime);
              if (timeNode && timeNode.textContent !== nextTime) {
                timeNode.textContent = nextTime;
              }
              if (textNode && textNode.textContent !== entry.text) {
                textNode.textContent = entry.text;
              }
            } else {
              entryList.appendChild(createEntryCard(entry));
            }
          });

          for (let index = nextState.recentEntries.length; index < currentNodes.length; index += 1) {
            entryList.removeChild(currentNodes[index]);
          }
        }
        renderedListSignature = nextListSignature;
      }

      const hasEntries = nextState.subtitleCount > 0;
      const hasPersistableContent = hasEntries || Boolean(nextState.previewText.trim());
      startButton.style.display = nextState.status === "running" ? "none" : "";
      stopButton.style.display = nextState.status === "running" ? "" : "none";
      clearButton.disabled = !hasPersistableContent;
      saveButton.disabled = !hasPersistableContent;
      copyRecentButton.disabled = !hasPersistableContent;
      exportButtons.forEach((button) => {
        button.disabled = !hasPersistableContent;
      });

      if (!nextState.collapsed && nextState.autoScroll) {
        if (liveChanged) {
          liveRowList.scrollTop = liveRowList.scrollHeight;
        }
        if (listChanged) {
          entryList.scrollTop = entryList.scrollHeight;
        }
      }
    },
    destroy() {
      host.remove();
    },
  };
}
