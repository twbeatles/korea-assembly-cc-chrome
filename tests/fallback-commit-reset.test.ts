import { afterEach, describe, expect, it, vi } from "vitest";
import type { ObserverBridgeEvent } from "../src/shared/message-types";

vi.mock(
  "../src/content/app/runtime/orchestrator/runtime-core/persistence",
  () => ({
    persistStoppedSession: vi.fn(),
    persistSessionRecord: vi.fn(),
    scheduleRunningPersist: vi.fn(),
  }),
);
vi.mock(
  "../src/content/app/runtime/orchestrator/runtime-core/panel-status",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    syncUserInterfaces: vi.fn(),
  }),
);

import { createRuntimeCoreContext } from "../src/content/app/runtime/orchestrator/runtime-core/context";
import { handleTopFrameEvent } from "../src/content/app/runtime/orchestrator/runtime-core/capture-events";

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

function generalRows(text: string): ObserverBridgeEvent {
  return {
    source: "test",
    kind: "subtitle:update",
    timestamp: Date.now(),
    sourceUrl: window.location.href,
    raw: text,
    selector: "#viewSubtit .smi_word",
    rows: [
      {
        nodeKey: "row_gen0",
        text,
        speakerColor: "",
        speakerChannel: "unknown",
        unstableKey: true,
        nodeKeySource: "generated",
      },
    ],
  };
}

function resetEvent(): ObserverBridgeEvent {
  return {
    source: "test",
    kind: "subtitle:reset",
    timestamp: Date.now(),
    sourceUrl: window.location.href,
  };
}

function runningContext() {
  const ctx = createRuntimeCoreContext();
  const time = new Date().toISOString();
  ctx.state.status = "running";
  ctx.state.startedAt = time;
  ctx.state.createdAt = time;
  return ctx;
}

describe("fallback commit gate at subtitle reset (parity commitPendingFallbackOnReset)", () => {
  it("commits the pending fallback text before the screen is cleared", () => {
    vi.useFakeTimers();
    const ctx = runningContext();

    handleTopFrameEvent(ctx, generalRows("존경하는 위원장님"));
    vi.advanceTimersByTime(400);
    vi.advanceTimersByTime(600);
    handleTopFrameEvent(
      ctx,
      generalRows("존경하는 위원장님 이상으로 질의를 마치겠습니다"),
    );
    vi.advanceTimersByTime(200);
    handleTopFrameEvent(ctx, resetEvent());
    vi.advanceTimersByTime(150);
    handleTopFrameEvent(
      ctx,
      generalRows("다음은 김철수 위원님 질의하시겠습니다"),
    );
    vi.advanceTimersByTime(400);

    const joined = ctx.state.entries.map((entry) => entry.text).join(" ");
    expect(joined).toContain("이상으로 질의를 마치겠습니다");
    expect(joined).toContain("다음은 김철수 위원님 질의하시겠습니다");
  });

  it("commits continuously changing fallback text within the max wait", () => {
    vi.useFakeTimers();
    const ctx = runningContext();
    const words: string[] = [];
    let firstCommitMs: number | null = null;
    const startedAt = Date.now();
    for (let index = 0; index < 25; index += 1) {
      words.push(`단어${index}`);
      handleTopFrameEvent(ctx, generalRows(words.join(" ")));
      vi.advanceTimersByTime(200);
      if (firstCommitMs === null && ctx.state.entries.length > 0) {
        firstCommitMs = Date.now() - startedAt;
      }
    }
    expect(firstCommitMs).not.toBeNull();
    expect(firstCommitMs!).toBeLessThanOrEqual(2200);
  });
});
