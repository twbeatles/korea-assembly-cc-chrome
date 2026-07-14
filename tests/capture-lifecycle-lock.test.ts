import { describe, expect, it } from "vitest";

import { createCaptureLifecycleLock } from "../src/content/runtime/capture-lifecycle-lock";

describe("capture lifecycle lock", () => {
  it("serializes overlapping lifecycle actions", async () => {
    const lock = createCaptureLifecycleLock();
    const order: string[] = [];

    const first = lock.run("start", async () => {
      order.push("start-begin");
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push("start-end");
      return "started";
    });

    const second = lock.run("stop", async () => {
      order.push("stop-begin");
      order.push("stop-end");
      return "stopped";
    });

    await expect(Promise.all([first, second])).resolves.toEqual(["started", "stopped"]);
    expect(order).toEqual(["start-begin", "start-end", "stop-begin", "stop-end"]);
    expect(lock.isBusy()).toBe(false);
  });

  it("keeps the queue alive after a failed action", async () => {
    const lock = createCaptureLifecycleLock();

    await expect(
      lock.run("start", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    await expect(
      lock.run("stop", async () => "ok"),
    ).resolves.toBe("ok");
  });
});
