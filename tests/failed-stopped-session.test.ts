import type { SessionRecord } from "../src/core/subtitle-models";
import {
  createEmptyFailedStoppedSessionGuard,
  rememberFailedStoppedSession,
  resolveFailedStoppedSessionGuard,
} from "../src/content/failed-stopped-session";

function buildStoppedRecord(id = "session_failed"): SessionRecord {
  return {
    id,
    version: "2",
    title: "정무위",
    committeeName: "정무위원회",
    sourceUrl: "https://assembly.webcast.go.kr/main/player.asp",
    startedAt: "2026-03-10T09:00:00.000Z",
    endedAt: "2026-03-10T09:10:00.000Z",
    createdAt: "2026-03-10T09:00:00.000Z",
    updatedAt: "2026-03-10T09:10:00.000Z",
    subtitleCount: 1,
    charCount: 6,
    status: "stopped",
    entries: [
      {
        id: `${id}_entry_1`,
        text: "테스트 자막",
        timestamp: "2026-03-10T09:00:01.000Z",
        startTime: "2026-03-10T09:00:01.000Z",
        endTime: "2026-03-10T09:00:03.000Z",
      },
    ],
  };
}

describe("failed stopped session guard", () => {
  it("retries and clears the guard when the retry succeeds", async () => {
    const guard = rememberFailedStoppedSession(buildStoppedRecord(), new Error("초기 저장 실패"));

    const result = await resolveFailedStoppedSessionGuard({
      actionLabel: "새 수집 시작",
      guard,
      persistRecord: async (record) => ({
        ...record,
        updatedAt: "2026-03-10T09:10:05.000Z",
      }),
      confirmDiscard: () => true,
    });

    expect(result.proceed).toBe(true);
    expect(result.guard.record).toBeNull();
    expect(result.persistedRecord?.updatedAt).toBe("2026-03-10T09:10:05.000Z");
    expect(result.notice).toBe("이전 저장 실패 세션을 다시 저장했습니다.");
  });

  it("keeps the guard when retry fails and discard is cancelled", async () => {
    const guard = rememberFailedStoppedSession(buildStoppedRecord(), new Error("초기 저장 실패"));
    const confirmDiscard = vi.fn().mockReturnValue(false);

    const result = await resolveFailedStoppedSessionGuard({
      actionLabel: "화면 비우기",
      guard,
      persistRecord: async () => {
        throw new Error("재시도 실패");
      },
      confirmDiscard,
    });

    expect(result.proceed).toBe(false);
    expect(result.guard.record?.id).toBe("session_failed");
    expect(result.guard.errorMessage).toBe("재시도 실패");
    expect(confirmDiscard).toHaveBeenCalledOnce();
    expect(confirmDiscard.mock.calls[0][0]).toContain("저장되지 않은 자막이 버려지고 화면 비우기를 진행합니다.");
    expect(result.notice).toBe("저장 실패한 이전 세션을 유지했습니다.");
  });

  it("clears the guard when retry fails and discard is confirmed", async () => {
    const result = await resolveFailedStoppedSessionGuard({
      actionLabel: "새 수집 시작",
      guard: rememberFailedStoppedSession(buildStoppedRecord("session_discard"), "저장 실패"),
      persistRecord: async () => {
        throw new Error("재시도 실패");
      },
      confirmDiscard: () => true,
    });

    expect(result.proceed).toBe(true);
    expect(result.guard).toEqual(createEmptyFailedStoppedSessionGuard());
    expect(result.notice).toBe("저장 실패한 이전 세션을 버리고 계속합니다.");
  });
});
