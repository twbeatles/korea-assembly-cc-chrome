import { afterEach, describe, expect, it, vi } from "vitest";

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

  it("rejects empty session ids instead of skipping the queue", async () => {
    resetSessionWriteQueuesForTests();
    await expect(enqueueSessionWrite("", async () => "nope")).rejects.toThrow(
      "세션 id가 올바르지 않습니다.",
    );
  });

  it("allows different session ids to proceed independently", async () => {
    resetSessionWriteQueuesForTests();
    const order: string[] = [];

    const a = enqueueSessionWrite("session_a", async () => {
      order.push("a-start");
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push("a-end");
      return "a";
    });
    const b = enqueueSessionWrite("session_b", async () => {
      order.push("b");
      return "b";
    });

    await expect(Promise.all([a, b])).resolves.toEqual(["a", "b"]);
    expect(order[0]).toBe("a-start");
    expect(order).toContain("b");
    expect(order[order.length - 1]).toBe("a-end");
  });

  describe("with Web Locks", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("calls LockManager.request with the lock manager as receiver", async () => {
      resetSessionWriteQueuesForTests();
      const names: string[] = [];
      // 실제 브라우저처럼 this 가 LockManager 가 아니면 Illegal invocation 을 던진다.
      const locks = {
        request(
          this: unknown,
          name: string,
          _options: { mode: "exclusive" },
          callback: () => Promise<unknown>,
        ): Promise<unknown> {
          if (this !== locks) {
            throw new TypeError("Illegal invocation");
          }
          names.push(name);
          return callback();
        },
      };
      vi.stubGlobal("navigator", { locks });

      await expect(enqueueSessionWrite("session_a", async () => "ok")).resolves.toBe("ok");
      expect(names).toEqual(["assembly-session-write:session_a"]);
    });
  });
});
