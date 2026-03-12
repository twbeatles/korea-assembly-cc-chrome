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

  it("keeps mixed numeric-symbol fragments classified as noise", () => {
    expect(isNoiseOnly("123_456")).toBe(true);
    expect(isMeaningfulSubtitleText("123_456")).toBe(false);
  });

  it("continues to treat non-Korean foreign text as unsupported noise", () => {
    expect(isNoiseOnly("字幕")).toBe(true);
    expect(isMeaningfulSubtitleText("字幕")).toBe(false);
  });
});
