import type { CaptureStatus, ExportFormat, SubtitleEntry } from "../core/subtitle-models";
import type { StatusSnapshot } from "../shared/message-types";
import { getCaptureStatusLabel, getExportFormatLabel, UI_TEXT } from "../shared/ui-labels";

export const IN_PAGE_PANEL_HOST_ID = "assembly-subtitle-panel-host";

const PANEL_STYLE = `
  :host {
    all: initial;
  }

  .host {
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 2147483646;
    font-family: "Noto Sans KR", "Pretendard", "Malgun Gothic", sans-serif;
    color: #142537;
  }

  .panel {
    width: 360px;
    max-height: calc(100vh - 32px);
    display: grid;
    gap: 12px;
    box-sizing: border-box;
    padding: 16px;
    overflow: hidden;
    border-radius: 22px;
    border: 1px solid rgba(20, 54, 90, 0.16);
    background:
      radial-gradient(circle at top right, rgba(40, 114, 176, 0.14), transparent 34%),
      linear-gradient(180deg, rgba(252, 253, 255, 0.98), rgba(242, 247, 252, 0.98));
    box-shadow: 0 24px 56px rgba(17, 44, 82, 0.22);
  }

  .collapsed-tab {
    writing-mode: vertical-rl;
    text-orientation: mixed;
    min-height: 140px;
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
  .meta-row,
  .footer-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .title-group h1,
  .section-header h2 {
    margin: 0;
  }

  .eyebrow {
    margin: 0 0 4px;
    color: #5a7088;
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .title-group h1 {
    font-size: 20px;
  }

  .status-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 72px;
    padding: 6px 10px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 700;
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

  .meta-card,
  .section-card {
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.88);
    border: 1px solid rgba(20, 54, 90, 0.08);
    padding: 14px;
  }

  .meta-row + .meta-row {
    margin-top: 8px;
  }

  .meta-row span:first-child {
    color: #5a7088;
    font-size: 13px;
  }

  .meta-row strong {
    font-size: 13px;
    text-align: right;
  }

  .action-grid,
  .export-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
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

  button.secondary {
    background: #dfe8f4;
    color: #18344f;
  }

  button.ghost {
    background: #eef3f9;
    color: #244666;
  }

  button:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  .notice {
    font-size: 13px;
    color: #334c66;
    line-height: 1.45;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 10px;
  }

  .section-header h2 {
    font-size: 15px;
  }

  .section-header span {
    color: #536b83;
    font-size: 12px;
  }

  .preview-box,
  .entry-list {
    border-radius: 14px;
    background: #f2f6fb;
    padding: 12px;
    font-size: 13px;
    line-height: 1.6;
  }

  .preview-box {
    white-space: pre-wrap;
    min-height: 84px;
    max-height: 160px;
    overflow: auto;
  }

  .entry-list {
    display: grid;
    gap: 10px;
    max-height: 220px;
    overflow: auto;
  }

  .entry-card {
    padding-bottom: 10px;
    border-bottom: 1px solid rgba(20, 54, 90, 0.08);
  }

  .entry-card:last-child {
    padding-bottom: 0;
    border-bottom: 0;
  }

  .entry-card time {
    display: block;
    color: #5a7088;
    font-size: 11px;
    margin-bottom: 4px;
  }

  .entry-card p,
  .empty-text {
    margin: 0;
  }

  .footer-actions {
    gap: 8px;
  }

  .footer-actions button {
    flex: 1;
  }
`;

export interface InPagePanelState {
  visible: boolean;
  collapsed: boolean;
  status: CaptureStatus;
  statusLabel: string;
  committeeName: string;
  startedAt: string | null;
  lastPersistedAt: string | null;
  previewText: string;
  recentEntries: SubtitleEntry[];
  subtitleCount: number;
  charCount: number;
  notice: string;
}

export interface InPagePanelActions {
  onStartCapture: () => void;
  onStopCapture: () => void;
  onClearSession: () => void;
  onSaveSession: () => void;
  onExport: (format: ExportFormat) => void;
  onOpenHistory: () => void;
  onOpenOptions: () => void;
  onExpand: () => void;
  onCollapse: () => void;
}

export interface InPagePanelController {
  update: (state: InPagePanelState) => void;
  destroy: () => void;
}

