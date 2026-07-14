import { afterEach, describe, expect, it, vi } from "vitest";

import { createUrlReconcileController } from "../src/content/runtime/url-reconcile";

describe("url reconcile controller", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("commits lastKnownUrl only after successful reconcile", async () => {
    const controller = createUrlReconcileController("https://example.com/a");
    let attempts = 0;

    await expect(
      controller.runNow("https://example.com/b", async () => {
        attempts += 1;
        throw new Error("stop failed");
      }),
    ).rejects.toThrow("stop failed");

    expect(attempts).toBe(1);
    expect(controller.getLastKnownUrl()).toBe("https://example.com/a");

    await controller.runNow("https://example.com/b", async () => {
      attempts += 1;
    });

    expect(attempts).toBe(2);
    expect(controller.getLastKnownUrl()).toBe("https://example.com/b");
  });

  it("coalesces scheduled reconciles to the latest URL", async () => {
    vi.useFakeTimers();
    const controller = createUrlReconcileController("https://example.com/a");
    const seen: string[] = [];

    controller.schedule(
      () => "https://example.com/b",
      async (url) => {
        seen.push(url);
      },
    );
    controller.schedule(
      () => "https://example.com/c",
      async (url) => {
        seen.push(url);
      },
    );

    await vi.runAllTimersAsync();
    // 첫 틱에서 최신 pending URL 하나만 처리
    expect(seen.at(-1)).toBe("https://example.com/c");
    expect(controller.getLastKnownUrl()).toBe("https://example.com/c");
  });
});
