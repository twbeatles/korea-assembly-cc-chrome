import { describe, expect, it, vi } from "vitest";

import { createId } from "../src/core/subtitle-models";
import type { LivePanelRow } from "../src/core/live-capture";
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
      },
      {
        id: createId("entry"),
        text: "지금 회의를 시작하겠습니다.",
        timestamp: now,
        startTime: now,
        endTime: now,
      },
    ],
    startedAt: now,
    endedAt: null,
    updatedAt: now,
    lastPersistedAt: now,
    observerActive: true,
    currentSelector: "#viewSubtit",
    currentFramePath: [],
    diagnostics: {
      captureMode: "structured",
      observerActive: true,
      currentSelector: "#viewSubtit",
      currentFramePath: [],
      sourceLabel: "structured",
    },
  };
}

function createLiveRows(): LivePanelRow[] {
  return [
    {
      key: "top::row_1",
      text: "안녕하세요",
      nodeKey: "row_1",
      speakerColor: "rgb(35, 124, 147)",
      speakerChannel: "primary",
      updatedAt: Date.parse("2026-03-10T09:00:00.000Z"),
    },
  ];
}

function buildPanelState(overrides?: Partial<Parameters<typeof buildInPagePanelState>[1]>) {
  return buildInPagePanelState(createSnapshot(), {
    collapsed: false,
    notice: "자막을 모으는 중입니다.",
    autoScroll: true,
    recentCopyLineCount: 5,
    livePreviewText: "안녕하세요",
    liveRows: createLiveRows(),
    ...overrides,
  });
}

describe("in-page panel", () => {
  it("builds a user-facing panel state from snapshot", () => {
    const view = buildPanelState();

    expect(view.visible).toBe(true);
    expect(view.collapsed).toBe(false);
    expect(view.autoScroll).toBe(true);
    expect(view.statusLabel).toBe("수집 중");
    expect(view.committeeName).toBe("정무위원회");
    expect(view.notice).toBe("자막을 모으는 중입니다.");
    expect(view.liveRows).toHaveLength(1);
    expect(view.captureMode).toBe("structured");
  });

  it("mounts once and renders both live and committed sections", () => {
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

    controller.update(buildPanelState());

    const host = document.getElementById(IN_PAGE_PANEL_HOST_ID);
    expect(host).not.toBeNull();
    expect(document.querySelectorAll(`#${IN_PAGE_PANEL_HOST_ID}`)).toHaveLength(1);

    const shadowRoot = host?.shadowRoot;
    expect(shadowRoot?.textContent).toContain("국회 자막 도우미");
    expect(shadowRoot?.textContent).toContain("실시간 내용");
    expect(shadowRoot?.textContent).toContain("화면 자막");
    expect(shadowRoot?.textContent).toContain("수집 진단");
    expect(shadowRoot?.textContent).toContain("structured");
    expect(shadowRoot?.textContent).not.toContain("방금 나온 자막");
    expect(shadowRoot?.textContent).toContain("최근 5줄 복사");

    expect(shadowRoot?.querySelector(".preview-box")?.getAttribute("role")).toBe("status");
    expect(shadowRoot?.querySelector(".live-row-list")?.getAttribute("role")).toBe("log");
    expect(shadowRoot?.querySelector(".notice")?.getAttribute("aria-live")).toBe("polite");

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
          buildPanelState({
            collapsed: true,
            notice: "패널을 접었습니다.",
          }),
        );
      },
    });

    controller.update(buildPanelState());

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
      buildPanelState({
        autoScroll: false,
        recentCopyLineCount: 3,
      }),
    );

    const shadowRoot = document.getElementById(IN_PAGE_PANEL_HOST_ID)?.shadowRoot;
    const liveRowList = shadowRoot?.querySelector(".live-row-list") as HTMLDivElement | null;
    const previewScroll = shadowRoot?.querySelector(".preview-scroll") as HTMLDivElement | null;

    if (previewScroll) {
      Object.defineProperty(previewScroll, "scrollHeight", {
        configurable: true,
        value: 420,
      });
      previewScroll.scrollTop = 17;
    }

    expect(liveRowList?.scrollTop ?? 0).toBe(0);
    expect(previewScroll?.scrollTop ?? 0).toBe(17);
    expect(shadowRoot?.querySelector(".entry-list")).toBeNull();

    controller.destroy();
  });

  it("auto-scrolls the preview box when preview text grows", () => {
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

    controller.update(buildPanelState());

    const shadowRoot = document.getElementById(IN_PAGE_PANEL_HOST_ID)?.shadowRoot;
    const previewScroll = shadowRoot?.querySelector(".preview-scroll") as HTMLDivElement | null;
    expect(previewScroll).not.toBeNull();

    Object.defineProperty(previewScroll, "scrollHeight", {
      configurable: true,
      value: 560,
    });
    previewScroll!.scrollTop = 0;

    controller.update(
      buildPanelState({
        livePreviewText: "안녕하세요\n두 번째 줄입니다.\n세 번째 줄입니다.",
      }),
    );

    expect(previewScroll?.scrollTop).toBe(560);

    controller.destroy();
  });

  it("does not reset the live row scroll position when only preview text changes", () => {
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

    controller.update(buildPanelState());

    const shadowRoot = document.getElementById(IN_PAGE_PANEL_HOST_ID)?.shadowRoot;
    const liveRowList = shadowRoot?.querySelector(".live-row-list") as HTMLDivElement | null;
    expect(liveRowList).not.toBeNull();

    Object.defineProperty(liveRowList, "scrollHeight", {
      configurable: true,
      value: 640,
    });
    liveRowList!.scrollTop = 123;

    controller.update(
      buildPanelState({
        livePreviewText: "미리보기만 바뀌었습니다.",
      }),
    );

    expect(liveRowList?.scrollTop).toBe(123);

    controller.destroy();
  });

  it("reuses the live row DOM node when the same row key is updated", () => {
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

    controller.update(buildPanelState());

    const shadowRoot = document.getElementById(IN_PAGE_PANEL_HOST_ID)?.shadowRoot;
    const liveRowList = shadowRoot?.querySelector(".live-row-list") as HTMLDivElement | null;
    const firstLiveRow = liveRowList?.querySelector(".live-row");

    controller.update(
      buildPanelState({
        livePreviewText: "안녕하세요 수정",
        liveRows: [
          {
            ...createLiveRows()[0],
            text: "안녕하세요 수정",
            updatedAt: Date.parse("2026-03-10T09:00:01.000Z"),
          },
        ],
      }),
    );

    const updatedLiveRow = liveRowList?.querySelector(".live-row");
    expect(updatedLiveRow).toBe(firstLiveRow);
    expect(updatedLiveRow?.textContent).toContain("안녕하세요 수정");

    controller.destroy();
  });
});
