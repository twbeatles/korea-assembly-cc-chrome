import { describe, expect, it } from "vitest";

import {
  enqueueSessionWrite,
  resetSessionWriteQueuesForTests,
} from "../src/storage/session-write-queue";

describe("session write queue", () => {
  it("serializes writes for the same session id", async () => {
    resetSessionWriteQueuesForTests();
    const order: number[] = [];

    const first = enqueueSessionWrite("session_a", async () => {
      order.push(1);
      await new Promise((resolve) => setTimeout(resolve, 15));
      order.push(2);
      return "a";
    });
    const second = enqueueSessionWrite("session_a", async () => {
      order.push(3);
      return "b";
    });

    await expect(Promise.all([first, second])).resolves.toEqual(["a", "b"]);
    expect(order).toEqual([1, 2, 3]);
  });
});
