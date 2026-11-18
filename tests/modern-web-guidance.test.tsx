import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { sortSessionSegments } from "../src/core/session-lineage";
import { SettingInputCard } from "../src/options/app/SettingInputCard";
import { HistoryHero } from "../src/history/app/sections/HistoryHero";
import { SessionListPanel } from "../src/history/app/sections/SessionListPanel";
import type { SessionLineageSummary } from "../src/storage/types";

describe("modern web guidance improvements", () => {
  it("links settings inputs to their error text", () => {
    render(
      <SettingInputCard
        title="라벨"
        description="설명"
        error="값을 입력하세요."
        htmlFor="setting-demo"
      >
        <input
          type="number"
          id="setting-demo"
          aria-describedby="setting-demo-error"
        />
      </SettingInputCard>,
    );

    const error = screen.getByText("값을 입력하세요.");
    expect(error.getAttribute("id")).toBe("setting-demo-error");
    expect(
      screen.getByRole("spinbutton").getAttribute("aria-describedby"),
    ).toBe("setting-demo-error");
  });

  it("gives the history search row a landmark and accessible names", () => {
    const { container } = render(
      <HistoryHero
        heroMessage="최신 기록부터 보여주고 있습니다."
        longTask={null}
        longTaskProgressLabel={null}
        showStarredOnly={false}
        showHighlightedOnly={false}
        actionButtonsDisabled={false}
        jsonTaskButtonsDisabled={false}
        hasUnsavedSessionDraft={false}
        globalSearchQuery=""
        tagFilter=""
        categoryFilter=""
        importInputRef={createRef<HTMLInputElement>()}
        onRefresh={vi.fn()}
        onToggleStarredOnly={vi.fn()}
        onBackupAll={vi.fn()}
        onImportClick={vi.fn()}
        onCancelLongTask={vi.fn()}
        onGlobalSearchChange={vi.fn()}
        onTagFilterChange={vi.fn()}
        onCategoryFilterChange={vi.fn()}
        onToggleHighlightedOnly={vi.fn()}
        onImportChange={vi.fn()}
      />,
    );

    expect(container.querySelector("search.search-row")).toBeTruthy();
    expect(screen.getByLabelText("태그 필터")).toBeTruthy();
    expect(screen.getByLabelText("카테고리 필터")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain(
      "최신 기록부터 보여주고 있습니다.",
    );
  });

  it("renders the session list with list semantics and toggle states", () => {
    const lineage = {
      lineageId: "lineage-1",
      representativeSessionId: "session-1",
      title: "제목",
      committeeName: "위원회",
      sourceUrl: "https://example.com",
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
      segmentCount: 1,
      subtitleCount: 10,
      charCount: 100,
      status: "ready",
      starred: true,
      pinnedAt: null,
      note: "",
      sessionIds: ["session-1"],
      representativeSession: null,
    } as unknown as SessionLineageSummary;

    const { container } = render(
      <SessionListPanel
        pageLineages={[lineage]}
        totalSessionCount={1}
        checkedIds={[]}
        checkedIdSet={new Set()}
        selectedLineageId="lineage-1"
        sessionPage={1}
        pageCount={1}
        currentPageSessionsChecked={false}
        showStarredOnly={false}
        actionButtonsDisabled={false}
        onToggleCheckAll={vi.fn()}
        onToggleChecked={vi.fn()}
        onSelectSession={vi.fn()}
        onToggleFavorite={vi.fn()}
        onDeleteChecked={vi.fn()}
        onDeleteAll={vi.fn()}
        onPageChange={vi.fn()}
        runBusy={(_label, action) => {
          void action();
        }}
      />,
    );

    expect(
      screen.getByRole("complementary", { name: "세션 목록" }),
    ).toBeTruthy();
    expect(screen.getByRole("list")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "위원회 선택" })).toBeTruthy();
    expect(
      container.querySelector('button.session-item[aria-current="true"]'),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "위원회 즐겨찾기 해제" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("sortSessionSegments does not mutate its input", () => {
    const input = [
      {
        id: "b",
        startedAt: "2026-01-02T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
      {
        id: "a",
        startedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const snapshot = input.map((session) => ({ ...session }));

    const sorted = sortSessionSegments(input);

    expect(sorted.map((session) => session.id)).toEqual(["a", "b"]);
    expect(input).toEqual(snapshot);
  });
});
