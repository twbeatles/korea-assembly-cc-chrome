import type { LivePanelRow } from "../../../core/live-capture";
import type { ExportFormat } from "../../../core/subtitle-models";
import { getExportFormatLabel, UI_TEXT } from "../../../shared/ui-labels";
import { formatDate } from "../formatters";
import { PANEL_STYLE } from "../styles";
import { IN_PAGE_PANEL_HOST_ID, type InPagePanelActions } from "../types";

export interface InPagePanelElements {
  host: HTMLDivElement;
  wrapper: HTMLDivElement;
  statusBadge: HTMLSpanElement;
  headerCount: HTMLSpanElement;
  modeBadge: HTMLSpanElement;
  liveRowCount: HTMLSpanElement;
  liveRowList: HTMLDivElement;
  liveRowEmpty: HTMLParagraphElement;
  liveRowJumpButton: HTMLButtonElement;
  previewSection: HTMLElement;
  previewBox: HTMLDivElement;
  previewToggle: HTMLButtonElement;
  previewScroll: HTMLDivElement;
  statSubtitlesValue: HTMLSpanElement;
  statCharsValue: HTMLSpanElement;
  statElapsedValue: HTMLSpanElement;
  saveButton: HTMLButtonElement;
  copyRecentButton: HTMLButtonElement;
  clearButton: HTMLButtonElement;
  highlightLatestButton: HTMLButtonElement;
  rolloverButton: HTMLButtonElement;
  exportButtons: HTMLButtonElement[];
  notice: HTMLDivElement;
}

