import type { SubtitleEntry } from "../src/core/subtitle-models";
import {
  buildCopyText,
  copyTextToClipboard,
  filterEntriesByQuery,
  selectCopyEntries,
} from "../src/shared/copy-utils";

function buildEntry(id: string, text: string, time: string): SubtitleEntry {
  return {
    id,
    text,
    timestamp: time,
    startTime: time,
    endTime: time,
  };
}

describe("copy utils", () => {
  const entries = [
    buildEntry("1", "첫 번째 문장", "2026-03-10T09:00:00.000"),
    buildEntry("2", "두 번째 문장", "2026-03-10T09:00:01.000"),
    buildEntry("3", "검색 대상 문장", "2026-03-10T09:00:02.000"),
    buildEntry("4", "네 번째 문장", "2026-03-10T09:00:03.000"),
    buildEntry("5", "다섯 번째 문장", "2026-03-10T09:00:04.000"),
    buildEntry("6", "여섯 번째 문장", "2026-03-10T09:00:05.000"),
  ];

  it("builds copy text from the most recent N lines", () => {
    const copied = buildCopyText(entries, { limit: 5 });

    expect(copied).not.toContain("첫 번째 문장");
    expect(copied).toContain("[09:00:01] 두 번째 문장");
    expect(copied).toContain("[09:00:05] 여섯 번째 문장");
  });

  it("builds copy text only from matched search results", () => {
    const copied = buildCopyText(entries, { query: "검색" });
    const filtered = filterEntriesByQuery(entries, "검색");

    expect(filtered).toHaveLength(1);
    expect(copied).toBe("[09:00:02] 검색 대상 문장");
  });

  it("builds copy text only from explicitly selected entries while preserving original order", () => {
    const copied = buildCopyText(entries, {
      selectedIds: ["5", "2", "4"],
    });

    expect(copied).toBe(
      ["[09:00:01] 두 번째 문장", "[09:00:03] 네 번째 문장", "[09:00:04] 다섯 번째 문장"].join(
        "\n",
      ),
    );
  });

  it("trims cumulative carry-over text before copying", () => {
    const overlappingEntries = [
      buildEntry(
        "a",
        "결손보전 재원을 회계 세입세출 결산에 따른 잉여금으로 수정하였습니다",
        "2026-03-10T09:00:00.000",
      ),
      buildEntry(
        "b",
        "결손보전 재원을 회계 세입세출 결산에 따른 잉여금으로 수정하였습니다 이상으로 정보통신방송법안심사소위원회의 심사 결과를 보고드렸습니다",
        "2026-03-10T09:00:01.000",
      ),
      buildEntry(
        "c",
        "결손보전 재원을 회계 세입세출 결산에 따른 잉여금으로 수정하였습니다 이상으로 정보통신방송법안심사소위원회의 심사 결과를 보고드렸습니다 보다 자세한 내용은 단말기의 의결안을 참고해 주시기 바랍니다",
        "2026-03-10T09:00:02.000",
      ),
    ];

    expect(buildCopyText(overlappingEntries)).toBe(
      [
        "[09:00:00] 결손보전 재원을 회계 세입세출 결산에 따른 잉여금으로 수정하였습니다",
        "[09:00:01] 이상으로 정보통신방송법안심사소위원회의 심사 결과를 보고드렸습니다",
        "[09:00:02] 보다 자세한 내용은 단말기의 의결안을 참고해 주시기 바랍니다",
      ].join("\n"),
    );
  });

  it("returns an empty string when no entry matches", () => {
    expect(buildCopyText(entries, { query: "없는 문장" })).toBe("");
  });

  it("prefixes speaker labels when includeSpeaker is enabled", () => {
    const withSpeaker: SubtitleEntry[] = [
      {
        ...buildEntry("s1", "본회의 개의", "2026-03-10T09:00:00.000"),
        speakerChannel: "primary",
      },
      {
        ...buildEntry("s2", "의사일정 말씀드리겠습니다", "2026-03-10T09:00:01.000"),
        speakerChannel: "secondary",
        speakerLabel: "위원장",
      },
    ];

    expect(
      buildCopyText(withSpeaker, {
        includeSpeaker: true,
      }),
    ).toBe(
      [
        "[09:00:00] [발언자 A] 본회의 개의",
        "[09:00:01] [위원장] 의사일정 말씀드리겠습니다",
      ].join("\n"),
    );

    expect(buildCopyText(withSpeaker)).toBe(
      ["[09:00:00] 본회의 개의", "[09:00:01] 의사일정 말씀드리겠습니다"].join("\n"),
    );
  });

  it("selects only the most recent matched entries before formatting", () => {
    expect(
      selectCopyEntries(entries, {
        selectedIds: ["2", "4", "6"],
        limit: 2,
      }).map((entry) => entry.id),
    ).toEqual(["4", "6"]);
  });

  it("copies text through navigator.clipboard when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    await copyTextToClipboard("복사 대상");

    expect(writeText).toHaveBeenCalledWith("복사 대상");
  });
});
