import { describe, expect, it } from "vitest";

import { exportMarkdown } from "../src/core/exporters/markdown";
import type { SessionRecord } from "../src/core/subtitle-models";

function buildSession(): SessionRecord {
  return {
    id: "session_markdown",
    version: "3",
    title: "정무위 | <script>",
    committeeName: "정무위원회\r\n본회의",
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
    note: "<b>메모</b>",
    tags: ["#태그|분리"],
    category: "카테고리\n다음",
    entries: [
      {
        id: "entry_markdown",
        text: "첫 줄\n둘째 | <b>",
        timestamp: "2026-03-10T09:00:01.000Z",
        startTime: "2026-03-10T09:00:01.000Z",
        endTime: "2026-03-10T09:00:03.000Z",
        speakerLabel: "발언자 | <A>",
        entryNote: "비고\n다음 | <x>",
      },
    ],
  };
}

describe("Markdown exporter", () => {
  it("escapes table and metadata-breaking characters", () => {
    const markdown = exportMarkdown(buildSession());

    expect(markdown).toContain("# 정무위 \\| &lt;script&gt;");
    expect(markdown).toContain("- 위원회: 정무위원회 본회의");
    expect(markdown).toContain("- 카테고리: 카테고리 다음");
    expect(markdown).toContain("##태그\\|분리");
    expect(markdown).toContain("&lt;b&gt;메모&lt;/b&gt;");
    expect(markdown).toContain("발언자 \\| &lt;A&gt;");
    expect(markdown).toContain("첫 줄 둘째 \\| &lt;b&gt;");
    expect(markdown).toContain("비고 다음 \\| &lt;x&gt;");
  });
});
