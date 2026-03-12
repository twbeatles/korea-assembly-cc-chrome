import { describe, expect, it } from "vitest";

import {
  ASSEMBLY_HOST_MATCH_PATTERNS,
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
});
