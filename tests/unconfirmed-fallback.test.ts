import { describe, expect, it } from "vitest";

import {
  shouldAllowUnconfirmedContainerFallback,
  updateUnconfirmedFallbackBlockStreak,
} from "../src/content/unconfirmed-fallback";

describe("unconfirmed fallback helper", () => {
  it("allows container fallback only after six consecutive blocked probes", () => {
    expect(shouldAllowUnconfirmedContainerFallback(5)).toBe(false);
    expect(shouldAllowUnconfirmedContainerFallback(6)).toBe(true);
  });

  it("increments streak when probe is blocked by unconfirmed filtering", () => {
    expect(
      updateUnconfirmedFallbackBlockStreak(2, {
        blockedByUnconfirmedFilter: true,
        found: false,
        text: "",
      }),
    ).toBe(3);
  });

  it("resets streak immediately when a probe recovers subtitle text", () => {
    expect(
      updateUnconfirmedFallbackBlockStreak(6, {
        blockedByUnconfirmedFilter: false,
        found: true,
        text: "recovered subtitle",
      }),
    ).toBe(0);
  });

  it("keeps streak unchanged for neutral misses", () => {
    expect(
      updateUnconfirmedFallbackBlockStreak(4, {
        blockedByUnconfirmedFilter: false,
        found: false,
        text: "",
      }),
    ).toBe(4);
  });
});
