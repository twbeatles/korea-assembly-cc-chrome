import { describe, expect, it } from "vitest";

import {
  formatFallbackPreviewText,
  normalizeFallbackInternalRaw,
} from "../src/content/fallback-preview";
import { PIPELINE_DEFAULTS } from "../src/shared/constants";

describe("fallback preview helpers", () => {
  it("keeps only the trailing 4KB window for internal fallback raw text", () => {
    const prefix = "A".repeat(PIPELINE_DEFAULTS.fallbackInternalRawMaxChars);
    const suffix = "B".repeat(200);
    const normalized = normalizeFallbackInternalRaw(`${prefix}${suffix}`);

    expect(normalized.length).toBe(PIPELINE_DEFAULTS.fallbackInternalRawMaxChars);
    expect(normalized.endsWith(suffix)).toBe(true);
  });

  it("shows only the trailing three lines on long plenary fallback preview", () => {
    const lines = Array.from({ length: 12 }, (_, index) => `plenary line ${index + 1}`);
    const formatted = formatFallbackPreviewText(
      lines.join("\n"),
      "https://assembly.webcast.go.kr/main/player.asp?xcode=10",
    );

    expect(formatted).not.toContain("plenary line 8");
    expect(formatted).toContain("plenary line 10");
    expect(formatted).toContain("plenary line 11");
    expect(formatted).toContain("plenary line 12");
  });

  it("shows only the trailing three lines on long committee fallback preview", () => {
    const lines = Array.from(
      { length: 12 },
      (_, index) => `committee line ${index + 1} ${"x".repeat(32)}`,
    );
    const formatted = formatFallbackPreviewText(
      lines.join("\n"),
      "https://assembly.webcast.go.kr/main/player.asp?xcode=25&xcgcd=DCM000025000000000",
    );

    expect(formatted).not.toContain("committee line 8");
    expect(formatted).toContain("committee line 10");
    expect(formatted).toContain("committee line 11");
    expect(formatted).toContain("committee line 12");
  });
});
