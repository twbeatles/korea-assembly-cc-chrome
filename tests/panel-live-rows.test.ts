import type { SubtitleEntry } from "../src/core/subtitle-models";
import {
  buildPersistableOutputEntries,
  resolvePanelLiveRows,
} from "../src/content/panel-live-rows";

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

  it("prefers committed entries over preview-only fallback rows for persistence", () => {
    const committedEntries = [
      createEntry("entry_1", "첫 번째 확정 자막", {
        startTime: "2026-03-20T08:00:01.000Z",
        endTime: "2026-03-20T08:00:02.000Z",
      }),
    ];
    const previewFallbackEntries = [
      createEntry("preview_1", "미리보기 전용 자막", {
        startTime: "2026-03-20T08:00:10.000Z",
        endTime: "2026-03-20T08:00:11.000Z",
      }),
    ];

    const entries = buildPersistableOutputEntries({
      committedEntries,
      previewFallbackEntries,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual(committedEntries[0]);
    expect(entries[0]).not.toBe(committedEntries[0]);
  });

  it("falls back to sanitized preview entries only when no committed subtitles exist", () => {
    const previewFallbackEntries = [
      createEntry("preview_1", "미리보기 전용 자막", {
        startTime: "2026-03-20T08:00:10.000Z",
        endTime: "2026-03-20T08:00:11.000Z",
      }),
    ];

    const entries = buildPersistableOutputEntries({
      committedEntries: [],
      previewFallbackEntries,
    });

    expect(entries).toEqual(previewFallbackEntries);
    expect(entries[0]).not.toBe(previewFallbackEntries[0]);
  });

  it("preserves original cue timing when exporting committed subtitles", () => {
    const committedEntries = [
      createEntry("entry_1", "두 번째 자막", {
        timestamp: "2026-03-20T08:00:05.000Z",
        startTime: "2026-03-20T08:00:05.000Z",
        endTime: "2026-03-20T08:00:06.000Z",
      }),
    ];

    const entries = buildPersistableOutputEntries({
      committedEntries,
      previewFallbackEntries: [],
    });

    expect(entries[0]).toMatchObject({
      timestamp: "2026-03-20T08:00:05.000Z",
      startTime: "2026-03-20T08:00:05.000Z",
      endTime: "2026-03-20T08:00:06.000Z",
    });
  });
});
