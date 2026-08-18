import { describe, expect, it, vi } from "vitest";

import {
  INVALIDATION_CLEANUP_STEPS,
  runInvalidationTimerCleanup,
} from "../src/content/runtime/invalidation-shutdown";

describe("invalidation timer cleanup", () => {
  it("runs every registered clearer in a fixed order", () => {
    const calls: string[] = [];
    const clearers = {} as Parameters<typeof runInvalidationTimerCleanup>[0];
    for (const step of INVALIDATION_CLEANUP_STEPS) {
      clearers[step] = vi.fn(() => {
        calls.push(step);
      });
    }

    expect(runInvalidationTimerCleanup(clearers)).toEqual([...INVALIDATION_CLEANUP_STEPS]);
    expect(calls).toEqual([...INVALIDATION_CLEANUP_STEPS]);
    INVALIDATION_CLEANUP_STEPS.forEach((step) => {
      expect(clearers[step]).toHaveBeenCalledOnce();
    });
  });
});
