import { describe, expect, it } from "vitest";

import {
  formatSpeakerBadge,
  formatSpeakerPrefix,
  resolveSpeakerAccentColor,
  resolveSpeakerLabelForOutput,
  sanitizeSpeakerColorForCss,
} from "../src/core/exporters/speaker-label";

describe("speaker-label helpers", () => {
  it("resolves entry label, session map, then channel defaults", () => {
    expect(
      resolveSpeakerLabelForOutput(
        { speakerChannel: "primary", speakerLabel: " 의장 " },
        { speakerLabels: { primary: "본회의 의장" } },
      ),
    ).toBe("의장");

    expect(
      resolveSpeakerLabelForOutput(
        { speakerChannel: "secondary" },
        { speakerLabels: { secondary: "여당 원내대표" } },
      ),
    ).toBe("여당 원내대표");

    expect(resolveSpeakerLabelForOutput({ speakerChannel: "primary" })).toBe(
      "발언자 A",
    );
    expect(
      resolveSpeakerLabelForOutput(
        { speakerChannel: "unknown" },
        null,
        { unknownLabel: "알 수 없음" },
      ),
    ).toBe("알 수 없음");
    expect(resolveSpeakerLabelForOutput({ speakerChannel: "unknown" })).toBe("");
  });

  it("formats badge and accent colors", () => {
    expect(formatSpeakerBadge("primary")).toBe("A");
    expect(formatSpeakerBadge("secondary")).toBe("B");
    expect(formatSpeakerBadge("unknown")).toBe("?");
    expect(resolveSpeakerAccentColor("rgb(1, 2, 3)", "primary")).toBe(
      "rgb(1, 2, 3)",
    );
    expect(resolveSpeakerAccentColor("", "secondary")).toBe("rgb(30, 30, 30)");
    expect(formatSpeakerPrefix("발언자 A")).toBe("[발언자 A] ");
    expect(formatSpeakerPrefix("")).toBe("");
  });

  it("whitelists only safe CSS color tokens for accents", () => {
    expect(sanitizeSpeakerColorForCss("rgb(35, 124, 147)")).toBe(
      "rgb(35, 124, 147)",
    );
    expect(sanitizeSpeakerColorForCss("#237c93")).toBe("#237c93");
    expect(sanitizeSpeakerColorForCss("expression(alert(1))")).toBe("");
    expect(sanitizeSpeakerColorForCss("url(javascript:alert(1))")).toBe("");
    expect(resolveSpeakerAccentColor("expression(alert(1))", "primary")).toBe(
      "rgb(35, 124, 147)",
    );
  });
});
