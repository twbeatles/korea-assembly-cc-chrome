import { describe, expect, it, vi } from "vitest";

import { createId } from "../src/core/subtitle-models";
import type { LivePanelRow } from "../src/core/live-capture";
import {
  buildInPagePanelState,
  createInPagePanel,
  IN_PAGE_PANEL_HOST_ID,
} from "../src/content/inpage-panel";
import type { StatusSnapshot } from "../src/shared/message-types";
import { PIPELINE_DEFAULTS } from "../src/shared/constants";

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
      persistabilityState: "persistable",
      persistabilityHint: "저장 가능한 확정 자막이 누적되고 있습니다.",
      health: "good",
      healthLabel: "좋음",
      healthHint: "자막이 안정적으로 수집되고 있습니다.",
      estimatedBytes: 128,
      sizeWarning: "",
      stableRowCount: 2,
      unstableRowCount: 0,
      filteredUnconfirmedCount: 0,
      rowKeySources: { class: 2 },
      fallbackCommitState: "idle",
    },
    hasPersistableContent: true,
  };
}

function createLiveRows(count = 1): LivePanelRow[] {
  return Array.from({ length: count }, (_, index) => ({
    key: `top::row_${index + 1}`,
    text: index === 0 ? "안녕하세요" : `${index + 1}번째 자막입니다.`,
    nodeKey: `row_${index + 1}`,
    speakerColor: "rgb(35, 124, 147)",
    speakerChannel: "primary",
    updatedAt: Date.parse(`2026-03-10T09:00:0${index}.000Z`),
  }));
}

function mockScrollableMetrics(
  element: HTMLDivElement,
  metrics: { scrollHeight: number; clientHeight: number },
): void {
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    value: metrics.scrollHeight,
  });
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value: metrics.clientHeight,
  });
}

function buildPanelState(input?: {
  snapshot?: Partial<StatusSnapshot>;
  options?: Partial<Parameters<typeof buildInPagePanelState>[1]>;
}) {
  return buildInPagePanelState(
    {
      ...createSnapshot(),
      ...input?.snapshot,
    },
    {
      collapsed: false,
      previewCollapsed: true,
      notice: "자막을 모으는 중입니다.",
      showNotice: true,
      autoScroll: true,
      recentCopyLineCount: 5,
      livePreviewText: "안녕하세요",
      liveRows: createLiveRows(),
      canClearSession: true,
      ...input?.options,
    },
  );
}

function createActions() {
  return {
    onStartCapture: vi.fn(),
    onStopCapture: vi.fn(),
    onClearSession: vi.fn(),
    onSaveSession: vi.fn(),
    onHighlightLatestEntry: vi.fn(),
    onExport: vi.fn(),
    onCopyRecent: vi.fn(),
    onOpenHistory: vi.fn(),
    onOpenOptions: vi.fn(),
    onOpenDiagnostics: vi.fn(),
    onExpand: vi.fn(),
    onCollapse: vi.fn(),
    onTogglePreviewCollapsed: vi.fn(),
  };
}

