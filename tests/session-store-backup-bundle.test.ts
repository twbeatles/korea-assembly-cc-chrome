import { describe, expect, it, vi } from "vitest";
import type { SessionRecord } from "../src/core/subtitle-models";
import { stringifySessionBackupBundleIncrementally } from "../src/storage/session-store/backup-bundle";

function buildSession(id: string): SessionRecord {
  return {
    id,
    version: "3",
    title: "법사위",
    committeeName: "법제사법위원회",
    sourceUrl: "https://assembly.webcast.go.kr/main/player.asp",
    startedAt: "2026-03-10T09:00:00.000Z",
    endedAt: "2026-03-10T09:00:03.000Z",
    createdAt: "2026-03-10T09:00:00.000Z",
    updatedAt: "2026-03-10T09:00:03.000Z",
    subtitleCount: 1,
    charCount: 8,
    status: "saved",
    starred: false,
    pinnedAt: null,
    note: "",
    entries: [
      {
        id: `${id}_entry`,
        text: "테스트 자막",
        timestamp: "2026-03-10T09:00:00.000Z",
        startTime: "2026-03-10T09:00:00.000Z",
        endTime: "2026-03-10T09:00:02.000Z",
      },
    ],
  };
}

describe("session backup bundle", () => {
  it("hydrates each paged backup id at most once", async () => {
    const sessions = new Map([
      ["session_a", buildSession("session_a")],
      ["session_b", buildSession("session_b")],
    ]);
    const listSessionsPage = vi.fn(async ({ page }: { page: number; pageSize: number }) => {
      if (page === 1) {
        return {
          sessions: [{ id: "session_a" }, { id: "session_a" }],
          totalCount: 2,
        };
      }
      if (page === 2) {
        return {
          sessions: [{ id: "session_a" }, { id: "session_b" }],
          totalCount: 2,
        };
      }
      return {
        sessions: [],
        totalCount: 2,
      };
    });
    const loadSessionsByIds = vi.fn(async (ids: string[]) =>
      ids.map((id) => sessions.get(id)).filter((session): session is SessionRecord => Boolean(session)),
    );

    const result = await stringifySessionBackupBundleIncrementally({
      exportedAt: "2026-03-10T09:00:00.000Z",
      pageSize: 2,
      listSessionsPage,
      loadSessionsByIds,
    });

    expect(loadSessionsByIds).toHaveBeenNthCalledWith(1, ["session_a"]);
    expect(loadSessionsByIds).toHaveBeenNthCalledWith(2, ["session_b"]);
    expect(loadSessionsByIds).toHaveBeenCalledTimes(2);
    expect(JSON.parse(result.content).sessions.map((session: SessionRecord) => session.id)).toEqual([
      "session_a",
      "session_b",
    ]);
  });
});
