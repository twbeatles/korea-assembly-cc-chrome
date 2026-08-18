import { describe, expect, it } from "vitest";

import {
  DEFAULT_SEGMENT_ROLLOVER_EVENT_QUEUE_MAX,
  SEGMENT_ROLLOVER_EVENT_QUEUE_SAFETY_MAX,
  drainSegmentEventQueue,
  enqueueBoundedSegmentEvent,
} from "../src/content/runtime/segment-event-queue";

describe("segment rollover event queue", () => {
  it("keeps a bounded FIFO queue with the newest events and reports drops", () => {
    let droppedTotal = 0;
    const queue = Array.from(
      { length: DEFAULT_SEGMENT_ROLLOVER_EVENT_QUEUE_MAX + 2 },
      (_value, index) => index + 1,
    ).reduce((current, event) => {
      const result = enqueueBoundedSegmentEvent(current, event);
      droppedTotal += result.droppedCount;
      return result.queue;
    }, [] as number[]);

    expect(queue).toHaveLength(DEFAULT_SEGMENT_ROLLOVER_EVENT_QUEUE_MAX);
    expect(queue[0]).toBe(3);
    expect(queue.at(-1)).toBe(DEFAULT_SEGMENT_ROLLOVER_EVENT_QUEUE_MAX + 2);
    expect(droppedTotal).toBe(2);
  });

  it("does not drop events at the diagnostic 128 threshold when using the safety max", () => {
    const overflowPastDiagnostic = DEFAULT_SEGMENT_ROLLOVER_EVENT_QUEUE_MAX + 40;
    let droppedTotal = 0;
    const queue = Array.from({ length: overflowPastDiagnostic }, (_value, index) => index + 1).reduce(
      (current, event) => {
        const result = enqueueBoundedSegmentEvent(
          current,
          event,
          SEGMENT_ROLLOVER_EVENT_QUEUE_SAFETY_MAX,
        );
        droppedTotal += result.droppedCount;
        return result.queue;
      },
      [] as number[],
    );

    expect(queue).toHaveLength(overflowPastDiagnostic);
    expect(droppedTotal).toBe(0);
    expect(SEGMENT_ROLLOVER_EVENT_QUEUE_SAFETY_MAX).toBeGreaterThanOrEqual(2048);
  });

  it("drains in order and preserves remaining events when replay is interrupted", () => {
    const handled: number[] = [];
    const remaining = drainSegmentEventQueue([1, 2, 3, 4], (event) => {
      handled.push(event);
      return event < 2;
    });

    expect(handled).toEqual([1, 2]);
    expect(remaining).toEqual([3, 4]);
  });
});
