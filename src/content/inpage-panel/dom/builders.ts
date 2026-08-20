import type { LivePanelRow } from "../../../core/live-capture";
import {
  formatSpeakerBadge,
  resolveSpeakerAccentColor,
  resolveSpeakerLabelForOutput,
} from "../../../core/exporters/speaker-label";
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
  startCaptureButton: HTMLButtonElement;
  stopCaptureButton: HTMLButtonElement;
  saveButton: HTMLButtonElement;
  copyRecentButton: HTMLButtonElement;
  txtExportButton: HTMLButtonElement;
  clearButton: HTMLButtonElement;
  highlightLatestButton: HTMLButtonElement;
  rolloverButton: HTMLButtonElement;
  exportButtons: HTMLButtonElement[];
  speakerHighlightToggle: HTMLInputElement;
  exportSpeakerToggle: HTMLInputElement;
  notice: HTMLDivElement;
}

export function applyLiveRowSpeakerPresentation(
  article: HTMLElement,
  row: LivePanelRow,
  showSpeakerHighlight: boolean,
): void {
  article.classList.remove(
    "speaker-highlight",
    "speaker-primary",
    "speaker-secondary",
    "speaker-unknown",
  );
  article.style.removeProperty("border-left-color");

  const existingBadge = article.querySelector<HTMLElement>(".speaker-badge");
  if (!showSpeakerHighlight) {
    existingBadge?.remove();
    return;
  }

  const channel = row.speakerChannel || "unknown";
  article.classList.add("speaker-highlight", `speaker-${channel}`);
  const accent = resolveSpeakerAccentColor(row.speakerColor, channel);
  if (accent) {
    article.style.borderLeftColor = accent;
  }

  let badge = existingBadge;
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "speaker-badge";
    const time = article.querySelector("time");
    if (time) {
      time.insertAdjacentElement("afterend", badge);
    } else {
      article.prepend(badge);
    }
  }

  badge.textContent = formatSpeakerBadge(channel);
  badge.setAttribute(
    "aria-label",
    resolveSpeakerLabelForOutput(
      { speakerChannel: channel },
      null,
      { unknownLabel: "알 수 없음" },
    ),
  );
}

export function createLiveRowCard(
  row: LivePanelRow,
  showSpeakerHighlight = false,
): HTMLElement {
  const article = document.createElement("article");
  article.className = "live-row";
  article.dataset.rowKey = row.key;

  const time = document.createElement("time");
  time.textContent = formatDate(row.updatedAt);

  const text = document.createElement("p");
  text.textContent = row.text;

  article.append(time, text);
  applyLiveRowSpeakerPresentation(article, row, showSpeakerHighlight);
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
  // 운영: closed 로 페이지 스크립트 변조를 어렵게 한다.
  // Vitest 는 host.shadowRoot 로 DOM 을 검사하므로 test 모드만 open.
  const shadowMode: ShadowRootMode =
    typeof import.meta !== "undefined" &&
    Boolean(
      (import.meta as ImportMeta & { env?: { MODE?: string; VITEST?: boolean } }).env
        ?.VITEST ||
        (import.meta as ImportMeta & { env?: { MODE?: string } }).env?.MODE === "test",
    )
      ? "open"
      : "closed";
  const shadowRoot = host.attachShadow({ mode: shadowMode });

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

  const speakerToggleBar = document.createElement("div");
  speakerToggleBar.className = "speaker-toggle-bar";
  speakerToggleBar.setAttribute("role", "group");
  speakerToggleBar.setAttribute("aria-label", "발언자 표시 및 내보내기");

  const speakerHighlightLabel = document.createElement("label");
  speakerHighlightLabel.className = "speaker-toggle";
  const speakerHighlightToggle = document.createElement("input");
  speakerHighlightToggle.type = "checkbox";
  speakerHighlightToggle.className = "speaker-toggle-input";
  speakerHighlightToggle.setAttribute("aria-label", "패널에 발언자 색 표시");
  speakerHighlightToggle.addEventListener("change", () => {
    actions.onSetSpeakerHighlight(speakerHighlightToggle.checked);
  });
  const speakerHighlightText = document.createElement("span");
  speakerHighlightText.textContent = "발언자 보기";
  speakerHighlightLabel.append(speakerHighlightToggle, speakerHighlightText);

  const exportSpeakerLabel = document.createElement("label");
  exportSpeakerLabel.className = "speaker-toggle";
  const exportSpeakerToggle = document.createElement("input");
  exportSpeakerToggle.type = "checkbox";
  exportSpeakerToggle.className = "speaker-toggle-input";
  exportSpeakerToggle.setAttribute("aria-label", "내보내기·복사에 발언자 포함");
  exportSpeakerToggle.addEventListener("change", () => {
    actions.onSetExportSpeaker(exportSpeakerToggle.checked);
  });
  const exportSpeakerText = document.createElement("span");
  exportSpeakerText.textContent = "내보내기·복사";
  exportSpeakerLabel.append(exportSpeakerToggle, exportSpeakerText);

  speakerToggleBar.append(speakerHighlightLabel, exportSpeakerLabel);

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

  heroCard.append(liveRowHeader, speakerToggleBar, liveRowShell, previewSection);

  const controlsCard = document.createElement("section");
  controlsCard.className = "controls-card";

  const captureGroup = document.createElement("div");
  captureGroup.className = "group capture-group";
  const captureGroupLabel = document.createElement("span");
  captureGroupLabel.className = "group-label";
  captureGroupLabel.textContent = "자막 수집";
  const captureRow = document.createElement("div");
  captureRow.className = "capture-row";
  const startCaptureButton = createButton("수집 시작", actions.onStartCapture);
  const stopCaptureButton = createButton("수집 종료", actions.onStopCapture, "stop-action");
  captureRow.append(startCaptureButton, stopCaptureButton);
  captureGroup.append(captureGroupLabel, captureRow);

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
  exportGroupLabel.textContent = "파일로 내보내기";
  const txtExportButton = createButton("TXT 저장", () => actions.onExport("txt"));
  txtExportButton.classList.add("txt-export-button");
  const exportDetails = document.createElement("details");
  exportDetails.className = "export-details";
  const exportSummary = document.createElement("summary");
  exportSummary.textContent = "다른 형식 선택";
  const exportRow = document.createElement("div");
  exportRow.className = "export-row";
  const exportButtons = (["srt", "vtt", "json", "md", "csv"] as ExportFormat[]).map(
    (format) => {
      const button = createButton(getExportFormatLabel(format), () =>
        actions.onExport(format),
      );
      exportRow.append(button);
      return button;
    },
  );
  exportDetails.append(exportSummary, exportRow);
  exportGroup.append(exportGroupLabel, txtExportButton, exportDetails);

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

  controlsCard.append(captureGroup, saveGroup, exportGroup, advancedGroup);

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
    startCaptureButton,
    stopCaptureButton,
    saveButton,
    copyRecentButton,
    txtExportButton,
    clearButton,
    highlightLatestButton,
    rolloverButton,
    exportButtons,
    speakerHighlightToggle,
    exportSpeakerToggle,
    notice,
  };
}
