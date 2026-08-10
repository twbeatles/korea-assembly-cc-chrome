import type { LivePanelRow } from "../../../core/live-capture";
import {
  applyLiveRowSpeakerPresentation,
  createInPagePanelElements,
  createLiveRowCard,
} from "../dom/builders";
import {
  formatCaptureMode,
  formatDate,
  formatElapsedTime,
} from "../formatters";
import { isScrollNearBottom, scrollToBottom } from "../scroll";
import {
  IN_PAGE_PANEL_HOST_ID,
  type InPagePanelActions,
  type InPagePanelController,
} from "../types";

function buildPreviewSignature(previewText: string): string {
  return previewText;
}

function buildLiveRowsSignature(
  rows: LivePanelRow[],
  showSpeakerHighlight: boolean,
): string {
  return `${showSpeakerHighlight ? "1" : "0"}|${rows
    .map(
      (row) =>
        `${row.key}|${row.text}|${row.updatedAt}|${row.speakerChannel}|${row.speakerColor}`,
    )
    .join("||")}`;
}

export function createInPagePanel(
  actions: InPagePanelActions,
): InPagePanelController {
  const existingHost = document.getElementById(IN_PAGE_PANEL_HOST_ID);
  existingHost?.remove();

  let syncLiveRowJumpButton: (hasRows?: boolean) => void = () => undefined;
  const {
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
    speakerHighlightToggle,
    exportSpeakerToggle,
    notice,
  } = createInPagePanelElements(actions, (container) => {
    scrollToBottom(container);
    syncLiveRowJumpButton();
  });

  (document.body || document.documentElement).appendChild(host);

  const emptyPreviewText = "자막이 잡히면 이곳에 실시간으로 표시됩니다.";
  const liveRowNodes = new Map<string, HTMLElement>();
  let renderedNotice = "";
  let renderedShowNotice: boolean | null = null;
  let renderedCollapsed = false;
  let renderedPreviewCollapsed: boolean | null = null;
  let renderedPreviewSignature = "";
  let renderedLiveRowsSignature = "";

  syncLiveRowJumpButton = (hasRows = liveRowNodes.size > 0): void => {
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
        previewSection.classList.toggle(
          "collapsed",
          nextState.previewCollapsed,
        );
        previewBox.setAttribute(
          "aria-hidden",
          String(nextState.previewCollapsed),
        );
        previewToggle.textContent = nextState.previewCollapsed
          ? "실시간 내용 펼치기"
          : "실시간 내용 접기";
        previewToggle.setAttribute(
          "aria-expanded",
          String(!nextState.previewCollapsed),
        );
        renderedPreviewCollapsed = nextState.previewCollapsed;
      }

      statusBadge.textContent = nextState.statusLabel;
      statusBadge.className = `status-badge ${nextState.status}`;
      headerCount.textContent = `자막 ${nextState.subtitleCount}줄`;
      modeBadge.textContent = formatCaptureMode(nextState.captureMode);
      liveRowCount.textContent = `${nextState.liveRows.length}개`;
      copyRecentButton.textContent = `최근 ${nextState.recentCopyLineCount}줄 복사`;

      if (speakerHighlightToggle.checked !== nextState.showSpeakerHighlight) {
        speakerHighlightToggle.checked = nextState.showSpeakerHighlight;
      }
      if (exportSpeakerToggle.checked !== nextState.exportSpeakerEnabled) {
        exportSpeakerToggle.checked = nextState.exportSpeakerEnabled;
      }

      statSubtitlesValue.textContent = `${nextState.subtitleCount.toLocaleString("ko-KR")}줄`;
      statCharsValue.textContent = `${nextState.charCount.toLocaleString("ko-KR")}자`;
      statElapsedValue.textContent = formatElapsedTime(
        nextState.startedAt,
        nextState.status,
      );

      const nextPreviewText =
        nextState.livePreviewText.trim() ||
        nextState.previewText.trim() ||
        emptyPreviewText;
      const nextPreviewSignature = buildPreviewSignature(nextPreviewText);
      const previewChanged = renderedPreviewSignature !== nextPreviewSignature;
      if (previewChanged) {
        previewScroll.textContent = nextPreviewText;
        renderedPreviewSignature = nextPreviewSignature;
      }

      const nextLiveRowsSignature = buildLiveRowsSignature(
        nextState.liveRows,
        nextState.showSpeakerHighlight,
      );
      const liveRowsChanged =
        renderedLiveRowsSignature !== nextLiveRowsSignature;
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
              node = createLiveRowCard(row, nextState.showSpeakerHighlight);
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
            applyLiveRowSpeakerPresentation(
              node,
              row,
              nextState.showSpeakerHighlight,
            );

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

      const nextNotice = nextState.notice;
      if (renderedNotice !== nextNotice) {
        notice.textContent = nextNotice;
        notice.dataset.message = nextNotice;
        renderedNotice = nextNotice;
      }

      const nextShowNotice = nextState.showNotice;
      if (renderedShowNotice !== nextShowNotice) {
        notice.hidden = !nextShowNotice;
        notice.setAttribute("aria-hidden", String(!nextShowNotice));
        renderedShowNotice = nextShowNotice;
      }

      clearButton.disabled = !nextState.canClearSession;
      saveButton.disabled = !nextState.hasPersistableContent;
      highlightLatestButton.disabled = !nextState.canHighlightLatestEntry;
      rolloverButton.disabled =
        nextState.status !== "running" || !nextState.hasPersistableContent;
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
