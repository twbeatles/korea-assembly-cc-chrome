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
  .footer-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .header,
  .footer-actions {
    justify-content: space-between;
  }

  .header-actions,
  .action-row {
    flex-wrap: wrap;
  }

  .title-group h1,
  .hero-header h2,
  .section-header h2,
  .summary-copy strong {
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

  .title-group p:last-child {
    margin: 6px 0 0;
    color: #4d6580;
    font-size: 12px;
    line-height: 1.45;
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

  .header-actions .status-badge {
    min-width: 88px;
  }

  .hero-card,
  .summary-card,
  .controls-card,
  .section-card {
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.88);
    border: 1px solid rgba(20, 54, 90, 0.08);
    padding: 14px;
  }

  .hero-card {
    display: grid;
    gap: 12px;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(244, 249, 255, 0.96)),
      #ffffff;
  }

  .hero-header,
  .section-header,
  summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .hero-header h2,
  .section-header h2 {
    font-size: 15px;
  }

  .hero-header p,
  .summary-copy p {
    margin: 4px 0 0;
    color: #60768d;
    font-size: 12px;
    line-height: 1.45;
  }

  .preview-box {
    border-radius: 20px;
    border: 1px solid rgba(20, 54, 90, 0.08);
    background:
      linear-gradient(180deg, rgba(238, 245, 255, 0.96), rgba(228, 239, 252, 0.96)),
      #eff5fc;
    padding: 20px 18px;
    font-size: 24px;
    font-weight: 700;
    line-height: 1.72;
    letter-spacing: -0.01em;
    white-space: pre-wrap;
    min-height: 240px;
    max-height: min(46vh, 420px);
    overflow: auto;
    color: #10263c;
  }

  .notice {
    padding: 10px 12px;
    border-radius: 14px;
    background: rgba(227, 236, 247, 0.72);
    font-size: 13px;
    color: #314b66;
    line-height: 1.5;
  }

  .meta-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .meta-item {
    min-width: 0;
    padding: 10px 12px;
    border-radius: 14px;
    background: #f3f7fc;
  }

  .meta-item span {
    display: block;
    color: #5a7088;
    font-size: 12px;
    margin-bottom: 6px;
  }

  .meta-item strong {
    display: block;
    font-size: 13px;
    color: #173651;
    line-height: 1.45;
    word-break: break-word;
  }

  .controls-card {
    display: grid;
    gap: 10px;
  }

  .action-row button {
    flex: 1;
    min-width: 0;
  }

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

  button.icon {
    width: auto;
    min-width: 0;
    padding: 8px 12px;
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

  details {
    border-radius: 16px;
    background: #f5f8fc;
    border: 1px solid rgba(20, 54, 90, 0.08);
    padding: 0 12px 12px;
  }

  summary {
    list-style: none;
    cursor: pointer;
    padding: 12px 0 10px;
  }

  summary::-webkit-details-marker {
    display: none;
  }

  .summary-copy {
    display: grid;
    gap: 2px;
  }

  .summary-indicator {
    color: #33506d;
    font-size: 12px;
    font-weight: 700;
  }

  .section-header span,
  .hero-header span {
    color: #536b83;
    font-size: 12px;
  }

  .entry-list {
    border-radius: 14px;
    background: #f2f6fb;
    padding: 12px;
    font-size: 13px;
    line-height: 1.6;
  }

  .entry-list {
    display: grid;
    gap: 10px;
    max-height: 188px;
    overflow: auto;
  }

  .entry-card {
    padding-left: 2px;
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
      font-size: 21px;
      min-height: 210px;
    }

    .meta-grid,
    .export-grid {
      grid-template-columns: 1fr;
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

function createMetaItem(label: string): { wrapper: HTMLElement; value: HTMLElement } {
  const wrapper = document.createElement("div");
  wrapper.className = "meta-item";

  const title = document.createElement("span");
  title.textContent = label;

  const value = document.createElement("strong");
  wrapper.append(title, value);
  return { wrapper, value };
}

function buildEntrySignature(entries: SubtitleEntry[]): string {
  return entries
    .map(
      (entry) =>
        `${entry.id}|${entry.text}|${entry.startTime}|${entry.endTime}`,
    )
    .join("||");
}

export function buildInPagePanelState(
  snapshot: StatusSnapshot,
  options: { collapsed: boolean; notice: string; autoScroll: boolean; recentCopyLineCount: number },
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
  subtitle.textContent = "실시간 자막을 먼저 크게 보고, 저장과 내보내기는 아래에서 관리합니다.";
  titleGroup.append(eyebrow, title, subtitle);

  const statusBadge = document.createElement("span");
  statusBadge.className = "status-badge";

  const headerActions = document.createElement("div");
  headerActions.className = "header-actions";
  const collapseButton = createButton(UI_TEXT.collapse, actions.onCollapse, "secondary icon");
  headerActions.append(statusBadge, collapseButton);

  header.append(titleGroup, headerActions);

  const previewSection = document.createElement("section");
  previewSection.className = "hero-card";
  const previewHeader = document.createElement("div");
  previewHeader.className = "hero-header";
  const previewCopy = document.createElement("div");
  const previewTitle = document.createElement("h2");
  previewTitle.textContent = UI_TEXT.livePreview;
  const previewHint = document.createElement("p");
  previewHint.textContent = "가장 최근 문장을 크게 보여줍니다.";
  previewCopy.append(previewTitle, previewHint);
  const previewStats = document.createElement("span");
  previewHeader.append(previewCopy, previewStats);
  const previewBox = document.createElement("div");
  previewBox.className = "preview-box";
  const notice = document.createElement("div");
  notice.className = "notice";
  previewSection.append(previewHeader, previewBox, notice);

  const summaryCard = document.createElement("section");
  summaryCard.className = "summary-card";
  const metaGrid = document.createElement("div");
  metaGrid.className = "meta-grid";
  const committeeMeta = createMetaItem("회의 이름");
  const startedMeta = createMetaItem("시작 시각");
  const lastSavedMeta = createMetaItem("마지막 저장");
  const countMeta = createMetaItem("모인 자막");
  metaGrid.append(
    committeeMeta.wrapper,
    startedMeta.wrapper,
    lastSavedMeta.wrapper,
    countMeta.wrapper,
  );
  summaryCard.append(metaGrid);

  const controlsCard = document.createElement("section");
  controlsCard.className = "controls-card";
  const primaryActions = document.createElement("div");
  primaryActions.className = "action-row";
  const startButton = createButton(UI_TEXT.startCapture, actions.onStartCapture);
  const stopButton = createButton(UI_TEXT.stopCapture, actions.onStopCapture);
  const copyRecentButton = createButton(UI_TEXT.copyRecent, actions.onCopyRecent, "secondary");
  primaryActions.append(startButton, stopButton, copyRecentButton);

  const secondaryActions = document.createElement("div");
  secondaryActions.className = "action-row";
  const clearButton = createButton(UI_TEXT.clearSession, actions.onClearSession, "secondary");
  const saveButton = createButton(UI_TEXT.saveSession, actions.onSaveSession, "secondary");
  secondaryActions.append(clearButton, saveButton);

  const exportDetails = document.createElement("details");
  exportDetails.open = false;
  const exportSummary = document.createElement("summary");
  const exportSummaryCopy = document.createElement("div");
  exportSummaryCopy.className = "summary-copy";
  const exportSummaryTitle = document.createElement("strong");
  exportSummaryTitle.textContent = "저장 / 내보내기";
  const exportSummaryHint = document.createElement("p");
  exportSummaryHint.textContent = "TXT, SRT, VTT, JSON 형식으로 내보낼 수 있습니다.";
  exportSummaryCopy.append(exportSummaryTitle, exportSummaryHint);
  const exportIndicator = document.createElement("span");
  exportIndicator.className = "summary-indicator";
  exportIndicator.textContent = "펼치기";
  exportSummary.append(exportSummaryCopy, exportIndicator);
  exportDetails.addEventListener("toggle", () => {
    exportIndicator.textContent = exportDetails.open ? "접기" : "펼치기";
  });

  const exportGrid = document.createElement("div");
  exportGrid.className = "export-grid";
  const exportButtons = (["txt", "srt", "vtt", "json"] as ExportFormat[]).map((format) => {
    const button = createButton(getExportFormatLabel(format), () => actions.onExport(format), "ghost");
    exportGrid.append(button);
    return button;
  });
  exportDetails.append(exportSummary, exportGrid);
  controlsCard.append(primaryActions, secondaryActions, exportDetails);

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
  footer.append(historyButton, optionsButton);

  panel.append(
    header,
    previewSection,
    summaryCard,
    controlsCard,
    listSection,
    footer,
  );
  wrapper.append(collapsedTab, panel);
  shadowRoot.append(style, wrapper);
  (document.body || document.documentElement).appendChild(host);

  const emptyPreviewText = "자막이 잡히면 이곳에 실시간으로 쌓입니다.";
  let renderedPreview = "";
  let renderedNotice = "";
  let renderedListSignature = "";
  let renderedCollapsed = false;

  return {
    update(nextState) {
      host.style.display = nextState.visible ? "block" : "none";
      if (renderedCollapsed !== nextState.collapsed) {
        wrapper.classList.toggle("collapsed", nextState.collapsed);
        renderedCollapsed = nextState.collapsed;
      }

      statusBadge.textContent = nextState.statusLabel;
      statusBadge.className = `status-badge ${nextState.status}`;

      committeeMeta.value.textContent = nextState.committeeName;
      startedMeta.value.textContent = formatDate(nextState.startedAt);
      lastSavedMeta.value.textContent = formatDate(nextState.lastPersistedAt);
      countMeta.value.textContent = `${nextState.subtitleCount}문장 / ${nextState.charCount}자`;
      copyRecentButton.textContent = `최근 ${nextState.recentCopyLineCount}줄 복사`;

      previewStats.textContent = `${nextState.subtitleCount}문장`;
      const nextPreview = nextState.previewText || emptyPreviewText;
      const previewChanged = renderedPreview !== nextPreview;
      if (previewChanged) {
        previewBox.textContent = nextPreview;
        renderedPreview = nextPreview;
      }

      if (renderedNotice !== nextState.notice) {
        notice.textContent = nextState.notice;
        renderedNotice = nextState.notice;
      }

      const nextListSignature = buildEntrySignature(nextState.recentEntries);
      const listChanged = renderedListSignature !== nextListSignature;
      listCount.textContent = `${nextState.recentEntries.length}개`;
      if (listChanged) {
        entryList.replaceChildren();
        if (nextState.recentEntries.length) {
          nextState.recentEntries.forEach((entry) => entryList.appendChild(createEntryCard(entry)));
        } else {
          const empty = document.createElement("p");
          empty.className = "empty-text";
          empty.textContent = "아직 모인 자막이 없습니다.";
          entryList.append(empty);
        }
        renderedListSignature = nextListSignature;
      }

      const hasEntries = nextState.subtitleCount > 0;
      const hasPersistableContent = hasEntries || Boolean(nextState.previewText.trim());
      startButton.disabled = nextState.status === "running";
      stopButton.disabled = nextState.status !== "running";
      clearButton.disabled = !hasPersistableContent;
      saveButton.disabled = !hasPersistableContent;
      copyRecentButton.disabled = !hasPersistableContent;
      exportButtons.forEach((button) => {
        button.disabled = !hasPersistableContent;
      });

      if (!nextState.collapsed && nextState.autoScroll && listChanged) {
        entryList.scrollTop = entryList.scrollHeight;
      }
      if (!nextState.collapsed && nextState.autoScroll && previewChanged) {
        previewBox.scrollTop = previewBox.scrollHeight;
      }
    },
    destroy() {
      host.remove();
    },
  };
}
