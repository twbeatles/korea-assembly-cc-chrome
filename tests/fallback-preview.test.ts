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

  it("keeps full internal fallback raw on plenary urls", () => {
    const raw = `${"A".repeat(PIPELINE_DEFAULTS.fallbackInternalRawMaxChars)}${"B".repeat(200)}`;
    const normalized = normalizeFallbackInternalRaw(raw, {
      sourceUrl: "https://assembly.webcast.go.kr/main/player.asp?xcode=10",
    });

    expect(normalized.length).toBe(raw.length);
    expect(normalized.startsWith("A")).toBe(true);
    expect(normalized.endsWith("B".repeat(200))).toBe(true);
  });

  it("caps plenary preview while preserving full internal raw separately", () => {
    const lines = Array.from({ length: 12 }, (_, index) => `plenary line ${index + 1}`);
    const formatted = formatFallbackPreviewText(lines.join("\n"));

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
    const formatted = formatFallbackPreviewText(lines.join("\n"));

    expect(formatted).not.toContain("committee line 8");
    expect(formatted).toContain("committee line 10");
    expect(formatted).toContain("committee line 11");
    expect(formatted).toContain("committee line 12");
  });
});
