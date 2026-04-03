import { describe, expect, it } from "vitest";

import { deriveCommitteeNameFromTitle } from "../src/content/committee-name";

describe("deriveCommitteeNameFromTitle", () => {
  it("preserves dates and regular hyphenated titles", () => {
    expect(deriveCommitteeNameFromTitle("행정안전위원회 2026-03-23 전체회의")).toBe(
      "행정안전위원회 2026-03-23 전체회의",
    );
    expect(deriveCommitteeNameFromTitle("과학기술정보방송통신위원회 - 1차 회의")).toBe(
      "과학기술정보방송통신위원회 - 1차 회의",
    );
  });

  it("removes only known broadcast suffixes", () => {
    expect(deriveCommitteeNameFromTitle("교육위원회 | 국회TV")).toBe("교육위원회");
    expect(deriveCommitteeNameFromTitle("정무위원회 - 국회방송")).toBe("정무위원회");
  });
});
