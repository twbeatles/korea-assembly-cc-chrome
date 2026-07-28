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

  it("queues fire-and-forget start after an in-flight reconcile without interleaving", async () => {
    const lock = createCaptureLifecycleLock();
    const order: string[] = [];

    const reconcile = lock.run("reconcile", async () => {
      order.push("reconcile-begin");
      // auto-start 패턴: 잠금 안에서 unlocked 직접 호출 대신 큐에 start 예약
      void lock.run("start", async () => {
        order.push("start");
      });
      await new Promise((resolve) => setTimeout(resolve, 15));
      order.push("reconcile-end");
    });

    await reconcile;
    await lock.run("stop", async () => {
      order.push("stop");
    });

    expect(order).toEqual(["reconcile-begin", "reconcile-end", "start", "stop"]);
  });
});