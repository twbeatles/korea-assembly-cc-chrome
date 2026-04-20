import type { SubtitleEntry } from "../src/core/subtitle-models";
import { resolvePanelLiveRows } from "../src/content/panel-live-rows";
import { PIPELINE_DEFAULTS } from "../src/shared/constants";

function createEntry(
  id: string,
  text: string,
  overrides: Partial<SubtitleEntry> = {},
): SubtitleEntry {
  return {
    id,
    text,
    timestamp: "2026-03-20T08:00:00.000Z",
    startTime: "2026-03-20T08:00:00.000Z",
    endTime: "2026-03-20T08:00:05.000Z",
    sourceNodeKey: `node_${id}`,
    speakerColor: "rgb(35, 124, 147)",
    speakerChannel: "primary",
    ...overrides,
  };
}

describe("panel live rows", () => {
  it("renders the full committed subtitle list regardless of current capture mode", () => {
    const rows = resolvePanelLiveRows({
      structuredRows: [
        {
          key: "top::row_1",
          text: "구조화된 자막",
          nodeKey: "row_1",
          speakerColor: "rgb(35, 124, 147)",
          speakerChannel: "primary",
          updatedAt: Date.parse("2026-03-20T08:00:05.000Z"),
        },
      ],
      entries: [
        createEntry("entry_1", "본회의 누적 자막"),
        createEntry("entry_2", "이어지는 발언", {
          endTime: "2026-03-20T08:00:09.000Z",
        }),
      ],
      captureMode: "fallback",
      sourceUrl:
        "https://assembly.webcast.go.kr/main/player.asp?xcode=10&xcgcd=DCM000010224330202",
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      key: "entry::entry_1",
      text: "본회의 누적 자막",
      nodeKey: "node_entry_1",
      speakerChannel: "primary",
      updatedAt: Date.parse("2026-03-20T08:00:05.000Z"),
    });
    expect(rows[1]).toMatchObject({
      key: "entry::entry_2",
      text: "이어지는 발언",
      updatedAt: Date.parse("2026-03-20T08:00:09.000Z"),
    });
  });

  it("caps panel rows to the latest configured committed-entry window", () => {
    const entries = Array.from({ length: PIPELINE_DEFAULTS.liveLedgerMaxRows + 5 }, (_, index) =>
      createEntry(`entry_${index + 1}`, `${index + 1}번째 자막`, {
        endTime: `2026-03-20T08:${String(index % 60).padStart(2, "0")}:09.000Z`,
      }),
    );

    const rows = resolvePanelLiveRows({
      structuredRows: [],
      entries,
      captureMode: "structured",
      sourceUrl: "https://assembly.webcast.go.kr/main/player.asp",
    });

    expect(rows).toHaveLength(PIPELINE_DEFAULTS.liveLedgerMaxRows);
    expect(rows[0]?.key).toBe("entry::entry_6");
    expect(rows.at(-1)?.key).toBe(`entry::entry_${PIPELINE_DEFAULTS.liveLedgerMaxRows + 5}`);
  });
});
