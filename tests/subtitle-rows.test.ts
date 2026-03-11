import { describe, expect, it } from "vitest";

import {
  PRIMARY_SPEAKER_COLOR,
  buildObservedSubtitlePreview,
  readObservedSubtitleRows,
} from "../src/content/subtitle-rows";

describe("subtitle row helpers", () => {
  it("reads stable smi_word rows and classifies the reference speaker color", () => {
    document.body.innerHTML = `
      <div id="viewSubtit">
        <div class="smi_word row_1"><span style="color: #237c93">첫 번째 자막</span></div>
        <div class="smi_word row_2"><span style="color: #1e1e1e">두 번째 자막</span></div>
      </div>
    `;

    const rows = readObservedSubtitleRows(document);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      nodeKey: "row_1",
      speakerColor: PRIMARY_SPEAKER_COLOR,
      speakerChannel: "primary",
      unstableKey: false,
    });
    expect(rows[1].speakerChannel).toBe("secondary");
  });

  it("marks rows without a stable class token as unstable", () => {
    document.body.innerHTML = `
      <div id="viewSubtit">
        <div class="smi_word"><span>클래스 키가 없는 자막</span></div>
      </div>
    `;

    const rows = readObservedSubtitleRows(document);

    expect(rows).toHaveLength(1);
    expect(rows[0].unstableKey).toBe(true);
    expect(rows[0].nodeKey).toContain("unstable:");
  });

  it("builds a preview string from the latest visible rows", () => {
    document.body.innerHTML = `
      <div id="viewSubtit">
        <div class="smi_word row_1"><span>첫 줄</span></div>
        <div class="smi_word row_2"><span>둘째 줄</span></div>
        <div class="smi_word row_3"><span>셋째 줄</span></div>
        <div class="smi_word row_4"><span>넷째 줄</span></div>
      </div>
    `;

    const rows = readObservedSubtitleRows(document);

    expect(buildObservedSubtitlePreview(rows)).toBe("둘째 줄 셋째 줄 넷째 줄");
  });
});
