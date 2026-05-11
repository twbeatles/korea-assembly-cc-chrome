import { describe, expect, it } from "vitest";

import {
  createContinuedSessionState,
  mergeSessionSegments,
  mergeSessionSegmentEntries,
  sortSessionSegments,
} from "../src/core/session-lineage";
import {
  createEmptySessionState,
  resolveSessionLineageId,
  resolveSessionSegmentNumber,
} from "../src/core/subtitle-models";

describe("session lineage helpers", () => {
  it("normalizes lineage ids and segment numbers", () => {
    expect(resolveSessionLineageId("session_1", "")).toBe("session_1");
    expect(resolveSessionLineageId("session_1", "lineage_1")).toBe("lineage_1");
    expect(resolveSessionSegmentNumber(undefined)).toBe(1);
    expect(resolveSessionSegmentNumber(3.9)).toBe(3);
  });

  it("sorts segments and merges entries in segment order", () => {
    const sorted = sortSessionSegments([
      {
        id: "segment_2",
        lineageId: "lineage_1",
        segmentNumber: 2,
        startedAt: "2026-03-10T09:10:00.000Z",
        updatedAt: "2026-03-10T09:12:00.000Z",
      },
      {
        id: "segment_1",
        lineageId: "lineage_1",
        segmentNumber: 1,
        startedAt: "2026-03-10T09:00:00.000Z",
        updatedAt: "2026-03-10T09:05:00.000Z",
      },
    ]);

    expect(sorted.map((session) => session.id)).toEqual(["segment_1", "segment_2"]);

    const entries = mergeSessionSegmentEntries([
      {
        ...sorted[1]!,
        entries: [
          {
            id: "entry_2",
            text: "두 번째 구간",
            timestamp: "2026-03-10T09:11:00.000Z",
            startTime: "2026-03-10T09:11:00.000Z",
            endTime: "2026-03-10T09:11:02.000Z",
          },
        ],
      },
      {
        ...sorted[0]!,
        entries: [
          {
            id: "entry_1",
            text: "첫 번째 구간",
            timestamp: "2026-03-10T09:01:00.000Z",
            startTime: "2026-03-10T09:01:00.000Z",
            endTime: "2026-03-10T09:01:02.000Z",
          },
        ],
      },
    ]);

    expect(entries.map((entry) => entry.id)).toEqual(["entry_1", "entry_2"]);
  });

  it("builds a merged lineage session record from ordered segments", () => {
    const merged = mergeSessionSegments([
      {
        id: "segment_2",
        version: "3",
        title: "국회 본회의",
        committeeName: "정무위원회",
        sourceUrl: "https://assembly.webcast.go.kr/main/player.asp",
        startedAt: "2026-03-10T09:10:00.000Z",
        endedAt: "2026-03-10T09:12:00.000Z",
        createdAt: "2026-03-10T09:10:00.000Z",
        updatedAt: "2026-03-10T09:12:00.000Z",
        subtitleCount: 1,
        charCount: 6,
        status: "saved",
        starred: false,
        pinnedAt: null,
        note: "segment 2",
        lineageId: "lineage_1",
        segmentNumber: 2,
        entries: [
          {
            id: "entry_2",
            text: "두 번째 구간",
            timestamp: "2026-03-10T09:11:00.000Z",
            startTime: "2026-03-10T09:11:00.000Z",
            endTime: "2026-03-10T09:11:02.000Z",
          },
        ],
      },
      {
        id: "lineage_1",
        version: "3",
        title: "국회 본회의",
        committeeName: "정무위원회",
        sourceUrl: "https://assembly.webcast.go.kr/main/player.asp",
        startedAt: "2026-03-10T09:00:00.000Z",
        endedAt: "2026-03-10T09:05:00.000Z",
        createdAt: "2026-03-10T09:00:00.000Z",
        updatedAt: "2026-03-10T09:05:00.000Z",
        subtitleCount: 1,
        charCount: 6,
        status: "saved",
        starred: true,
        pinnedAt: "2026-03-10T09:06:00.000Z",
        note: "segment 1",
        lineageId: "lineage_1",
        segmentNumber: 1,
        entries: [
          {
            id: "entry_1",
            text: "첫 번째 구간",
            timestamp: "2026-03-10T09:01:00.000Z",
            startTime: "2026-03-10T09:01:00.000Z",
            endTime: "2026-03-10T09:01:02.000Z",
          },
        ],
      },
    ]);

    expect(merged.id).toBe("lineage_1");
    expect(merged.startedAt).toBe("2026-03-10T09:00:00.000Z");
    expect(merged.endedAt).toBe("2026-03-10T09:12:00.000Z");
    expect(merged.starred).toBe(true);
    expect(merged.entries.map((entry) => entry.id)).toEqual(["entry_1", "entry_2"]);
  });

  it("creates the next running state with incremented segment number", () => {
    const state = createEmptySessionState(
      "https://assembly.webcast.go.kr/main/player.asp",
      "국회 본회의",
      "정무위원회",
    );
    state.lineageId = "lineage_1";
    state.segmentNumber = 2;

    const nextState = createContinuedSessionState(
      state,
      state.sourceUrl,
      state.title,
      state.committeeName,
      "2026-03-10T10:00:00.000Z",
    );

    expect(nextState.lineageId).toBe("lineage_1");
    expect(nextState.segmentNumber).toBe(3);
    expect(nextState.status).toBe("running");
  });
});
