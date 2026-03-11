import {
  extractByTrailingSuffix,
  extractIncrement,
  sliceIncrementalPart,
} from "../src/core/suffix-diff";
import { compactSubtitleText } from "../src/core/text-normalizer";

describe("suffix diff", () => {
  it("uses rfind to cut after the last matching suffix", () => {
    const suffix = compactSubtitleText("위원장 감사합니다");
    const raw =
      "기존 텍스트 위원장 감사합니다 중간 텍스트 위원장 감사합니다 새로운 발언";
    const increment = extractByTrailingSuffix(raw, compactSubtitleText(raw), suffix);

    expect(compactSubtitleText(increment)).toContain("새로운발언");
    expect(compactSubtitleText(increment)).not.toContain("중간텍스트");
  });

  it("handles repeated prefix and suffix overlaps", () => {
    const previous = "예산안 보고를 하겠습니다";
    const next = "위원장 예산안 보고를 하겠습니다 다음은 세입 세출안입니다";

    expect(extractIncrement(next, previous)).toBe("다음은 세입 세출안입니다");
  });

  it("cuts only the appended tail when the previous sentence is repeated", () => {
    const previous = "이 문장은 테스트입니다";
    const next = "이 문장은 테스트입니다 감사합니다";

    expect(extractIncrement(next, previous)).toBe("감사합니다");
  });

  it("returns the raw text when suffix is not found", () => {
    const raw = "완전히 새로운 문장입니다";
    const increment = extractByTrailingSuffix(raw, compactSubtitleText(raw), "전혀다른문장");

    expect(increment).toBe(raw);
  });

  it("uses anchor slicing as a fallback when suffix is ambiguous", () => {
    const raw = "최근 발언입니다 위원장 감사합니다 새로운 결론입니다";
    const anchor = compactSubtitleText("위원장 감사합니다");
    const increment = sliceIncrementalPart(raw, anchor, compactSubtitleText(raw), 6, 4);

    expect(increment).toBe("새로운 결론입니다");
  });

  it("filters out short duplicate sentences matching minOverlap=4", () => {
    const previous = "주요 작물의 생육 상황은 전반적으로 양호합니다 다만 사과";
    const next = "다만 사과에 꽂는 분화율이 다소 낮았으나";
    // "다만사과" = 4 characters. Overlap should be found and "에 꽂는..." returned.
    expect(extractIncrement(next, previous)).toBe("에 꽂는 분화율이 다소 낮았으나");
  });
});
