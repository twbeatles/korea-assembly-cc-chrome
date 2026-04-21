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
    expect(result.blockedByUnconfirmedFilter).toBe(true);
  });

  it("allows container fallback after the caller explicitly relaxes unconfirmed blocking", () => {
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
      allowUnconfirmedContainerFallback: true,
    });

    expect(result.found).toBe(true);
    expect(result.matchedSelector).toBe("#viewSubtit .incont");
    expect(result.sourceMode).toBe("container");
    expect(result.blockedByUnconfirmedFilter).toBe(false);
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
    expect(result.blockedByUnconfirmedFilter).toBe(false);
  });

  it("blocks container fallback when highlighted in-progress text remains in the container", () => {
    document.body.innerHTML = `
      <div id="viewSubtit">
        <div class="incont">
          <span style="background-color: rgb(173, 216, 230)">인식 중 자막</span>
        </div>
      </div>
    `;

    const result = readSubtitleTextBySelectors(document, ["#viewSubtit .incont"], {
      filterUnconfirmedEnabled: true,
    });

    expect(result.found).toBe(false);
    expect(result.text).toBe("");
    expect(result.blockedByUnconfirmedFilter).toBe(true);
  });

  it("keeps the full accumulated realtime content on plenary pages", () => {
    const longLines = Array.from(
      { length: 12 },
      (_, index) => `[P${String(index + 1).padStart(2, "0")}] 본회의 누적 문장 ${"가".repeat(32)}`,
    );
    document.body.innerHTML = `
      <div id="viewSubtit">
        <div class="incont">${longLines.join("\n")}</div>
      </div>
    `;

    const result = readSubtitleTextBySelectors(document, ["#viewSubtit .incont"], {
      filterUnconfirmedEnabled: false,
      sourceUrl:
        "https://assembly.webcast.go.kr/main/player.asp?xcode=10&xcgcd=DCM000010224330202",
    });

    expect(result.found).toBe(true);
    expect(result.text).toContain(longLines[0]);
    expect(result.text).toContain(longLines.at(-1) ?? "");
  });

  it("keeps long container fallback text for internal reconciliation on committee pages", () => {
    const longLines = Array.from(
      { length: 12 },
      (_, index) => `[C${String(index + 1).padStart(2, "0")}] 위원회 문장 ${"나".repeat(32)}`,
    );
    document.body.innerHTML = `
      <div id="viewSubtit">
        <div class="incont">${longLines.join("\n")}</div>
      </div>
    `;

    const result = readSubtitleTextBySelectors(document, ["#viewSubtit .incont"], {
      filterUnconfirmedEnabled: false,
      sourceUrl:
        "https://assembly.webcast.go.kr/main/player.asp?xcode=25&xcgcd=DCM000025224330202",
    });

    expect(result.found).toBe(true);
    expect(result.text).toContain(longLines[0]);
    expect(result.text).toContain(longLines[11]);
  });
});
