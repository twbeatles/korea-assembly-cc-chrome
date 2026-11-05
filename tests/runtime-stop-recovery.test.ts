import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionRecord } from "../src/core/subtitle-models";
import type { ObserverBridgeEvent } from "../src/shared/message-types";

const persistence = vi.hoisted(() => ({
  persistStoppedSession: vi.fn(),
  persistSessionRecord: vi.fn(() => new Promise<SessionRecord>(() => {})),
  scheduleRunningPersist: vi.fn(),
}));
vi.mock(
  "../src/content/app/runtime/orchestrator/runtime-core/persistence",
  () => persistence,
);
vi.mock(
  "../src/content/app/runtime/orchestrator/runtime-core/ownership",
  () => ({
    releaseCaptureOwnershipForStop: vi.fn(),
  }),
);
vi.mock(
  "../src/content/app/runtime/orchestrator/runtime-core/panel-status",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    syncUserInterfaces: vi.fn(),
  }),
);
import { createRuntimeCoreContext } from "../src/content/app/runtime/orchestrator/runtime-core/context";
import { stopCaptureUnlocked } from "../src/content/app/runtime/orchestrator/runtime-core/session-lifecycle";

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("stop during pending segment rollover", () => {
  it("drains every confirmed event without starting another rollover", async () => {
    vi.useFakeTimers();
    const ctx = createRuntimeCoreContext();
    const now = Date.now();
    const time = new Date(now).toISOString();
    ctx.settings.segmentPreset = "custom";
    ctx.settings.maxEntriesPerSegment = 100;
    ctx.state.status = "running";
    ctx.state.startedAt = time;
    ctx.state.createdAt = time;
    ctx.state.entries = Array.from({ length: 100 }, (_, index) => ({
      id: `existing_${index}`,
      text: `기존 발언 ${index}`,
      timestamp: time,
      startTime: time,
      endTime: time,
      sourceCaptureMode: "structured" as const,
    }));
    const event = (text: string, key: string): ObserverBridgeEvent => ({
      source: "test",
      kind: "subtitle:update",
      timestamp: now,
      sourceUrl: window.location.href,
      raw: text,
      rows: [
        {
          nodeKey: key,
          text,
          speakerColor: "",
          speakerChannel: "unknown",
          unstableKey: false,
          nodeKeySource: "class",
        },
      ],
    });
    ctx.segmentRolloverInFlight = true;
    ctx.queuedSegmentRolloverEvents = [
      event("첫 대기 발언입니다", "first"),
      event("두 번째 대기 발언입니다", "second"),
    ];
    await stopCaptureUnlocked(ctx);
    expect(ctx.queuedSegmentRolloverEvents).toHaveLength(0);
    expect(ctx.state.entries.map((entry) => entry.text)).toEqual(
      expect.arrayContaining(["첫 대기 발언입니다", "두 번째 대기 발언입니다"]),
    );
    expect(ctx.state.status).toBe("stopped");
    expect(persistence.persistSessionRecord).not.toHaveBeenCalled();
    expect(persistence.persistStoppedSession).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        entries: expect.arrayContaining([
          expect.objectContaining({ text: "두 번째 대기 발언입니다" }),
        ]),
      }),
    );
  });
});
