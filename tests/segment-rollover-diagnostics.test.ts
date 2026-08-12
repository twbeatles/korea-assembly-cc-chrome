import { describe, expect, it } from "vitest";

import { buildSegmentRolloverDiagnostics } from "../src/content/runtime/segment-rollover-diagnostics";
import {
  DEFAULT_SEGMENT_ROLLOVER_EVENT_QUEUE_MAX,
  enqueueBoundedSegmentEvent,
} from "../src/content/runtime/segment-event-queue";

describe("segment rollover diagnostics and queue capacity", () => {
  it("builds a non-negative diagnostics snapshot", () => {
    expect(
      buildSegmentRolloverDiagnostics({
        inFlight: true,
        queueSize: 4.7,
        queueMax: DEFAULT_SEGMENT_ROLLOVER_EVENT_QUEUE_MAX,
        droppedTotal: -1,
      }),
    ).toEqual({
      inFlight: true,
      queueSize: 4,
      queueMax: DEFAULT_SEGMENT_ROLLOVER_EVENT_QUEUE_MAX,
      droppedTotal: 0,
    });
  });

  it("keeps at least 128 events before dropping (audit M1 capacity)", () => {
    expect(DEFAULT_SEGMENT_ROLLOVER_EVENT_QUEUE_MAX).toBeGreaterThanOrEqual(128);

    let queue: number[] = [];
    let dropped = 0;
    for (let i = 0; i < DEFAULT_SEGMENT_ROLLOVER_EVENT_QUEUE_MAX + 5; i += 1) {
      const result = enqueueBoundedSegmentEvent(queue, i);
      queue = result.queue;
      dropped += result.droppedCount;
    }
    expect(queue).toHaveLength(DEFAULT_SEGMENT_ROLLOVER_EVENT_QUEUE_MAX);
    expect(dropped).toBe(5);
  });
});
