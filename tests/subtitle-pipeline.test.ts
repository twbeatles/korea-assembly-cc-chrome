import { describe, expect, it } from "vitest";

import { createEmptySessionState } from "../src/core/subtitle-models";
import {
  applyKeepalive,
  applyPreview,
  applyStructuredEntry,
  commitLiveRow,
  finalizeSession,
} from "../src/core/subtitle-pipeline";

describe("subtitle pipeline", () => {
  it("updates the last entry in place when the same row key is corrected", () => {
    let state = createEmptySessionState("http://test.com", "Test");
    const now = Date.parse("2026-03-11T08:00:00.000Z");

    state = applyStructuredEntry(
      state,
      "첫 번째 문장",
      "첫 번째 문장",
      now,
      undefined,
      { sourceNodeKey: "top::row_1" },
    ).state;

    const result = applyStructuredEntry(
      state,
      "첫 번째 문장 수정",
      "첫 번째 문장 수정",
      now + 1000,
      undefined,
      { sourceNodeKey: "top::row_1" },
    );

    expect(result.changed).toBe(true);
    expect(result.state.entries).toHaveLength(1);
    expect(result.state.entries[0].text).toBe("첫 번째 문장 수정");
    expect(result.state.entries[0].sourceNodeKey).toBe("top::row_1");
  });

  it("trims carry-over text when a new row starts with the previous sentence", () => {
    let state = createEmptySessionState("http://test.com", "Test");
    const now = Date.parse("2026-03-11T08:05:00.000Z");

    state = applyStructuredEntry(
      state,
      "위원님 말씀드렸는데요 이번 내년 예산 편성 과정에서 잘 살펴서",
      "위원님 말씀드렸는데요 이번 내년 예산 편성 과정에서 잘 살펴서",
      now,
      undefined,
      { sourceNodeKey: "top::row_1" },
    ).state;

    const result = commitLiveRow(
      state,
      "위원님 말씀드렸는데요 이번 내년 예산 편성 과정에서 잘 살펴서 저희가 방법을 찾아보겠습니다",
      "위원님 말씀드렸는데요 이번 내년 예산 편성 과정에서 잘 살펴서 저희가 방법을 찾아보겠습니다",
      now + 1000,
      undefined,
      {
        sourceNodeKey: "top::row_2",
        baselineCompact: state.confirmedCompact,
      },
    );

    expect(result.changed).toBe(true);
    expect(result.state.entries).toHaveLength(2);
    expect(result.state.entries[1].text).toBe("저희가 방법을 찾아보겠습니다");
  });

  it("recomputes the same row against its original baseline when the row grows", () => {
    let state = createEmptySessionState("http://test.com", "Test");
    const now = Date.parse("2026-03-11T08:10:00.000Z");

    state = applyStructuredEntry(
      state,
      "지금 국제전쟁은 이제는 단순히 옛날처럼",
      "지금 국제전쟁은 이제는 단순히 옛날처럼",
      now,
      undefined,
      { sourceNodeKey: "top::row_1" },
    ).state;

    const baselineCompact = state.confirmedCompact;
    const firstCommit = commitLiveRow(
      state,
      "지금 국제전쟁은 이제는 단순히 옛날처럼 과거 재래전처럼",
      "지금 국제전쟁은 이제는 단순히 옛날처럼 과거 재래전처럼",
      now + 1000,
      undefined,
      {
        sourceNodeKey: "top::row_2",
        baselineCompact,
      },
    );

    const rowEntryId = firstCommit.appendedEntry?.id;
    expect(firstCommit.state.entries[1].text).toBe("과거 재래전처럼");

    const updatedCommit = commitLiveRow(
      firstCommit.state,
      "지금 국제전쟁은 이제는 단순히 옛날처럼 과거 재래전처럼 이렇게 사람들이 직접 참여하는 육박전",
      "지금 국제전쟁은 이제는 단순히 옛날처럼 과거 재래전처럼 이렇게 사람들이 직접 참여하는 육박전",
      now + 2000,
      undefined,
      {
        sourceNodeKey: "top::row_2",
        entryId: rowEntryId,
        baselineCompact,
      },
    );

    expect(updatedCommit.changed).toBe(true);
    expect(updatedCommit.state.entries).toHaveLength(2);
    expect(updatedCommit.state.entries[1].text).toBe(
      "과거 재래전처럼 이렇게 사람들이 직접 참여하는 육박전",
    );
  });

  it("uses rfind-style raw fallback to avoid re-appending repeated preview text", () => {
    let state = createEmptySessionState("http://test.com", "Test");
    const now = Date.parse("2026-03-11T08:15:00.000Z");

    state = applyPreview(
      state,
      "위원장 감사합니다",
      now,
    ).state;

    state = applyPreview(
      state,
      "위원장 감사합니다 추가 발언입니다",
      now + 1000,
    ).state;

    const repeated = applyPreview(
      state,
      "위원장 감사합니다 추가 발언입니다",
      now + 2000,
    );

    expect(state.entries).toHaveLength(1);
    expect(state.entries[0].text).toBe("위원장 감사합니다 추가 발언입니다");
    expect(repeated.changed).toBe(false);
    expect(repeated.state.entries).toHaveLength(1);
  });

  it("extends the last entry during keepalive and finalizes the session", () => {
    let state = createEmptySessionState("http://test.com", "Test");
    const now = Date.parse("2026-03-11T08:20:00.000Z");

    state = applyStructuredEntry(
      state,
      "완료될 문장",
      "완료될 문장",
      now,
      undefined,
      { sourceNodeKey: "top::row_1" },
    ).state;

    const keepalive = applyKeepalive(state, now + 1000);
    const finalized = finalizeSession(keepalive.state, now + 5000);

    expect(keepalive.state.entries[0].endTime).toBeTruthy();
    expect(finalized.state.status).toBe("stopped");
    expect(finalized.state.entries[0].endTime).toBeTruthy();
  });
});
