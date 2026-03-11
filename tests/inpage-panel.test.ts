import { describe, expect, it, vi } from "vitest";

import { createId } from "../src/core/subtitle-models";
import {
  buildInPagePanelState,
  createInPagePanel,
  IN_PAGE_PANEL_HOST_ID,
} from "../src/content/inpage-panel";
import type { StatusSnapshot } from "../src/shared/message-types";

function createSnapshot(): StatusSnapshot {
  const now = "2026-03-10T09:00:00.000";
  return {
    connected: true,
    requiresReload: false,
    status: "running",
    sessionId: "session_1",
    title: "국회 본회의",
    committeeName: "정무위원회",
    sourceUrl: "https://assembly.webcast.go.kr/main/player.do",
    subtitleCount: 2,
    charCount: 16,
    previewText: "안녕하세요\n지금 회의를 시작하겠습니다.",
    recentEntries: [
      {
        id: createId("entry"),
        text: "안녕하세요",
        timestamp: now,
        startTime: now,
        endTime: now,
        speakerColor: "rgb(35, 124, 147)",
        speakerChannel: "primary",
      },
      {
        id: createId("entry"),
        text: "지금 회의를 시작하겠습니다.",
        timestamp: now,
        startTime: now,
        endTime: now,
        speakerColor: "rgb(30, 30, 30)",
        speakerChannel: "secondary",
        speakerChanged: true,
      },
    ],
    startedAt: now,
    endedAt: null,
    updatedAt: now,
    lastPersistedAt: now,
    observerActive: true,
    currentSelector: "#viewSubtit",
    currentFramePath: [],
  };
}

