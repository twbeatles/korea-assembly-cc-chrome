import { buildJsonExport, exportJson } from "../src/core/exporters/json";
import type { SessionRecord } from "../src/core/subtitle-models";

const session: SessionRecord = {
  id: "session_json",
  version: "3",
  title: "법사위",
  committeeName: "법제사법위원회",
  sourceUrl: "https://assembly.webcast.go.kr/main/player.asp",
  startedAt: "2026-03-10T09:00:00.000Z",
  endedAt: "2026-03-10T09:00:04.000Z",
  createdAt: "2026-03-10T09:00:00.000Z",
  updatedAt: "2026-03-10T09:00:04.000Z",
  subtitleCount: 1,
  charCount: 5,
  status: "saved",
  starred: true,
  pinnedAt: "2026-03-10T09:00:04.000Z",
  note: "중요 세션",
  tags: ["예산", "속기"],
  category: "회의록",
  speakerLabels: { primary: "위원장" },
  qualityStats: {
    health: "good",
    entryCount: 1,
    charCount: 5,
    estimatedBytes: 512,
    fallbackOnly: false,
    lastComputedAt: "2026-03-10T09:00:04.000Z",
  },
  lineageId: "lineage_json",
  segmentNumber: 2,
  entries: [
    {
      id: "subtitle_json_1",
      text: "안녕하세요",
      timestamp: "2026-03-10T09:00:01.200Z",
      startTime: "2026-03-10T09:00:01.200Z",
      endTime: "2026-03-10T09:00:04.000Z",
      sourceNodeKey: "row_1",
      speakerColor: "rgb(35, 124, 147)",
      speakerChannel: "primary",
      speakerChanged: true,
      sourceFramePath: [0, 1],
    },
  ],
};

describe("JSON exporter", () => {
  it("includes the fields required to restore the whole session", () => {
    const json = exportJson(session);
    const parsed = JSON.parse(json) as ReturnType<typeof buildJsonExport>;

    expect(parsed.id).toBe(session.id);
    expect(parsed.version).toBe(session.version);
    expect(parsed.sourceUrl).toBe(session.sourceUrl);
    expect(parsed.startedAt).toBe(session.startedAt);
    expect(parsed.endedAt).toBe(session.endedAt);
    expect(parsed.starred).toBe(true);
    expect(parsed.pinnedAt).toBe("2026-03-10T09:00:04.000Z");
    expect(parsed.note).toBe("중요 세션");
    expect(parsed.tags).toEqual(["예산", "속기"]);
    expect(parsed.category).toBe("회의록");
    expect(parsed.speakerLabels?.primary).toBe("위원장");
    expect(parsed.qualityStats?.health).toBe("good");
    expect(parsed.lineageId).toBe("lineage_json");
    expect(parsed.segmentNumber).toBe(2);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0].sourceNodeKey).toBe("row_1");
    expect(parsed.entries[0].speakerColor).toBe("rgb(35, 124, 147)");
    expect(parsed.entries[0].sourceFramePath).toEqual([0, 1]);
  });
});
