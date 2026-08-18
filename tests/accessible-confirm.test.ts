import { describe, expect, it, vi } from "vitest";

import { confirmDestructiveAction } from "../src/shared/accessible-confirm";

describe("accessible confirm", () => {
  it("uses window.confirm in the unit-test environment", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    await expect(confirmDestructiveAction("지울까요?")).resolves.toBe(false);
    expect(confirmSpy).toHaveBeenCalledWith("지울까요?");
    confirmSpy.mockRestore();
  });
});
