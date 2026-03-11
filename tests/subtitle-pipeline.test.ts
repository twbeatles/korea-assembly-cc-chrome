import {
  applyKeepalive,
  applyPreview,
  applyReset,
  applyStructuredEntry,
  finalizeSession,
  flushPendingPreviews,
} from "../src/core/subtitle-pipeline";
import { createEmptySessionState } from "../src/core/subtitle-models";

function buildRunningState() {
  const state = createEmptySessionState(
    "https://assembly.webcast.go.kr/main/player.asp",
    "법제사법위원회",
    "법제사법위원회",
  );
  const now = new Date("2026-03-10T09:00:00.000Z").toISOString();
  state.status = "running";
  state.createdAt = now;
  state.startedAt = now;
  state.updatedAt = now;
  return state;
}

describe("subtitle pipeline", () => {
  it("appends incremental preview text", () => {
    let state = buildRunningState();
    state = applyPreview(state, "첫 번째 자막입니다", Date.parse("2026-03-10T09:00:01.000Z")).state;
    state = applyPreview(
      state,
      "첫 번째 자막입니다 새로운 발언입니다",
      Date.parse("2026-03-10T09:00:02.000Z"),
    ).state;

    expect(state.entries).toHaveLength(1);
    expect(state.entries[0].text).toContain("새로운 발언입니다");
  });

  it("updates the last entry end time on keepalive", () => {
    let state = buildRunningState();
    state = applyPreview(state, "같은 자막입니다", Date.parse("2026-03-10T09:00:01.000Z")).state;
    const before = state.entries[0].endTime;

    state = applyKeepalive(state, Date.parse("2026-03-10T09:00:04.000Z")).state;

    expect(state.entries[0].endTime).not.toBe(before);
  });

  it("clears suffix history on reset", () => {
    let state = buildRunningState();
    state = applyPreview(state, "리셋 전 자막입니다", Date.parse("2026-03-10T09:00:01.000Z")).state;
    state = applyReset(state, Date.parse("2026-03-10T09:00:03.000Z")).state;

    expect(state.trailingSuffix).toBe("");
    expect(state.confirmedCompact).toBe("");
    expect(state.lastObservedRaw).toBe("");
    expect(state.previewText).toBe("");
  });

  it("drains pending previews and finalizes the session", () => {
    const state = buildRunningState();
    state.pendingPreviews = ["마지막 보류 자막입니다"];

    const finalized = finalizeSession(state, Date.parse("2026-03-10T09:00:05.000Z")).state;

    expect(finalized.status).toBe("stopped");
    expect(finalized.entries.at(-1)?.text).toContain("마지막 보류 자막입니다");
    expect(finalized.endedAt).toBeTruthy();
  });

  it("flushes pending previews without mutating the live running state", () => {
    const state = buildRunningState();
    state.pendingPreviews = ["보류 중인 최신 자막입니다"];

    const flushed = flushPendingPreviews(state, Date.parse("2026-03-10T09:00:05.000Z"));

    expect(state.entries).toHaveLength(0);
    expect(state.pendingPreviews).toHaveLength(1);
    expect(flushed.entries.at(-1)?.text).toContain("보류 중인 최신 자막입니다");
    expect(flushed.status).toBe("running");
  });

  it("keeps numeric subtitles when noise filtering is disabled", () => {
    let state = buildRunningState();
    state = applyPreview(
      state,
      "2026",
      Date.parse("2026-03-10T09:00:01.000Z"),
      { noiseFilterEnabled: false, recentDuplicateMinLength: 8 },
    ).state;

    expect(state.entries).toHaveLength(1);
    expect(state.entries[0].text).toBe("2026");
  });

  it("updates the last entry in place when the same subtitle node changes", () => {
    let state = buildRunningState();
    state = applyStructuredEntry(
      state,
      "첫 문장입니다",
      "첫 문장입니다",
      Date.parse("2026-03-10T09:00:01.000Z"),
      undefined,
      {
        sourceNodeKey: "node_1",
      },
    ).state;
    state = applyStructuredEntry(
      state,
      "첫 문장입니다 보완되었습니다",
      "첫 문장입니다 보완되었습니다",
      Date.parse("2026-03-10T09:00:02.000Z"),
      undefined,
      {
        sourceNodeKey: "node_1",
      },
    ).state;

    expect(state.entries).toHaveLength(1);
    expect(state.entries[0].text).toBe("첫 문장입니다 보완되었습니다");
    expect(state.entries[0].sourceNodeKey).toBe("node_1");
  });

  it("creates a new entry when the active subtitle node changes", () => {
    let state = buildRunningState();
    state = applyStructuredEntry(
      state,
      "첫 발언입니다",
      "첫 발언입니다",
      Date.parse("2026-03-10T09:00:01.000Z"),
      undefined,
      {
        sourceNodeKey: "node_1",
      },
    ).state;
    state = applyStructuredEntry(
      state,
      "두 번째 발언입니다",
      "두 번째 발언입니다",
      Date.parse("2026-03-10T09:00:02.000Z"),
      undefined,
      {
        sourceNodeKey: "node_2",
      },
    ).state;

    expect(state.entries).toHaveLength(2);
    expect(state.entries[1].sourceNodeKey).toBe("node_2");
  });

  it("does not merge the first subtitle after a reset", () => {
    let state = buildRunningState();
    state = applyStructuredEntry(
      state,
      "리셋 전 발언입니다",
      "리셋 전 발언입니다",
      Date.parse("2026-03-10T09:00:01.000Z"),
      undefined,
      {
        sourceNodeKey: "node_1",
      },
    ).state;
    state = applyReset(state, Date.parse("2026-03-10T09:00:02.000Z")).state;
    state = applyStructuredEntry(
      state,
      "리셋 후 새 발언입니다",
      "리셋 후 새 발언입니다",
      Date.parse("2026-03-10T09:00:03.000Z"),
      undefined,
      {
        sourceNodeKey: "node_2",
      },
    ).state;

    expect(state.entries).toHaveLength(2);
    expect(state.entries[1].text).toBe("리셋 후 새 발언입니다");
  });
});
