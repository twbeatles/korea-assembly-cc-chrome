import { describe, expect, it } from "vitest";

import { createEmptySessionState } from "../src/core/subtitle-models";
import { DEFAULT_EXTENSION_SETTINGS } from "../src/shared/constants";
import { formatPreviewForDisplay, resolveLivePreviewText } from "../src/content/runtime/preview";
import {
  buildRolledOverRunningSessionState,
  buildSegmentRolloverNotice,
} from "../src/content/runtime/segment-rollover";
import {
  buildPreparedSessionRecord,
  buildVisibleSessionState,
} from "../src/content/runtime/session-records";
import {
  buildContentStatusSnapshot,
  canClearCurrentSessionState,
  resolveContentPersistabilityDiagnostics,
} from "../src/content/runtime/status-snapshot";

function buildState() {
  const state = createEmptySessionState(
    "https://assembly.webcast.go.kr/main/player.asp",
    "정무위원회",
    "정무위원회",
  );
  state.sessionId = "session_runtime";
  state.status = "running";
  state.startedAt = "2026-03-10T09:00:00.000Z";
  state.createdAt = "2026-03-10T09:00:00.000Z";
  state.updatedAt = "2026-03-10T09:00:05.000Z";
  state.currentSelector = ".subtitle";
  state.currentFramePath = [0, 1];
  state.observerActive = true;
  state.entries = [
    {
      id: "entry_1",
      text: "첫 번째 줄",
      timestamp: "2026-03-10T09:00:01.000Z",
      startTime: "2026-03-10T09:00:01.000Z",
      endTime: "2026-03-10T09:00:02.000Z",
    },
  ];
  return state;
}

describe("content runtime helpers", () => {
  it("resolves and formats live preview text", () => {
    expect(resolveLivePreviewText("관찰 중", "기존 상태")).toBe("관찰 중");
    expect(resolveLivePreviewText("", "기존 상태")).toBe("기존 상태");
    expect(formatPreviewForDisplay("  안녕\n", "structured")).toBe("안녕");
  });

  it("builds a visible session state without mutating original entries", () => {
    const state = buildState();

    const visible = buildVisibleSessionState(state, "실시간 미리보기");

    expect(visible.previewText).toBe("실시간 미리보기");
    expect(visible.lastObservedRaw).toBe("실시간 미리보기");
    expect(visible.entries).toEqual(state.entries);
    expect(visible.entries).not.toBe(state.entries);
    expect(visible.entries[0]).not.toBe(state.entries[0]);
  });

  it("builds a stopped prepared session record with finalized timestamps", () => {
    const state = buildState();

    const record = buildPreparedSessionRecord(
      state,
      DEFAULT_EXTENSION_SETTINGS,
      "stopped",
      Date.parse("2026-03-10T09:00:07.000Z"),
    );

    expect(record.status).toBe("stopped");
    expect(record.entries).toHaveLength(1);
    expect(record.endedAt).toBe("2026-03-10T09:00:07.000Z");
    expect(record.subtitleCount).toBe(1);
  });

  it("derives persistability and status snapshot data from runtime state", () => {
    const state = buildState();

    const persistability = resolveContentPersistabilityDiagnostics({
      status: state.status,
      entryCount: state.entries.length,
      livePreviewText: "",
      latestPersistabilityState: "duplicate",
    });
    const snapshot = buildContentStatusSnapshot({
      currentUrl: "https://assembly.webcast.go.kr/main/player.asp",
      sessionState: state,
      settings: DEFAULT_EXTENSION_SETTINGS,
      captureMode: "structured",
      livePreviewTextRaw: "실시간",
      livePreviewTextForDisplay: "실시간",
      latestPersistabilityState: "duplicate",
    });
    const diagnosticsSnapshot = buildContentStatusSnapshot({
      currentUrl: "https://assembly.webcast.go.kr/main/player.asp",
      sessionState: state,
      settings: DEFAULT_EXTENSION_SETTINGS,
      captureMode: "structured",
      livePreviewTextRaw: "실시간",
      livePreviewTextForDisplay: "실시간",
      latestPersistabilityState: "duplicate",
      includeExportEstimates: true,
    });

    expect(persistability.state).toBe("duplicate");
    expect(snapshot.connected).toBe(true);
    expect(snapshot.subtitleCount).toBe(1);
    expect(snapshot.charCount).toBe("첫 번째 줄".length);
    expect(snapshot.previewText).toBe("실시간");
    expect(snapshot.diagnostics.persistabilityState).toBe("duplicate");
    expect(snapshot.diagnostics.segment?.maxEntriesPerSegment).toBe(
      DEFAULT_EXTENSION_SETTINGS.maxEntriesPerSegment,
    );
    expect(snapshot.diagnostics.exportEstimates).toBeUndefined();
    expect(diagnosticsSnapshot.diagnostics.exportEstimates?.jsonBytes).toBeGreaterThan(0);
  });

  it("keeps clear-session availability rules isolated from UI orchestration", () => {
    expect(
      canClearCurrentSessionState({
        status: "idle",
        entryCount: 0,
        livePreviewText: "",
        showNotice: false,
      }),
    ).toBe(false);

    expect(
      canClearCurrentSessionState({
        status: "idle",
        entryCount: 0,
        livePreviewText: "미리보기 있음",
        showNotice: false,
      }),
    ).toBe(true);
  });

  it("builds the next running segment state while preserving dedupe/runtime markers", () => {
    const state = buildState();
    state.lineageId = "lineage_runtime";
    state.segmentNumber = 1;
    state.confirmedCompact = "누적기록";
    state.trailingSuffix = "기록";
    state.lastObservedRaw = "실시간 원문";
    state.lastProcessedRaw = "처리된 원문";

    const nextState = buildRolledOverRunningSessionState(state, {
      sourceUrl: state.sourceUrl,
      title: state.title,
      committeeName: state.committeeName,
      nowIso: "2026-03-10T09:30:00.000Z",
    });

    expect(nextState.sessionId).not.toBe(state.sessionId);
    expect(nextState.lineageId).toBe("lineage_runtime");
    expect(nextState.segmentNumber).toBe(2);
    expect(nextState.entries).toEqual([]);
    expect(nextState.confirmedCompact).toBe("누적기록");
    expect(nextState.trailingSuffix).toBe("기록");
    expect(nextState.lastObservedRaw).toBe("실시간 원문");
    expect(nextState.lastProcessedRaw).toBe("처리된 원문");
  });

  it("formats rollout notices by boundary reason", () => {
    expect(buildSegmentRolloverNotice(2, "entry_limit")).toContain("세그먼트 2");
    expect(buildSegmentRolloverNotice(3, "duration_limit")).toContain("장시간 수집 안정성");
  });
});