export function createLiveRowCard(row: LivePanelRow): HTMLElement {
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

export function createInPagePanelElements(
  actions: InPagePanelActions,
  onLiveRowJump: (container: HTMLElement) => void,
): InPagePanelElements {
  const host = document.createElement("div");
  host.id = IN_PAGE_PANEL_HOST_ID;
  const shadowRoot = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = PANEL_STYLE;

  const wrapper = document.createElement("div");
  wrapper.className = "host";

  const collapsedTab = createButton(
    UI_TEXT.expand,
    actions.onExpand,
    "collapsed-tab",
  );
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
  const statusBadge = document.createElement("span");
  statusBadge.className = "status-badge";
  const headerActions = document.createElement("div");
  headerActions.className = "header-actions";
  const collapseButton = createButton(
    UI_TEXT.collapse,
    actions.onCollapse,
    "secondary icon",
  );
  headerActions.append(statusBadge, headerCount, collapseButton);
  header.append(titleGroup, headerActions);

  const statRow = document.createElement("div");
  statRow.className = "stat-row";
  const statSubtitles = document.createElement("div");
  statSubtitles.className = "stat";
  const statSubtitlesLabel = document.createElement("span");
  statSubtitlesLabel.className = "stat-label";
  statSubtitlesLabel.textContent = "자막";
  const statSubtitlesValue = document.createElement("span");
  statSubtitlesValue.className = "stat-value";
  statSubtitles.append(statSubtitlesLabel, statSubtitlesValue);

  const statChars = document.createElement("div");
  statChars.className = "stat";
  const statCharsLabel = document.createElement("span");
  statCharsLabel.className = "stat-label";
  statCharsLabel.textContent = "글자";
  const statCharsValue = document.createElement("span");
  statCharsValue.className = "stat-value";
  statChars.append(statCharsLabel, statCharsValue);

  const statElapsed = document.createElement("div");
  statElapsed.className = "stat";
  const statElapsedLabel = document.createElement("span");
  statElapsedLabel.className = "stat-label";
  statElapsedLabel.textContent = "경과";
  const statElapsedValue = document.createElement("span");
  statElapsedValue.className = "stat-value";
  statElapsedValue.style.fontVariantNumeric = "tabular-nums";
  statElapsed.append(statElapsedLabel, statElapsedValue);

  statRow.append(statSubtitles, statChars, statElapsed);

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
  liveRowEmpty.textContent =
    "화면에서 자막을 찾으면 수집된 자막이 이곳에 누적됩니다.";
  liveRowList.append(liveRowEmpty);
  const liveRowShell = document.createElement("div");
  liveRowShell.className = "live-row-shell";
  const liveRowJumpButton = createButton(
    "↓",
    () => {
      onLiveRowJump(liveRowList);
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
  previewHint.textContent =
    "지금 화면에서 감지한 최신 자막 흐름을 보조로 표시합니다.";
  previewCopy.append(previewTitle, previewHint);
  const previewToggle = createButton(
    "실시간 내용 접기",
    actions.onTogglePreviewCollapsed,
    "secondary preview-toggle",
  );
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

  const saveGroup = document.createElement("div");
  saveGroup.className = "group";
  const saveGroupLabel = document.createElement("span");
  saveGroupLabel.className = "group-label";
  saveGroupLabel.textContent = "저장 / 복사";
  const saveRow = document.createElement("div");
  saveRow.className = "secondary-row";
  const saveButton = createButton(UI_TEXT.saveSession, actions.onSaveSession);
  const copyRecentButton = createButton(
    UI_TEXT.copyRecent,
    actions.onCopyRecent,
    "secondary",
  );
  saveRow.append(saveButton, copyRecentButton);
  saveGroup.append(saveGroupLabel, saveRow);

  const exportGroup = document.createElement("div");
  exportGroup.className = "group";
  const exportGroupLabel = document.createElement("span");
  exportGroupLabel.className = "group-label";
  exportGroupLabel.textContent = "다른 형식으로 저장";
  const exportRow = document.createElement("div");
  exportRow.className = "export-row";
  const exportButtons = (["txt", "srt", "vtt", "json"] as ExportFormat[]).map(
    (format) => {
      const button = createButton(getExportFormatLabel(format), () =>
        actions.onExport(format),
      );
      exportRow.append(button);
      return button;
    },
  );
  exportGroup.append(exportGroupLabel, exportRow);

  const advancedGroup = document.createElement("div");
  advancedGroup.className = "group";
  const advancedDetails = document.createElement("details");
  advancedDetails.className = "advanced";
  const advancedSummary = document.createElement("summary");
  advancedSummary.textContent = "더보기 · 화면 비우기, 중요 표시, 새 세션";
  const advancedBody = document.createElement("div");
  advancedBody.className = "advanced-body";
  const clearButton = createButton(
    UI_TEXT.clearSession,
    actions.onClearSession,
    "secondary",
  );
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
  advancedBody.append(clearButton, highlightLatestButton, rolloverButton);
  advancedDetails.append(advancedSummary, advancedBody);
  advancedGroup.append(advancedDetails);

  controlsCard.append(saveGroup, exportGroup, advancedGroup);

  const notice = document.createElement("div");
  notice.className = "notice";
  notice.setAttribute("role", "status");
  notice.setAttribute("aria-live", "polite");
  notice.setAttribute("aria-atomic", "true");
  notice.setAttribute("aria-hidden", "true");
  notice.hidden = true;

  const footer = document.createElement("div");
  footer.className = "footer-actions";
  const historyButton = createButton(
    UI_TEXT.openHistory,
    actions.onOpenHistory,
    "secondary",
  );
  const optionsButton = createButton(
    UI_TEXT.openOptions,
    actions.onOpenOptions,
    "secondary",
  );
  const diagnosticsButton = createButton(
    UI_TEXT.openDiagnostics,
    actions.onOpenDiagnostics,
    "secondary",
  );
  footer.append(historyButton, diagnosticsButton, optionsButton);

  const panelScroll = document.createElement("div");
  panelScroll.className = "panel-scroll";
  panelScroll.append(heroCard, statRow, notice, controlsCard, footer);

  panel.append(header, panelScroll);
  wrapper.append(collapsedTab, panel);
  shadowRoot.append(style, wrapper);

  return {
    host,
    wrapper,
    statusBadge,
    headerCount,
    modeBadge,
    liveRowCount,
    liveRowList,
    liveRowEmpty,
    liveRowJumpButton,
    previewSection,
    previewBox,
    previewToggle,
    previewScroll,
    statSubtitlesValue,
    statCharsValue,
    statElapsedValue,
    saveButton,
    copyRecentButton,
    clearButton,
    highlightLatestButton,
    rolloverButton,
    exportButtons,
    notice,
  };
}
