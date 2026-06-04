import { describe, expect, it } from "vitest";

import { exportCsv } from "../src/core/exporters/csv";
import type { SessionRecord } from "../src/core/subtitle-models";

function buildSession(): SessionRecord {
  return {
    id: "session_csv",
    version: "3",
    title: "정무위",
    committeeName: "정무위원회",
    sourceUrl: "https://assembly.webcast.go.kr/main/player.asp",
    startedAt: "2026-03-10T09:00:00.000Z",
    endedAt: "2026-03-10T09:05:00.000Z",
    createdAt: "2026-03-10T09:00:00.000Z",
    updatedAt: "2026-03-10T09:05:00.000Z",
    subtitleCount: 1,
    charCount: 12,
    status: "saved",
    starred: false,
    pinnedAt: null,
    note: "",
    entries: [
      {
        id: "entry_formula",
        text: "=HYPERLINK(\"https://example.com\")",
        timestamp: "2026-03-10T09:00:01.000Z",
        startTime: "2026-03-10T09:00:01.000Z",
        endTime: "2026-03-10T09:00:03.000Z",
        speakerLabel: "+speaker",
        entryNote: "\t@note",
        labels: ["-label"],
      },
    ],
  };
}

describe("CSV exporter", () => {
  it("neutralizes spreadsheet formula prefixes in user-controlled cells", () => {
    const csv = exportCsv(buildSession());

    expect(csv).toContain("'+speaker");
    expect(csv).toContain(`"'=HYPERLINK(""https://example.com"")"`);
    expect(csv).toContain("'\t@note");
    expect(csv).toContain("'-label");
  });
});
