import { describe, expect, it } from "vitest";

import { readSubtitleTextBySelectors } from "../src/content/dom-probe";

describe("dom probe unconfirmed filtering", () => {
  it("blocks container fallback when unconfirmed rows exist and filtering is enabled", () => {
    document.body.innerHTML = `
      <div id="viewSubtit">
        <div class="smi_word pending_row" style="background-color: rgb(255, 255, 0)">
          <span>draft subtitle</span>
        </div>
        <div class="incont">container fallback subtitle</div>
      </div>
    `;

    const result = readSubtitleTextBySelectors(document, ["#viewSubtit .incont"], {
      filterUnconfirmedEnabled: true,
    });

    expect(result.found).toBe(false);
    expect(result.text).toBe("");
  });

  it("keeps container fallback available when filtering is disabled", () => {
    document.body.innerHTML = `
      <div id="viewSubtit">
        <div class="smi_word pending_row" style="background-color: rgb(255, 255, 0)">
          <span>draft subtitle</span>
        </div>
        <div class="incont">container fallback subtitle</div>
      </div>
    `;

    const result = readSubtitleTextBySelectors(document, ["#viewSubtit .incont"], {
      filterUnconfirmedEnabled: false,
    });

    expect(result.found).toBe(true);
    expect(result.matchedSelector).toBe("#viewSubtit .incont");
    expect(result.sourceMode).toBe("container");
    expect(result.text).toContain("container fallback subtitle");
  });
});
