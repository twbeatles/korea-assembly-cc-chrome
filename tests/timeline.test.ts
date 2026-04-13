import { buildExportFilename } from "../src/core/timeline";
import type { SessionRecord } from "../src/core/subtitle-models";

function buildSession(): SessionRecord {
  return {
    id: "session_timeline",
    version: "3",
    title: "정무위",
    committeeName: "정무위원회",
    sourceUrl: "https://assembly.webcast.go.kr/main/player.asp",
    startedAt: "2026-03-10T09:00:00.000",
    endedAt: "2026-03-10T09:10:00.000",
    createdAt: "2026-03-10T09:00:00.000",
    updatedAt: "2026-03-10T09:10:00.000",
    subtitleCount: 1,
    charCount: 5,
    status: "saved",
    starred: false,
    pinnedAt: null,
    note: "",
    entries: [],
  };
}

describe("timeline export filename", () => {
  it("builds filenames from a valid pattern", () => {
    expect(buildExportFilename(buildSession(), "txt", "{committee}_{date}_{time}")).toBe(
      "정무위원회_20260310_090000.txt",
    );
  });

  it("sanitizes every invalid character from the final basename", () => {
    expect(buildExportFilename(buildSession(), "json", "{committee}/archive:bad|name?")).toBe(
      "정무위원회archivebadname.json",
    );
  });
});