describe("in-page panel", () => {
  it("builds a user-facing panel state from snapshot", () => {
    const view = buildPanelState();

    expect(view.visible).toBe(true);
    expect(view.collapsed).toBe(false);
    expect(view.previewCollapsed).toBe(true);
    expect(view.autoScroll).toBe(true);
    expect(view.statusLabel).toBe("수집 중");
    expect(view.committeeName).toBe("정무위원회");
    expect(view.notice).toBe("자막을 모으는 중입니다.");
    expect(view.liveRows).toHaveLength(1);
    expect(view.captureMode).toBe("structured");
  });

  it("keeps the panel visible even when the current page is not capture-ready", () => {
    const view = buildPanelState({
      snapshot: {
        connected: false,
        status: "idle",
        sourceUrl: "https://assembly.webcast.go.kr/main/",
      },
    });

    expect(view.visible).toBe(true);
  });

  it("mounts once and renders the live sections with footer menus", () => {
    const controller = createInPagePanel(createActions());

    controller.update(buildPanelState());

    const host = document.getElementById(IN_PAGE_PANEL_HOST_ID);
    expect(host).not.toBeNull();
    expect(document.querySelectorAll(`#${IN_PAGE_PANEL_HOST_ID}`)).toHaveLength(
      1,
    );

    const shadowRoot = host?.shadowRoot;
    expect(shadowRoot?.textContent).toContain("국회 자막 도우미");
    expect(shadowRoot?.textContent).toContain("실시간 내용");
    expect(shadowRoot?.textContent).toContain("수집된 자막");
    expect(shadowRoot?.textContent).toContain("상태 확인");
    expect(shadowRoot?.textContent).not.toContain("건강도");
    expect(shadowRoot?.textContent).toContain("환경 설정");
    expect(shadowRoot?.textContent).not.toContain("방금 나온 자막");
    expect(shadowRoot?.textContent).toContain("최근 5줄 복사");
    expect(shadowRoot?.querySelector(".panel-scroll")).not.toBeNull();

    const notice = shadowRoot?.querySelector(
      ".notice",
    ) as HTMLDivElement | null;
    expect(
      shadowRoot?.querySelector(".preview-box")?.getAttribute("role"),
    ).toBe("status");
    expect(
      shadowRoot?.querySelector(".live-row-list")?.getAttribute("role"),
    ).toBe("log");
    expect(notice?.getAttribute("aria-live")).toBe("polite");
    expect(notice?.hidden).toBe(false);
    expect(notice?.getAttribute("aria-hidden")).toBe("false");
    expect(notice?.textContent).toBe("자막을 모으는 중입니다.");
    expect(notice?.dataset.message).toBe("자막을 모으는 중입니다.");
    expect(shadowRoot?.querySelector(".preview-toggle")?.textContent).toBe(
      "실시간 내용 펼치기",
    );

    controller.destroy();
    expect(document.getElementById(IN_PAGE_PANEL_HOST_ID)).toBeNull();
  });

  it("renders the screen subtitles section before the preview section", () => {
    const controller = createInPagePanel(createActions());

    controller.update(buildPanelState());

    const shadowRoot = document.getElementById(
      IN_PAGE_PANEL_HOST_ID,
    )?.shadowRoot;
    const screenSubtitleTitle = shadowRoot?.querySelector(
      ".section-header h2",
    ) as HTMLHeadingElement | null;
    const previewTitle = shadowRoot?.querySelector(
      ".preview-header h2",
    ) as HTMLHeadingElement | null;

    expect(screenSubtitleTitle?.textContent).toBe("수집된 자막");
    expect(previewTitle?.textContent).toBe("실시간 내용");
    expect(screenSubtitleTitle).not.toBeNull();
    expect(previewTitle).not.toBeNull();
    expect(
      screenSubtitleTitle!.compareDocumentPosition(previewTitle!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    controller.destroy();
  });

  it("prioritizes the collected subtitle layout and removes the manual capture button", () => {
    const controller = createInPagePanel(createActions());

    controller.update(buildPanelState());

    const shadowRoot = document.getElementById(
      IN_PAGE_PANEL_HOST_ID,
    )?.shadowRoot;
    const panelScroll = shadowRoot?.querySelector(
      ".panel-scroll",
    ) as HTMLDivElement | null;
    const heroCard = shadowRoot?.querySelector(
      ".hero-card",
    ) as HTMLElement | null;
    const statRow = shadowRoot?.querySelector(
      ".stat-row",
    ) as HTMLElement | null;
    const buttons = [...(shadowRoot?.querySelectorAll("button") ?? [])];

    expect(heroCard).not.toBeNull();
    expect(statRow).not.toBeNull();
    expect(panelScroll?.firstElementChild).toBe(heroCard);
    expect(
      heroCard!.compareDocumentPosition(statRow!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      buttons.some((button) => button.textContent === "자막 모으기"),
    ).toBe(false);
    expect(buttons.some((button) => button.textContent === "멈추기")).toBe(
      false,
    );

    controller.destroy();
  });

  it("lets the live preview expansion grow within the collected subtitle card", () => {
    const controller = createInPagePanel(createActions());

    controller.update(
      buildPanelState({
        options: {
          previewCollapsed: false,
        },
      }),
    );

    const shadowRoot = document.getElementById(
      IN_PAGE_PANEL_HOST_ID,
    )?.shadowRoot;
    const styleText = shadowRoot?.querySelector("style")?.textContent ?? "";
    const previewSection = shadowRoot?.querySelector(
      ".preview-section",
    ) as HTMLDivElement | null;
    const previewToggle = shadowRoot?.querySelector(
      ".preview-toggle",
    ) as HTMLButtonElement | null;

    expect(previewSection?.classList.contains("collapsed")).toBe(false);
    expect(previewToggle?.textContent).toBe("실시간 내용 접기");
    expect(styleText).toMatch(/\.hero-card\s*\{[\s\S]*?flex:\s*1 0 auto;/);
    expect(styleText).toMatch(
      /\.preview-section\s*\{[\s\S]*?flex:\s*0 0 auto;/,
    );

    controller.destroy();
  });

  it("shows a live capture label while fallback collection is still producing subtitles", () => {
    const controller = createInPagePanel(createActions());

    controller.update(
      buildPanelState({
        snapshot: {
          diagnostics: {
            ...createSnapshot().diagnostics,
            captureMode: "fallback",
            persistabilityState: "preview_only",
            persistabilityHint:
              "화면에는 자막이 보이지만 아직 저장 가능한 확정 자막은 없습니다.",
          },
        },
        options: {
          notice:
            "실시간 자막을 수집 중입니다. 감지 경로를 자동으로 조정하고 있습니다.",
          livePreviewText: "계속 수집되는 자막",
          liveRows: [],
        },
      }),
    );

    const shadowRoot = document.getElementById(
      IN_PAGE_PANEL_HOST_ID,
    )?.shadowRoot;
    const notice = shadowRoot?.querySelector(
      ".notice",
    ) as HTMLDivElement | null;
    expect(shadowRoot?.textContent).toContain("실시간 자막");
    expect(shadowRoot?.textContent).toContain(
      "실시간 자막을 수집 중입니다. 감지 경로를 자동으로 조정하고 있습니다.",
    );
    expect(notice?.hidden).toBe(false);
    expect(notice?.dataset.message).toBe(
      "실시간 자막을 수집 중입니다. 감지 경로를 자동으로 조정하고 있습니다.",
    );
    expect(notice?.textContent).toBe(
      "실시간 자막을 수집 중입니다. 감지 경로를 자동으로 조정하고 있습니다.",
    );

    controller.destroy();
  });

  it("keeps the idle notice hidden when showNotice is false", () => {
    const controller = createInPagePanel(createActions());

    controller.update(
      buildPanelState({
        snapshot: {
          status: "idle",
          hasPersistableContent: false,
          previewText: "",
        },
        options: {
          notice: "페이지 오른쪽에서 수집된 자막을 바로 보고 있습니다.",
          showNotice: false,
          livePreviewText: "",
          liveRows: [],
          canClearSession: false,
        },
      }),
    );

    const shadowRoot = document.getElementById(
      IN_PAGE_PANEL_HOST_ID,
    )?.shadowRoot;
    const notice = shadowRoot?.querySelector(
      ".notice",
    ) as HTMLDivElement | null;
    expect(notice?.hidden).toBe(true);
    expect(notice?.getAttribute("aria-hidden")).toBe("true");

    controller.destroy();
  });

  it("shows collapsed tab after clicking collapse", () => {
    let collapsed = false;
    const actions = createActions();
    const controller = createInPagePanel({
      ...actions,
      onCollapse: () => {
        collapsed = true;
        controller.update(
          buildPanelState({
            options: {
              collapsed: true,
              notice: "패널을 접었습니다.",
            },
          }),
        );
      },
    });

    controller.update(buildPanelState());

    const shadowRoot = document.getElementById(
      IN_PAGE_PANEL_HOST_ID,
    )?.shadowRoot;
    const collapseButton = [
      ...(shadowRoot?.querySelectorAll("button") ?? []),
    ].find((element) => element.textContent === "접기") as
      | HTMLButtonElement
      | undefined;
    collapseButton?.click();

    expect(collapsed).toBe(true);
    expect(
      shadowRoot?.querySelector(".host")?.classList.contains("collapsed"),
    ).toBe(true);
    expect(shadowRoot?.textContent).toContain("자막 보기");

    controller.destroy();
  });

  it("does not force scroll when autoScroll is disabled", () => {
    const controller = createInPagePanel(createActions());

    controller.update(
      buildPanelState({
        options: {
          autoScroll: false,
          recentCopyLineCount: 3,
        },
      }),
    );

    const shadowRoot = document.getElementById(
      IN_PAGE_PANEL_HOST_ID,
    )?.shadowRoot;
    const liveRowList = shadowRoot?.querySelector(
      ".live-row-list",
    ) as HTMLDivElement | null;
    const previewScroll = shadowRoot?.querySelector(
      ".preview-scroll",
    ) as HTMLDivElement | null;

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
    const controller = createInPagePanel(createActions());

    controller.update(buildPanelState());

    const shadowRoot = document.getElementById(
      IN_PAGE_PANEL_HOST_ID,
    )?.shadowRoot;
    const previewScroll = shadowRoot?.querySelector(
      ".preview-scroll",
    ) as HTMLDivElement | null;
    expect(previewScroll).not.toBeNull();

    Object.defineProperty(previewScroll, "scrollHeight", {
      configurable: true,
      value: 560,
    });
    previewScroll!.scrollTop = 0;

    controller.update(
      buildPanelState({
        options: {
          previewCollapsed: false,
          livePreviewText: "안녕하세요\n두 번째 줄입니다.\n세 번째 줄입니다.",
        },
      }),
    );

    expect(previewScroll?.scrollTop).toBe(560);

    controller.destroy();
  });

  it("does not auto-scroll the preview box while the preview section is collapsed", () => {
    const controller = createInPagePanel(createActions());

    controller.update(
      buildPanelState({
        options: {
          previewCollapsed: true,
        },
      }),
    );

    const shadowRoot = document.getElementById(
      IN_PAGE_PANEL_HOST_ID,
    )?.shadowRoot;
    const previewScroll = shadowRoot?.querySelector(
      ".preview-scroll",
    ) as HTMLDivElement | null;
    const previewSection = shadowRoot?.querySelector(
      ".preview-section",
    ) as HTMLDivElement | null;
    const previewToggle = shadowRoot?.querySelector(
      ".preview-toggle",
    ) as HTMLButtonElement | null;
    expect(previewScroll).not.toBeNull();
    expect(previewSection?.classList.contains("collapsed")).toBe(true);
    expect(previewToggle?.textContent).toBe("실시간 내용 펼치기");
    expect(previewToggle?.getAttribute("aria-expanded")).toBe("false");

    Object.defineProperty(previewScroll, "scrollHeight", {
      configurable: true,
      value: 560,
    });
    previewScroll!.scrollTop = 31;

    controller.update(
      buildPanelState({
        options: {
          previewCollapsed: true,
          livePreviewText: "안녕하세요\n두 번째 줄입니다.\n세 번째 줄입니다.",
        },
      }),
    );

    expect(previewScroll?.scrollTop).toBe(31);

    controller.destroy();
  });

  it("toggles the preview section without resetting its collapsed state on later updates", () => {
    const actions = createActions();
    const controller = createInPagePanel({
      ...actions,
      onTogglePreviewCollapsed: () => {
        controller.update(
          buildPanelState({
            options: {
              previewCollapsed: false,
            },
          }),
        );
      },
    });

    controller.update(buildPanelState());

    const shadowRoot = document.getElementById(
      IN_PAGE_PANEL_HOST_ID,
    )?.shadowRoot;
    const previewSection = shadowRoot?.querySelector(
      ".preview-section",
    ) as HTMLDivElement | null;
    const previewToggle = shadowRoot?.querySelector(
      ".preview-toggle",
    ) as HTMLButtonElement | null;

    previewToggle?.click();

    expect(previewSection?.classList.contains("collapsed")).toBe(false);
    expect(previewToggle?.textContent).toBe("실시간 내용 접기");

    controller.update(
      buildPanelState({
        options: {
          previewCollapsed: false,
          notice: "상태만 다시 동기화했습니다.",
        },
      }),
    );

    expect(previewSection?.classList.contains("collapsed")).toBe(false);
    expect(previewToggle?.textContent).toBe("실시간 내용 접기");

    controller.destroy();
  });

  it("does not reset the live row scroll position when only preview text changes", () => {
    const controller = createInPagePanel(createActions());

    controller.update(buildPanelState());

    const shadowRoot = document.getElementById(
      IN_PAGE_PANEL_HOST_ID,
    )?.shadowRoot;
    const liveRowList = shadowRoot?.querySelector(
      ".live-row-list",
    ) as HTMLDivElement | null;
    expect(liveRowList).not.toBeNull();

    Object.defineProperty(liveRowList, "scrollHeight", {
      configurable: true,
      value: 640,
    });
    liveRowList!.scrollTop = 123;

    controller.update(
      buildPanelState({
        options: {
          livePreviewText: "미리보기만 바뀌었습니다.",
        },
      }),
    );

    expect(liveRowList?.scrollTop).toBe(123);

    controller.destroy();
  });

  it("does not auto-scroll the live rows while the user is reading older subtitles", () => {
    const controller = createInPagePanel(createActions());

    controller.update(
      buildPanelState({
        options: {
          liveRows: createLiveRows(2),
        },
      }),
    );

    const shadowRoot = document.getElementById(
      IN_PAGE_PANEL_HOST_ID,
    )?.shadowRoot;
    const liveRowList = shadowRoot?.querySelector(
      ".live-row-list",
    ) as HTMLDivElement | null;
    const jumpButton = shadowRoot?.querySelector(
      'button[aria-label="수집된 자막 맨 아래로 이동"]',
    ) as HTMLButtonElement | null;
    expect(liveRowList).not.toBeNull();
    expect(jumpButton).not.toBeNull();

    mockScrollableMetrics(liveRowList!, {
      scrollHeight: 640,
      clientHeight: 220,
    });
    liveRowList!.scrollTop = 160;
    liveRowList!.dispatchEvent(new Event("scroll"));

    expect(jumpButton?.hidden).toBe(false);

    controller.update(
      buildPanelState({
        options: {
          liveRows: createLiveRows(3),
        },
      }),
    );

    expect(liveRowList?.scrollTop).toBe(160);
    expect(jumpButton?.hidden).toBe(false);

    controller.destroy();
  });

  it("scrolls back to the bottom when the live row jump button is clicked", () => {
    const controller = createInPagePanel(createActions());

    controller.update(
      buildPanelState({
        options: {
          liveRows: createLiveRows(3),
        },
      }),
    );

    const shadowRoot = document.getElementById(
      IN_PAGE_PANEL_HOST_ID,
    )?.shadowRoot;
    const liveRowList = shadowRoot?.querySelector(
      ".live-row-list",
    ) as HTMLDivElement | null;
    const jumpButton = shadowRoot?.querySelector(
      'button[aria-label="수집된 자막 맨 아래로 이동"]',
    ) as HTMLButtonElement | null;
    expect(liveRowList).not.toBeNull();
    expect(jumpButton).not.toBeNull();

    mockScrollableMetrics(liveRowList!, {
      scrollHeight: 640,
      clientHeight: 220,
    });
    liveRowList!.scrollTop = 120;
    liveRowList!.dispatchEvent(new Event("scroll"));

    expect(jumpButton?.hidden).toBe(false);

    jumpButton?.click();

    expect(liveRowList?.scrollTop).toBe(640);
    expect(jumpButton?.hidden).toBe(true);

    controller.destroy();
  });

  it("reuses the live row DOM node when the same row key is updated", () => {
    const controller = createInPagePanel(createActions());

    controller.update(buildPanelState());

    const shadowRoot = document.getElementById(
      IN_PAGE_PANEL_HOST_ID,
    )?.shadowRoot;
    const liveRowList = shadowRoot?.querySelector(
      ".live-row-list",
    ) as HTMLDivElement | null;
    const firstLiveRow = liveRowList?.querySelector(".live-row");

    controller.update(
      buildPanelState({
        options: {
          livePreviewText: "안녕하세요 수정",
          liveRows: [
            {
              ...createLiveRows()[0],
              text: "안녕하세요 수정",
              updatedAt: Date.parse("2026-03-10T09:00:01.000Z"),
            },
          ],
        },
      }),
    );

    const updatedLiveRow = liveRowList?.querySelector(".live-row");
    expect(updatedLiveRow).toBe(firstLiveRow);
    expect(updatedLiveRow?.textContent).toContain("안녕하세요 수정");

    controller.destroy();
  });

  it("drops rows outside the capped live-row window while keeping overlapping DOM nodes", () => {
    const controller = createInPagePanel(createActions());
    const initialRows = createLiveRows(PIPELINE_DEFAULTS.liveLedgerMaxRows);

    controller.update(
      buildPanelState({
        options: {
          liveRows: initialRows,
        },
      }),
    );

    const shadowRoot = document.getElementById(
      IN_PAGE_PANEL_HOST_ID,
    )?.shadowRoot;
    const liveRowList = shadowRoot?.querySelector(
      ".live-row-list",
    ) as HTMLDivElement | null;
    const overlappingRow = liveRowList?.querySelector(
      '[data-row-key="top::row_2"]',
    );

    const nextRows = Array.from(
      { length: PIPELINE_DEFAULTS.liveLedgerMaxRows },
      (_, index) => ({
        key: `top::row_${index + 2}`,
        text: `${index + 2}번째 자막입니다.`,
        nodeKey: `row_${index + 2}`,
        speakerColor: "rgb(35, 124, 147)",
        speakerChannel: "primary" as const,
        updatedAt: Date.parse(
          `2026-03-10T09:${String(index % 60).padStart(2, "0")}:00.000Z`,
        ),
      }),
    );

    controller.update(
      buildPanelState({
        options: {
          liveRows: nextRows,
        },
      }),
    );

    expect(
      liveRowList?.querySelector('[data-row-key="top::row_1"]'),
    ).toBeNull();
    expect(liveRowList?.querySelector('[data-row-key="top::row_2"]')).toBe(
      overlappingRow,
    );

    controller.destroy();
  });

  it("keeps clear available for preview-only state while save-related actions stay disabled", () => {
    const actions = createActions();
    const controller = createInPagePanel(actions);

    controller.update(
      buildPanelState({
        snapshot: {
          status: "idle",
          hasPersistableContent: false,
          previewText: "미리보기 자막",
          recentEntries: [],
        },
        options: {
          liveRows: [],
          livePreviewText: "미리보기 자막",
          showNotice: false,
          canClearSession: true,
        },
      }),
    );

    const shadowRoot = document.getElementById(
      IN_PAGE_PANEL_HOST_ID,
    )?.shadowRoot;
    const clearButton = [
      ...(shadowRoot?.querySelectorAll("button") ?? []),
    ].find((element) => element.textContent === "화면 비우기") as
      | HTMLButtonElement
      | undefined;
    const saveButton = [...(shadowRoot?.querySelectorAll("button") ?? [])].find(
      (element) => element.textContent === "지금 저장",
    ) as HTMLButtonElement | undefined;
    const copyButton = [...(shadowRoot?.querySelectorAll("button") ?? [])].find(
      (element) => element.textContent === "최근 5줄 복사",
    ) as HTMLButtonElement | undefined;
    const highlightButton = [
      ...(shadowRoot?.querySelectorAll("button") ?? []),
    ].find((element) => element.textContent === "최신 중요 표시") as
      | HTMLButtonElement
      | undefined;

    expect(clearButton?.disabled).toBe(false);
    expect(saveButton?.disabled).toBe(true);
    expect(copyButton?.disabled).toBe(true);
    expect(highlightButton?.disabled).toBe(true);
    highlightButton?.click();
    expect(actions.onHighlightLatestEntry).not.toHaveBeenCalled();

    controller.destroy();
  });

  it("enables quick highlight only for committed recent entries", () => {
    const actions = createActions();
    const controller = createInPagePanel(actions);

    controller.update(buildPanelState());

    const shadowRoot = document.getElementById(
      IN_PAGE_PANEL_HOST_ID,
    )?.shadowRoot;
    const highlightButton = [
      ...(shadowRoot?.querySelectorAll("button") ?? []),
    ].find((element) => element.textContent === "최신 중요 표시") as
      | HTMLButtonElement
      | undefined;

    expect(highlightButton?.disabled).toBe(false);
    highlightButton?.click();
    expect(actions.onHighlightLatestEntry).toHaveBeenCalledTimes(1);

    controller.update(
      buildPanelState({
        snapshot: {
          recentEntries: createSnapshot().recentEntries.map((entry) => ({
            ...entry,
            highlighted: true,
          })),
        },
      }),
    );

    expect(highlightButton?.disabled).toBe(true);

    controller.destroy();
  });

  it("keeps clear available for notice-only state while save-related actions stay disabled", () => {
    const controller = createInPagePanel(createActions());

    controller.update(
      buildPanelState({
        snapshot: {
          status: "idle",
          hasPersistableContent: false,
          previewText: "",
        },
        options: {
          notice: "AI 자막보기 버튼을 눌러주세요.",
          showNotice: true,
          liveRows: [],
          livePreviewText: "",
          canClearSession: true,
        },
      }),
    );

    const shadowRoot = document.getElementById(
      IN_PAGE_PANEL_HOST_ID,
    )?.shadowRoot;
    const clearButton = [
      ...(shadowRoot?.querySelectorAll("button") ?? []),
    ].find((element) => element.textContent === "화면 비우기") as
      | HTMLButtonElement
      | undefined;
    const saveButton = [...(shadowRoot?.querySelectorAll("button") ?? [])].find(
      (element) => element.textContent === "지금 저장",
    ) as HTMLButtonElement | undefined;
    const copyButton = [...(shadowRoot?.querySelectorAll("button") ?? [])].find(
      (element) => element.textContent === "최근 5줄 복사",
    ) as HTMLButtonElement | undefined;
    const notice = shadowRoot?.querySelector(
      ".notice",
    ) as HTMLDivElement | null;

    expect(clearButton?.disabled).toBe(false);
    expect(saveButton?.disabled).toBe(true);
    expect(copyButton?.disabled).toBe(true);
    expect(notice?.hidden).toBe(false);
    expect(notice?.textContent).toBe("AI 자막보기 버튼을 눌러주세요.");

    controller.destroy();
  });
});
