import { describe, expect, it } from "vitest";

import { createEmptySessionState } from "../src/core/subtitle-models";
import {
  resolveRuntimeSessionSegmentationReason,
  resolveRuntimeSessionSegmentationThresholds,
} from "../src/content/runtime/segmentation-policy";

function buildRunningState() {
  const state = createEmptySessionState(
    "https://assembly.webcast.go.kr/main/player.asp",
    "국회 본회의",
    "정무위원회",
  );
  state.status = "running";
  state.startedAt = "2026-03-10T09:00:00.000Z";
  state.entries = [
    {
      id: "entry_1",
      text: "첫 번째 자막",
      timestamp: "2026-03-10T09:00:01.000Z",
      startTime: "2026-03-10T09:00:01.000Z",
      endTime: "2026-03-10T09:00:02.000Z",
    },
    {
      id: "entry_2",
      text: "두 번째 자막",
      timestamp: "2026-03-10T09:00:03.000Z",
      startTime: "2026-03-10T09:00:03.000Z",
      endTime: "2026-03-10T09:00:04.000Z",
    },
  ];
  return state;
}

describe("runtime segmentation policy", () => {
  it("returns the first matching boundary reason", () => {
    const state = buildRunningState();

    expect(
      resolveRuntimeSessionSegmentationReason(state, Date.parse("2026-03-10T09:10:00.000Z"), {
        maxEntriesPerSegment: 2,
        maxCharsPerSegment: 1000,
        maxDurationMs: 1000 * 60 * 60,
      }),
    ).toBe("entry_limit");
  });

  it("detects character and duration limits when entry limit is not reached", () => {
    const state = buildRunningState();

    expect(
      resolveRuntimeSessionSegmentationReason(state, Date.parse("2026-03-10T09:10:00.000Z"), {
        maxEntriesPerSegment: 100,
        maxCharsPerSegment: 4,
        maxDurationMs: 1000 * 60 * 60,
      }),
    ).toBe("char_limit");

    expect(
      resolveRuntimeSessionSegmentationReason(state, Date.parse("2026-03-10T11:00:00.000Z"), {
        maxEntriesPerSegment: 100,
        maxCharsPerSegment: 1000,
        maxDurationMs: 1000,
      }),
    ).toBe("duration_limit");
  });

  it("derives runtime thresholds from persisted settings", () => {
    expect(
      resolveRuntimeSessionSegmentationThresholds({
        maxEntriesPerSegment: 2500,
        maxCharsPerSegment: 150000,
        maxSegmentDurationMinutes: 120,
      }),
    ).toEqual({
      maxEntriesPerSegment: 2500,
      maxCharsPerSegment: 150000,
      maxDurationMs: 120 * 60 * 1000,
    });
  });
});
