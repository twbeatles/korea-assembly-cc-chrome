import { describe, expect, it } from "vitest";

import { exportCsv } from "../src/core/exporters/csv";
import type { SessionRecord } from "../src/core/subtitle-models";

function buildSession(overrides?: Partial<SessionRecord>): SessionRecord {
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
    ...overrides,
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

  it("prefixes UTF-8 BOM so Excel on Windows does not misread Hangul as CP949", () => {
    const csv = exportCsv(
      buildSession({
        entries: [
          {
            id: "entry_ko",
            text: "안녕하십니까 가능한 부분의 협조가 필요합니다",
            timestamp: "2026-07-28T06:32:09.682Z",
            startTime: "2026-07-28T06:32:09.682Z",
            endTime: "2026-07-28T06:32:09.682Z",
            speakerLabel: "위원장",
          },
        ],
      }),
    );

    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("위원장");
    expect(csv).toContain("안녕하십니까 가능한 부분의 협조가 필요합니다");

    const encoded = new TextEncoder().encode(csv);
    expect(Array.from(encoded.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    // TextDecoder strips a leading UTF-8 BOM by default; body must still round-trip.
    const decodedBody = new TextDecoder("utf-8").decode(encoded);
    expect(decodedBody.startsWith("\uFEFF")).toBe(false);
    expect(decodedBody).toBe(csv.slice(1));
    expect(decodedBody).toContain("안녕하십니까 가능한 부분의 협조가 필요합니다");
  });

  it("uses CRLF line endings for spreadsheet compatibility", () => {
    const csv = exportCsv(buildSession());
    const withoutBom = csv.startsWith("\uFEFF") ? csv.slice(1) : csv;
    expect(withoutBom.includes("\r\n")).toBe(true);
    expect(withoutBom.includes("\n") && !withoutBom.replaceAll("\r\n", "").includes("\n")).toBe(
      true,
    );
  });
});
