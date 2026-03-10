import { isMeaningfulSubtitleText, isNoiseOnly } from "../src/core/noise-filter";

describe("noise filter", () => {
  it("allows one or two Korean and English utterances", () => {
    expect(isMeaningfulSubtitleText("네")).toBe(true);
    expect(isMeaningfulSubtitleText("OK")).toBe(true);
  });

  it("rejects numeric-only strings", () => {
    expect(isNoiseOnly("123")).toBe(true);
    expect(isMeaningfulSubtitleText("2026")).toBe(false);
  });

  it("rejects symbol-only strings", () => {
    expect(isNoiseOnly("...")).toBe(true);
    expect(isMeaningfulSubtitleText("!!!")).toBe(false);
  });
});
