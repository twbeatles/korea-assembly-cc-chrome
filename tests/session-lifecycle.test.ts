import { describe, expect, it } from "vitest";

import { createEmptySessionState } from "../src/core/subtitle-models";
import { DEFAULT_EXTENSION_SETTINGS } from "../src/shared/constants";
import {
  buildPreparedSessionRecord,
  buildPreparedSessionState,
  createContinuedSessionState,
  createResetSessionState,
} from "../src/content/session-lifecycle";

describe("session lifecycle helpers", () => {
  it("drops pending previews from a prepared session state", () => {
    const state = createEmptySessionState(
      "https://assembly.webcast.go.kr/main/player.asp",
      "국회 본회의",
      "정무위원회",
    );
    state.previewText = "첫 번째 미리보기 자막";
    state.pendingPreviews = ["아직 확정되지 않은 미리보기 A", "미리보기 B"];

    const prepared = buildPreparedSessionState(state, DEFAULT_EXTENSION_SETTINGS, Date.parse("2026-03-10T09:00:00.000Z"));

    expect(prepared.entries).toHaveLength(0);
    expect(prepared.pendingPreviews).toEqual([]);
    // 원본 state 는 변경하지 않는다
    expect(state.pendingPreviews).toHaveLength(2);
  });

  it("builds a persisted session record without materializing pending previews", () => {
    const state = createEmptySessionState(
      "https://assembly.webcast.go.kr/main/player.asp",
      "국회 본회의",
      "정무위원회",
    );
    state.previewText = "종료 전 자막";
    state.pendingPreviews = ["preview-only 텍스트는 저장되면 안 됨"];

    const record = buildPreparedSessionRecord(
      state,
      DEFAULT_EXTENSION_SETTINGS,
      "saved",
      Date.parse("2026-03-10T09:00:00.000Z"),
    );

    expect(record.status).toBe("saved");
    expect(record.subtitleCount).toBe(0);
    expect(record.entries).toEqual([]);
    expect(record.entries.some((entry) => entry.text.includes("preview-only"))).toBe(false);
  });

  it("keeps already committed entries while still clearing pending previews", () => {
    const state = createEmptySessionState(
      "https://assembly.webcast.go.kr/main/player.asp",
      "국회 본회의",
      "정무위원회",
    );
    state.entries = [
      {
        id: "entry_committed",
        text: "이미 확정된 자막",
        timestamp: "2026-03-10T09:00:01.000Z",
        startTime: "2026-03-10T09:00:01.000Z",
        endTime: "2026-03-10T09:00:02.000Z",
      },
    ];
    state.pendingPreviews = ["미확정 미리보기"];

    const record = buildPreparedSessionRecord(
      state,
      DEFAULT_EXTENSION_SETTINGS,
      "stopped",
      Date.parse("2026-03-10T09:00:05.000Z"),
    );

    expect(record.entries).toHaveLength(1);
    expect(record.entries[0].text).toBe("이미 확정된 자막");
    expect(record.subtitleCount).toBe(1);
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

  it("creates a continued running segment state inside the same lineage", () => {
    const currentState = createEmptySessionState(
      "https://assembly.webcast.go.kr/main/player.asp",
      "국회 본회의",
      "정무위원회",
    );
    currentState.lineageId = "lineage_runtime";
    currentState.segmentNumber = 1;

    const continuedState = createContinuedSessionState(
      currentState,
      "https://assembly.webcast.go.kr/main/player.asp",
      "국회 본회의",
      "정무위원회",
      "2026-03-10T09:30:00.000Z",
    );

    expect(continuedState.sessionId).not.toBe(currentState.sessionId);
    expect(continuedState.lineageId).toBe("lineage_runtime");
    expect(continuedState.segmentNumber).toBe(2);
    expect(continuedState.status).toBe("running");
    expect(continuedState.startedAt).toBe("2026-03-10T09:30:00.000Z");
  });
});