function formatDate(value: string | null): string {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString("ko-KR");
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

export function buildInPagePanelState(
  snapshot: StatusSnapshot,
  options: { collapsed: boolean; notice: string },
): InPagePanelState {
  return {
    visible: snapshot.connected,
    collapsed: options.collapsed,
    status: snapshot.status,
    statusLabel: getCaptureStatusLabel(snapshot.status),
    committeeName: snapshot.committeeName || snapshot.title || UI_TEXT.appName,
    startedAt: snapshot.startedAt,
    lastPersistedAt: snapshot.lastPersistedAt,
    previewText: snapshot.previewText,
    recentEntries: snapshot.recentEntries,
    subtitleCount: snapshot.subtitleCount,
    charCount: snapshot.charCount,
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
  titleGroup.append(eyebrow, title);

  const statusBadge = document.createElement("span");
  statusBadge.className = "status-badge";

  header.append(titleGroup, statusBadge);

  const metaCard = document.createElement("section");
  metaCard.className = "meta-card";

  const committeeValue = document.createElement("strong");
  const startedAtValue = document.createElement("strong");
  const lastSavedValue = document.createElement("strong");
  const countValue = document.createElement("strong");

  [
    ["회의 이름", committeeValue],
    ["시작 시각", startedAtValue],
    ["마지막 저장", lastSavedValue],
    ["모인 자막", countValue],
  ].forEach(([label, value]) => {
    const row = document.createElement("div");
    row.className = "meta-row";
    const span = document.createElement("span");
    span.textContent = label;
    row.append(span, value as Node);
    metaCard.append(row);
  });

  const actionGrid = document.createElement("div");
  actionGrid.className = "action-grid";
  const startButton = createButton(UI_TEXT.startCapture, actions.onStartCapture);
  const stopButton = createButton(UI_TEXT.stopCapture, actions.onStopCapture);
  const clearButton = createButton(UI_TEXT.clearSession, actions.onClearSession, "secondary");
  const saveButton = createButton(UI_TEXT.saveSession, actions.onSaveSession, "secondary");
  actionGrid.append(startButton, stopButton, clearButton, saveButton);

  const exportGrid = document.createElement("div");
  exportGrid.className = "export-grid";
  const exportButtons = (["txt", "srt", "vtt", "json"] as ExportFormat[]).map((format) => {
    const button = createButton(getExportFormatLabel(format), () => actions.onExport(format), "ghost");
    exportGrid.append(button);
    return button;
  });

  const notice = document.createElement("div");
  notice.className = "notice";

  const previewSection = document.createElement("section");
  previewSection.className = "section-card";
  const previewHeader = document.createElement("div");
  previewHeader.className = "section-header";
  const previewTitle = document.createElement("h2");
  previewTitle.textContent = UI_TEXT.livePreview;
  const previewStats = document.createElement("span");
  previewHeader.append(previewTitle, previewStats);
  const previewBox = document.createElement("div");
  previewBox.className = "preview-box";
  previewSection.append(previewHeader, previewBox);

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

  const footer = document.createElement("div");
  footer.className = "footer-actions";
  const historyButton = createButton(UI_TEXT.openHistory, actions.onOpenHistory, "secondary");
  const optionsButton = createButton(UI_TEXT.openOptions, actions.onOpenOptions, "secondary");
  const collapseButton = createButton(UI_TEXT.collapse, actions.onCollapse, "secondary");
  footer.append(historyButton, optionsButton, collapseButton);

  panel.append(header, metaCard, actionGrid, exportGrid, notice, previewSection, listSection, footer);
  wrapper.append(collapsedTab, panel);
  shadowRoot.append(style, wrapper);
  (document.body || document.documentElement).appendChild(host);

  return {
    update(nextState) {
      host.style.display = nextState.visible ? "block" : "none";
      wrapper.classList.toggle("collapsed", nextState.collapsed);

      statusBadge.textContent = nextState.statusLabel;
      statusBadge.className = `status-badge ${nextState.status}`;

      committeeValue.textContent = nextState.committeeName;
      startedAtValue.textContent = formatDate(nextState.startedAt);
      lastSavedValue.textContent = formatDate(nextState.lastPersistedAt);
      countValue.textContent = `${nextState.subtitleCount}문장 / ${nextState.charCount}자`;
      notice.textContent = nextState.notice;

      previewStats.textContent = `${nextState.subtitleCount}문장`;
      previewBox.textContent =
        nextState.previewText || "자막이 잡히면 이곳에 실시간으로 쌓입니다.";

      listCount.textContent = `${nextState.recentEntries.length}개`;
      entryList.replaceChildren();
      if (nextState.recentEntries.length) {
        nextState.recentEntries.forEach((entry) => entryList.appendChild(createEntryCard(entry)));
      } else {
        const empty = document.createElement("p");
        empty.className = "empty-text";
        empty.textContent = "아직 모인 자막이 없습니다.";
        entryList.append(empty);
      }

      const hasEntries = nextState.subtitleCount > 0;
      startButton.disabled = nextState.status === "running";
      stopButton.disabled = nextState.status !== "running";
      clearButton.disabled = !hasEntries && !nextState.previewText;
      saveButton.disabled = !hasEntries;
      exportButtons.forEach((button) => {
        button.disabled = !hasEntries;
      });

      if (!nextState.collapsed) {
        entryList.scrollTop = entryList.scrollHeight;
        previewBox.scrollTop = previewBox.scrollHeight;
      }
    },
    destroy() {
      host.remove();
    },
  };
}
