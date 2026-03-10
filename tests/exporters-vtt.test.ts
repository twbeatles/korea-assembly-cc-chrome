import { exportVtt } from "../src/core/exporters/vtt";
import type { SessionRecord } from "../src/core/subtitle-models";

const session: SessionRecord = {
  id: "session_1",
  version: "1",
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
  entries: [
    {
      id: "subtitle_1",
      text: "안녕하세요",
      timestamp: "2026-03-10T09:00:01.200Z",
      startTime: "2026-03-10T09:00:01.200Z",
      endTime: "2026-03-10T09:00:04.000Z",
    },
  ],
};

describe("VTT exporter", () => {
  it("renders relative WEBVTT output", () => {
    const output = exportVtt(session);

    expect(output).toBe(
      "WEBVTT\n\n00:00:01.200 --> 00:00:04.000\n안녕하세요",
    );
  });
});
