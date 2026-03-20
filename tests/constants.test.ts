import { describe, expect, it } from "vitest";

import {
  ASSEMBLY_HOST_MATCH_PATTERNS,
  isAssemblyPlenaryUrl,
  isSupportedAssemblyUrl,
} from "../src/shared/constants";

describe("assembly host constants", () => {
  it("supports both fixed assembly webcast domains", () => {
    expect(isSupportedAssemblyUrl("https://assembly.webcast.go.kr/main/player.do")).toBe(true);
    expect(isSupportedAssemblyUrl("https://webcast.assembly.go.kr/main/player.do")).toBe(true);
    expect(isSupportedAssemblyUrl("https://example.com")).toBe(false);
    expect(ASSEMBLY_HOST_MATCH_PATTERNS).toEqual([
      "https://assembly.webcast.go.kr/*",
      "https://webcast.assembly.go.kr/*",
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
