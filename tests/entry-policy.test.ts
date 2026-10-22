import { describe, expect, it } from "vitest";

import { createEmptySessionState } from "../src/core/subtitle-models";
import {
  applyKeepalive,
  applyPreview,
  applyStructuredEntry,
} from "../src/core/subtitle-pipeline";

// 2026-10-22 데스크톱 정합: 병합 경계·keepalive 규칙의 파이프라인 단위 회귀.
// 순수 규칙은 parity/pipeline-vectors.json (tests/parity-contract.test.ts) 이 고정한다.
describe("entry policy (desktop parity)", () => {
  const now = Date.parse("2026-10-22T01:00:00.000Z");

  it("starts a new entry when fallback text follows a structured entry", () => {
    let state = createEmptySessionState("http://test.com", "Test");
    state = applyStructuredEntry(
      state,
      "위원장 발언입니다",
      "위원장 발언입니다",
      now,
      undefined,
      {
        sourceNodeKey: "top::class:stxt1",
        sourceCaptureMode: "structured",
      },
    ).state;

    const result = applyPreview(
      state,
      "위원장 발언입니다 이어서 다른 텍스트",
      now + 500,
      undefined,
      {
        sourceCaptureMode: "fallback",
      },
    );

    expect(result.state.entries.map((entry) => entry.text)).toEqual([
      "위원장 발언입니다",
      "이어서 다른 텍스트",
    ]);
  });

  it("does not treat an unknown speaker channel as a speaker change", () => {
    let state = createEmptySessionState("http://test.com", "Test");
    state = applyPreview(state, "첫 발언", now, undefined, {
      speakerChannel: "primary",
    }).state;

    const result = applyPreview(
      state,
      "첫 발언 이어지는 말",
      now + 500,
      undefined,
      {
        speakerChannel: "unknown",
      },
    );

    expect(result.state.entries).toHaveLength(1);
    expect(result.state.entries[0].text).toBe("첫 발언 이어지는 말");
    expect(result.state.entries[0].speakerChanged).toBeUndefined();
  });

  it("extends endTime only when the raw still ends with the last entry", () => {
    let state = createEmptySessionState("http://test.com", "Test");
    state = applyPreview(state, "마지막 줄입니다", now).state;

    const extended = applyKeepalive(
      state,
      now + 2000,
      "앞줄 이전 발언 마지막 줄입니다",
    );
    expect(extended.changed).toBe(true);
    expect(extended.state.entries[0].endTime).toBe(
      new Date(now + 2000).toISOString(),
    );

    const mismatch = applyKeepalive(
      extended.state,
      now + 3000,
      "마지막 줄입니다 그리고 새 줄",
    );
    expect(mismatch.changed).toBe(false);
    expect(mismatch.reason).toBe("raw_mismatch");
    expect(mismatch.state.entries[0].endTime).toBe(
      new Date(now + 2000).toISOString(),
    );
  });
});
