import { describe, expect, it } from "vitest";

import {
  HIDDEN_TAB_POLLING_MULTIPLIER,
  resolvePollingIntervalMs,
} from "../src/content/runtime/visibility-polling";

describe("visibility polling interval", () => {
  it("keeps the base interval when the tab is visible", () => {
    expect(resolvePollingIntervalMs(200, "visible")).toBe(200);
    expect(resolvePollingIntervalMs(200, undefined)).toBe(200);
  });

  it("slows polling when the tab is hidden", () => {
    expect(resolvePollingIntervalMs(200, "hidden")).toBe(
      200 * HIDDEN_TAB_POLLING_MULTIPLIER,
    );
  });

  it("enforces a minimum base interval", () => {
    expect(resolvePollingIntervalMs(10, "visible")).toBe(50);
    expect(resolvePollingIntervalMs(10, "hidden")).toBe(50 * HIDDEN_TAB_POLLING_MULTIPLIER);
  });
});
