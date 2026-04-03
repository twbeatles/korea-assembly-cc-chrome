import { describe, expect, it } from "vitest";

import { probeFramePath } from "../src/content/frame-probe";

function attachFrameDocument(frame: HTMLIFrameElement, html: string): void {
  const frameDocument = document.implementation.createHTMLDocument("");
  frameDocument.body.innerHTML = html;
  Object.defineProperty(frame, "contentDocument", {
    value: frameDocument,
    configurable: true,
  });
}

describe("probeFramePath", () => {
  it("probes a cached frame path before full traversal", () => {
    document.body.innerHTML = `
      <iframe id="frame-a"></iframe>
      <iframe id="frame-b"></iframe>
    `;

    const frames = Array.from(document.querySelectorAll<HTMLIFrameElement>("iframe"));
    attachFrameDocument(
      frames[0],
      `<div id="viewSubtit"><div class="smi_word row_a"><span>alpha</span></div></div>`,
    );
    attachFrameDocument(
      frames[1],
      `<div id="viewSubtit"><div class="smi_word row_b"><span>target subtitle</span></div></div>`,
    );

    const result = probeFramePath([1], "#viewSubtit .smi_word", {
      filterUnconfirmedEnabled: true,
    });

    expect(result.found).toBe(true);
    expect(result.framePath).toEqual([1]);
    expect(result.text).toContain("target subtitle");
  });

  it("returns an empty probe result when the frame path is invalid", () => {
    document.body.innerHTML = `<iframe id="frame-a"></iframe>`;

    const result = probeFramePath([3], "#viewSubtit .smi_word", {
      filterUnconfirmedEnabled: true,
    });

    expect(result.found).toBe(false);
    expect(result.text).toBe("");
    expect(result.framePath).toEqual([3]);
  });

  it("forwards the source URL so plenary and committee container fallback keep their own text policy", () => {
    document.body.innerHTML = `<iframe id="frame-a"></iframe>`;
    const frame = document.querySelector<HTMLIFrameElement>("#frame-a");
    if (!frame) {
      throw new Error("frame-a was not created");
    }

    const longLines = Array.from(
      { length: 12 },
      (_, index) => `[${index + 1}] 긴 자막 ${"가".repeat(28)}`,
    );
    attachFrameDocument(
      frame,
      `<div id="viewSubtit"><div class="incont">${longLines.join("\n")}</div></div>`,
    );

    const plenary = probeFramePath([0], "", {
      filterUnconfirmedEnabled: false,
      sourceUrl: "https://assembly.webcast.go.kr/main/player.asp?xcode=10&xcgcd=DCM000010224330202",
    });
    const committee = probeFramePath([0], "", {
      filterUnconfirmedEnabled: false,
      sourceUrl: "https://assembly.webcast.go.kr/main/player.asp?xcode=25&xcgcd=DCM000025224330202",
    });

    expect(plenary.text).toContain(longLines[0]);
    expect(committee.text).not.toContain(longLines[0]);
    expect(committee.text).toContain(longLines.at(-1) ?? "");
  });
});
