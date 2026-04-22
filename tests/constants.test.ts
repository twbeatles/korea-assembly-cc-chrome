import { describe, expect, it } from "vitest";

import {
  ASSEMBLY_CAPTURE_MATCH_PATTERNS,
  ASSEMBLY_SITE_MATCH_PATTERNS,
  isSupportedAssemblySiteUrl,
  isAssemblyPlenaryUrl,
  isSupportedAssemblyUrl,
} from "../src/shared/constants";

describe("assembly host constants", () => {
  it("supports the home page and player pages on the fixed assembly webcast domains", () => {
    expect(isSupportedAssemblySiteUrl("https://assembly.webcast.go.kr/main/")).toBe(true);
    expect(isSupportedAssemblySiteUrl("https://webcast.assembly.go.kr/main/")).toBe(true);
    expect(isSupportedAssemblySiteUrl("https://assembly.webcast.go.kr/main/player.do")).toBe(true);
    expect(isSupportedAssemblyUrl("https://assembly.webcast.go.kr/main/player.do")).toBe(true);
    expect(isSupportedAssemblyUrl("https://webcast.assembly.go.kr/main/player.do")).toBe(true);
    expect(isSupportedAssemblyUrl("https://assembly.webcast.go.kr/main/")).toBe(false);
    expect(isSupportedAssemblyUrl("https://assembly.webcast.go.kr/main/sub.do?menu=20")).toBe(false);
    expect(isSupportedAssemblySiteUrl("https://assembly.webcast.go.kr/main/sub.do?menu=20")).toBe(false);
    expect(isSupportedAssemblyUrl("https://example.com")).toBe(false);
    expect(isSupportedAssemblySiteUrl("https://example.com")).toBe(false);
    expect(ASSEMBLY_SITE_MATCH_PATTERNS).toEqual([
      "https://assembly.webcast.go.kr/main/",
      "https://webcast.assembly.go.kr/main/",
      "https://assembly.webcast.go.kr/main/player*",
      "https://webcast.assembly.go.kr/main/player*",
    ]);
    expect(ASSEMBLY_CAPTURE_MATCH_PATTERNS).toEqual([
      "https://assembly.webcast.go.kr/main/player*",
      "https://webcast.assembly.go.kr/main/player*",
    ]);
  });

  it("detects plenary urls by xcode or xcgcd", () => {
    expect(
      isAssemblyPlenaryUrl(
        "https://assembly.webcast.go.kr/main/player.asp?xcode=10&xcgcd=DCM000010224330202",
      ),
    ).toBe(true);
    expect(
      isAssemblyPlenaryUrl(
        "https://webcast.assembly.go.kr/main/player.asp?xcgcd=DCM000010999999999",
      ),
    ).toBe(true);
    expect(
      isAssemblyPlenaryUrl(
        "https://assembly.webcast.go.kr/main/player.asp?xcode=25&xcgcd=DCM000025224330202",
      ),
    ).toBe(false);
    expect(isAssemblyPlenaryUrl("https://example.com/main/player.asp?xcode=10")).toBe(false);
  });
});
