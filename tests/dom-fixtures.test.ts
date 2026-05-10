import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { readObservedSubtitleRows } from "../src/content/subtitle-rows";

describe("DOM subtitle fixtures", () => {
  it("reads stable committee subtitle rows from fixture markup", () => {
    document.body.innerHTML = readFileSync(
      resolve("tests/fixtures/committee-subtitles.html"),
      "utf8",
    );

    const rows = readObservedSubtitleRows(document, "#viewSubtit .smi_word", {
      filterUnconfirmedEnabled: true,
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      nodeKey: "class:row_a",
      text: "첫 번째 확정 자막입니다.",
      speakerChannel: "primary",
      unstableKey: false,
    });
    expect(rows[1]).toMatchObject({
      nodeKey: "class:row_b",
      text: "두 번째 확정 자막입니다.",
      speakerChannel: "secondary",
      unstableKey: false,
    });
  });
});