describe("in-page panel", () => {
  it("builds a user-facing panel state from snapshot", () => {
    const view = buildInPagePanelState(createSnapshot(), {
      collapsed: false,
      notice: "자막을 모으는 중입니다.",
      autoScroll: true,
      recentCopyLineCount: 5,
    });

    expect(view.visible).toBe(true);
    expect(view.collapsed).toBe(false);
    expect(view.autoScroll).toBe(true);
    expect(view.statusLabel).toBe("수집 중");
    expect(view.committeeName).toBe("정무위원회");
    expect(view.notice).toBe("자막을 모으는 중입니다.");
    expect(view.previewSpeakerColor).toBe("rgb(30, 30, 30)");
  });

  it("mounts once and updates content", () => {
    const controller = createInPagePanel({
      onStartCapture: vi.fn(),
      onStopCapture: vi.fn(),
      onClearSession: vi.fn(),
      onSaveSession: vi.fn(),
      onExport: vi.fn(),
      onCopyRecent: vi.fn(),
      onOpenHistory: vi.fn(),
      onOpenOptions: vi.fn(),
      onExpand: vi.fn(),
      onCollapse: vi.fn(),
    });

    controller.update(
      buildInPagePanelState(createSnapshot(), {
        collapsed: false,
        notice: "자막을 모으는 중입니다.",
        autoScroll: true,
        recentCopyLineCount: 5,
      }),
    );

    const host = document.getElementById(IN_PAGE_PANEL_HOST_ID);
    expect(host).not.toBeNull();
    expect(document.querySelectorAll(`#${IN_PAGE_PANEL_HOST_ID}`)).toHaveLength(1);

    const shadowRoot = host?.shadowRoot;
    expect(shadowRoot?.textContent).toContain("국회 자막 도우미");
    expect(shadowRoot?.textContent).toContain("정무위원회");
    expect(shadowRoot?.textContent).toContain("방금 나온 자막");
    expect(shadowRoot?.textContent).toContain("최근 5줄 복사");
    expect(shadowRoot?.textContent).toContain("저장 / 내보내기");

    controller.destroy();
    expect(document.getElementById(IN_PAGE_PANEL_HOST_ID)).toBeNull();
  });

  it("shows collapsed tab after clicking collapse", () => {
    let collapsed = false;
    const controller = createInPagePanel({
      onStartCapture: vi.fn(),
      onStopCapture: vi.fn(),
      onClearSession: vi.fn(),
      onSaveSession: vi.fn(),
      onExport: vi.fn(),
      onCopyRecent: vi.fn(),
      onOpenHistory: vi.fn(),
      onOpenOptions: vi.fn(),
      onExpand: vi.fn(),
      onCollapse: () => {
        collapsed = true;
        controller.update(
        buildInPagePanelState(createSnapshot(), {
          collapsed: true,
          notice: "패널을 접었습니다.",
          autoScroll: true,
          recentCopyLineCount: 5,
        }),
      );
      },
    });

    controller.update(
      buildInPagePanelState(createSnapshot(), {
        collapsed: false,
        notice: "자막을 모으는 중입니다.",
        autoScroll: true,
        recentCopyLineCount: 5,
      }),
    );

    const shadowRoot = document.getElementById(IN_PAGE_PANEL_HOST_ID)?.shadowRoot;
    const collapseButton = [...(shadowRoot?.querySelectorAll("button") ?? [])].find(
      (element) => element.textContent === "접기",
    ) as HTMLButtonElement | undefined;
    collapseButton?.click();

    expect(collapsed).toBe(true);
    expect(shadowRoot?.querySelector(".host")?.classList.contains("collapsed")).toBe(true);
    expect(shadowRoot?.textContent).toContain("자막 보기");

    controller.destroy();
  });

  it("does not force scroll when autoScroll is disabled", () => {
    const controller = createInPagePanel({
      onStartCapture: vi.fn(),
      onStopCapture: vi.fn(),
      onClearSession: vi.fn(),
      onSaveSession: vi.fn(),
      onExport: vi.fn(),
      onCopyRecent: vi.fn(),
      onOpenHistory: vi.fn(),
      onOpenOptions: vi.fn(),
      onExpand: vi.fn(),
      onCollapse: vi.fn(),
    });

    controller.update(
      buildInPagePanelState(createSnapshot(), {
        collapsed: false,
        notice: "자동 스크롤을 끈 상태입니다.",
        autoScroll: false,
        recentCopyLineCount: 3,
      }),
    );

    const shadowRoot = document.getElementById(IN_PAGE_PANEL_HOST_ID)?.shadowRoot;
    const previewBox = shadowRoot?.querySelector(".preview-box") as HTMLDivElement | null;
    const entryList = shadowRoot?.querySelector(".entry-list") as HTMLDivElement | null;

    expect(previewBox?.scrollTop ?? 0).toBe(0);
    expect(entryList?.scrollTop ?? 0).toBe(0);

    controller.destroy();
  });

  it("renders speaker accents and skips rebuilding the list for identical state", () => {
    const controller = createInPagePanel({
      onStartCapture: vi.fn(),
      onStopCapture: vi.fn(),
      onClearSession: vi.fn(),
      onSaveSession: vi.fn(),
      onExport: vi.fn(),
      onCopyRecent: vi.fn(),
      onOpenHistory: vi.fn(),
      onOpenOptions: vi.fn(),
      onExpand: vi.fn(),
      onCollapse: vi.fn(),
    });

    const nextState = buildInPagePanelState(createSnapshot(), {
      collapsed: false,
      notice: "발언자를 추적하고 있습니다.",
      autoScroll: true,
      recentCopyLineCount: 5,
    });

    controller.update(nextState);

    const shadowRoot = document.getElementById(IN_PAGE_PANEL_HOST_ID)?.shadowRoot;
    const previewBox = shadowRoot?.querySelector(".preview-box") as HTMLDivElement | null;
    const previewBadge = shadowRoot?.querySelector(".speaker-badge") as HTMLSpanElement | null;
    const entryList = shadowRoot?.querySelector(".entry-list") as HTMLDivElement | null;
    const firstEntry = entryList?.firstElementChild;

    expect(previewBox?.style.borderLeftColor).toBe("rgb(30, 30, 30)");
    expect(previewBadge?.classList.contains("visible")).toBe(true);

    controller.update(nextState);

    expect(entryList?.firstElementChild).toBe(firstEntry);

    controller.destroy();
  });
});
