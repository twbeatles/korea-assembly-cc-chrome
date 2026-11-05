import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ send: vi.fn(), queue: vi.fn() }));
vi.mock("../src/shared/chrome-api", () => ({ sendRuntimeMessage: mocks.send }));
vi.mock("../src/storage/persist-recovery", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  queueExitPersistRecord: mocks.queue,
}));
vi.mock("../src/content/app/runtime/orchestrator/runtime-core/notices", () => ({
  reportRuntimeError: vi.fn(),
  setPanelNotice: vi.fn(),
}));
import { createRuntimeCoreContext } from "../src/content/app/runtime/orchestrator/runtime-core/context";
import { persistStoppedSession } from "../src/content/app/runtime/orchestrator/runtime-core/persistence";
import { toSessionRecord } from "../src/core/subtitle-models";

afterEach(() => vi.resetAllMocks());
describe("failed final save durability", () => {
  it("queues a stopped snapshot while retaining the retry guard", async () => {
    const ctx = createRuntimeCoreContext();
    const time = new Date().toISOString();
    ctx.state.entries = [
      {
        id: "durable",
        text: "보존할 확정 자막",
        timestamp: time,
        startTime: time,
        endTime: time,
      },
    ];
    const record = toSessionRecord(ctx.state, "stopped");
    mocks.send.mockRejectedValue(new Error("SW unavailable"));
    await persistStoppedSession(ctx, record);
    expect(mocks.queue).toHaveBeenCalledWith(record);
    expect(JSON.stringify(ctx.failedStoppedSessionGuard)).toContain(
      "보존할 확정 자막",
    );
  });
});
