import { describe, expect, it } from "vitest";

import { createEmptySessionState } from "../src/core/subtitle-models";
import { DEFAULT_EXTENSION_SETTINGS } from "../src/shared/constants";
import {
  buildPreparedSessionRecord,
  buildPreparedSessionState,
  createResetSessionState,
} from "../src/content/session-lifecycle";

describe("session lifecycle helpers", () => {
  it("does not promote preview-only text into a prepared session state", () => {
    const state = createEmptySessionState(
      "https://assembly.webcast.go.kr/main/player.asp",
      "국회 본회의",
      "정무위원회",
    );
    state.previewText = "첫 번째 미리보기 자막";

    const prepared = buildPreparedSessionState(state, DEFAULT_EXTENSION_SETTINGS, Date.parse("2026-03-10T09:00:00.000Z"));

    expect(prepared.entries).toHaveLength(0);
    expect(prepared.previewText).toBe("첫 번째 미리보기 자막");
  });

  it("builds a persisted session record from committed entries only", () => {
    const state = createEmptySessionState(
      "https://assembly.webcast.go.kr/main/player.asp",
      "국회 본회의",
      "정무위원회",
    );
    state.previewText = "종료 전 자막";

    const record = buildPreparedSessionRecord(
      state,
      DEFAULT_EXTENSION_SETTINGS,
      "saved",
      Date.parse("2026-03-10T09:00:00.000Z"),
    );

    expect(record.status).toBe("saved");
    expect(record.subtitleCount).toBe(0);
    expect(record.entries).toEqual([]);
  });

  it("creates a fresh reset session state for the current page", () => {
    const resetState = createResetSessionState(
      "https://assembly.webcast.go.kr/main/player.asp",
      "국회 본회의",
      "정무위원회",
    );

    expect(resetState.status).toBe("idle");
    expect(resetState.sourceUrl).toBe("https://assembly.webcast.go.kr/main/player.asp");
    expect(resetState.title).toBe("국회 본회의");
    expect(resetState.committeeName).toBe("정무위원회");
    expect(resetState.entries).toEqual([]);
  });
});
