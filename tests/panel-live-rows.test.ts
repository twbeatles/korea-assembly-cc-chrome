import { describe, expect, it } from "vitest";

import type { LivePanelRow } from "../src/core/live-capture";
import type { SubtitleEntry } from "../src/core/subtitle-models";
import {
  buildOutputEntriesFromPanelRows,
  resolvePanelLiveRows,
} from "../src/content/panel-live-rows";

function createEntry(id: string, text: string): SubtitleEntry {
  return {
    id,
    text,
    timestamp: "2026-03-20T08:00:00.000Z",
    startTime: "2026-03-20T08:00:00.000Z",
    endTime: "2026-03-20T08:00:05.000Z",
    sourceNodeKey: `node_${id}`,
    speakerColor: "rgb(35, 124, 147)",
    speakerChannel: "primary",
  };
}

function createStructuredRow(): LivePanelRow {
  return {
    key: "top::row_1",
    text: "구조화된 자막",
    nodeKey: "row_1",
    speakerColor: "rgb(35, 124, 147)",
    speakerChannel: "primary",
    updatedAt: Date.parse("2026-03-20T08:00:05.000Z"),
  };
}

describe("panel live rows", () => {
  it("uses committed entries for plenary fallback capture", () => {
    const rows = resolvePanelLiveRows({
      structuredRows: [],
      entries: [createEntry("entry_1", "본회의 누적 자막"), createEntry("entry_2", "이어지는 발언")],
      captureMode: "fallback",
      sourceUrl:
        "https://assembly.webcast.go.kr/main/player.asp?xcode=10&xcgcd=DCM000010224330202",
    });

    expect(rows).toHaveLength(2);
    expect(rows[0].key).toBe("entry::entry_1");
    expect(rows[0].text).toBe("본회의 누적 자막");
    expect(rows[1].text).toBe("이어지는 발언");
  });

  it("keeps structured rows on committee fallback pages", () => {
    const structuredRows = [createStructuredRow()];
    const rows = resolvePanelLiveRows({
      structuredRows,
      entries: [createEntry("entry_1", "위원회 누적 자막")],
      captureMode: "fallback",
      sourceUrl:
        "https://assembly.webcast.go.kr/main/player.asp?xcode=25&xcgcd=DCM000025224330202",
    });

    expect(rows).toEqual(structuredRows);
  });

  it("keeps structured rows when structured capture is active", () => {
    const structuredRows = [createStructuredRow()];
    const rows = resolvePanelLiveRows({
      structuredRows,
      entries: [createEntry("entry_1", "본회의 누적 자막")],
      captureMode: "structured",
      sourceUrl:
        "https://assembly.webcast.go.kr/main/player.asp?xcode=10&xcgcd=DCM000010224330202",
    });

    expect(rows).toEqual(structuredRows);
  });

  it("builds output entries directly from visible panel rows", () => {
    const entries = buildOutputEntriesFromPanelRows(
      [
        {
          key: "top::row_1",
          text: "첫 번째 화면 자막",
          nodeKey: "row_1",
          speakerColor: "rgb(35, 124, 147)",
          speakerChannel: "primary",
          updatedAt: Date.parse("2026-03-20T08:00:05.000Z"),
        },
        {
          key: "top::row_2",
          text: "두 번째 화면 자막",
          nodeKey: "row_2",
          speakerColor: "rgb(30, 30, 30)",
          speakerChannel: "secondary",
          updatedAt: Date.parse("2026-03-20T08:00:06.000Z"),
        },
      ],
      "session_visible",
    );

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      id: "session_visible::visible::top::row_1::0",
      text: "첫 번째 화면 자막",
      sourceNodeKey: "row_1",
      speakerChannel: "primary",
    });
    expect(entries[1]).toMatchObject({
      id: "session_visible::visible::top::row_2::1",
      text: "두 번째 화면 자막",
      sourceNodeKey: "row_2",
      speakerChannel: "secondary",
    });
  });
});
