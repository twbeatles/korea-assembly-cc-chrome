import { describe, expect, it } from "vitest";

import type { LivePanelRow } from "../src/core/live-capture";
import type { SessionRecord, SubtitleEntry } from "../src/core/subtitle-models";
import { exportSrt } from "../src/core/exporters/srt";
import {
  buildCommittedEntryLiveRows,
  buildOutputEntriesFromPanelRows,
  resolvePanelLiveRows,
} from "../src/content/panel-live-rows";
import { buildCopyText } from "../src/shared/copy-utils";

function createEntry(id: string, text: string): SubtitleEntry {
  return {
    id,
    text,
    timestamp: "2026-03-20T08:00:00.000Z",
    startTime: "2026-03-20T08:00:00.000Z",
    endTime: "2026-03-20T08:00:05.000Z",
    sourceSelector: "#viewSubtit .smi_word",
    sourceFramePath: [0, 2],
    sourceNodeKey: `node_${id}`,
    speakerColor: "rgb(35, 124, 147)",
    speakerChannel: "primary",
  };
}

function createStructuredRow(): LivePanelRow {
  const timestamp = "2026-03-20T08:00:00.000Z";
  const endTime = "2026-03-20T08:00:05.000Z";
  return {
    key: "top::row_1",
    text: "구조화된 자막",
    nodeKey: "row_1",
    entryId: "entry_structured",
    timestamp,
    startTime: timestamp,
    endTime,
    sourceSelector: "#viewSubtit .smi_word",
    sourceFramePath: [0],
    sourceNodeKey: "top::row_1",
    speakerColor: "rgb(35, 124, 147)",
    speakerChannel: "primary",
    updatedAt: Date.parse(endTime),
  };
}

function createSession(entries: SubtitleEntry[]): SessionRecord {
  return {
    id: "session_panel_rows",
    version: "3",
    title: "정무위",
    committeeName: "정무위원회",
    sourceUrl: "https://assembly.webcast.go.kr/main/player.asp",
    startedAt: "2026-03-20T08:00:00.000Z",
    endedAt: entries.at(-1)?.endTime ?? "2026-03-20T08:00:05.000Z",
    createdAt: "2026-03-20T08:00:00.000Z",
    updatedAt: entries.at(-1)?.endTime ?? "2026-03-20T08:00:05.000Z",
    subtitleCount: entries.length,
    charCount: entries.reduce((sum, entry) => sum + entry.text.length, 0),
    status: "saved",
    starred: false,
    pinnedAt: null,
    note: "",
    entries,
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
    expect(rows[0].startTime).toBe("2026-03-20T08:00:00.000Z");
    expect(rows[0].endTime).toBe("2026-03-20T08:00:05.000Z");
    expect(rows[0].sourceSelector).toBe("#viewSubtit .smi_word");
    expect(rows[0].sourceFramePath).toEqual([0, 2]);
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

  it("builds committed panel rows with canonical output metadata", () => {
    const [row] = buildCommittedEntryLiveRows([createEntry("entry_1", "본회의 누적 자막")]);

    expect(row).toEqual({
      key: "entry::entry_1",
      text: "본회의 누적 자막",
      nodeKey: "node_entry_1",
      entryId: "entry_1",
      timestamp: "2026-03-20T08:00:00.000Z",
      startTime: "2026-03-20T08:00:00.000Z",
      endTime: "2026-03-20T08:00:05.000Z",
      sourceSelector: "#viewSubtit .smi_word",
      sourceFramePath: [0, 2],
      sourceNodeKey: "node_entry_1",
      speakerColor: "rgb(35, 124, 147)",
      speakerChannel: "primary",
      updatedAt: Date.parse("2026-03-20T08:00:05.000Z"),
    });
  });

  it("preserves canonical metadata when converting panel rows back to output entries", () => {
    const [entry] = buildOutputEntriesFromPanelRows([createStructuredRow()]);

    expect(entry).toEqual({
      id: "entry_structured",
      text: "구조화된 자막",
      timestamp: "2026-03-20T08:00:00.000Z",
      startTime: "2026-03-20T08:00:00.000Z",
      endTime: "2026-03-20T08:00:05.000Z",
      sourceSelector: "#viewSubtit .smi_word",
      sourceFramePath: [0],
      sourceNodeKey: "top::row_1",
      speakerColor: "rgb(35, 124, 147)",
      speakerChannel: "primary",
    });
  });

  it("keeps copy and export timings from panel rows instead of flattening to updatedAt", () => {
    const entries = buildOutputEntriesFromPanelRows([
      {
        ...createStructuredRow(),
        entryId: null,
        timestamp: "2026-03-20T08:00:00.000",
        startTime: "2026-03-20T08:00:00.000",
        endTime: "2026-03-20T08:00:05.000",
      },
    ]);
    const session = {
      ...createSession(entries),
      startedAt: "2026-03-20T08:00:00.000",
      createdAt: "2026-03-20T08:00:00.000",
      updatedAt: "2026-03-20T08:00:05.000",
      endedAt: "2026-03-20T08:00:05.000",
    };

    expect(buildCopyText(entries)).toBe("[08:00:00] 구조화된 자막");
    expect(exportSrt(session)).toBe("1\n00:00:00,000 --> 00:00:05,000\n구조화된 자막");
  });
});
