import { describe, expect, it } from "vitest";

import {
  normalizeSessionRecord,
  sanitizeQualityStats,
  sanitizeSessionId,
} from "../src/storage/session-store/normalize";

describe("normalizeSessionRecord hardening", () => {
  it("trims session id and rejects non-string ids", () => {
    expect(sanitizeSessionId("  session_1  ")).toBe("session_1");
    expect(sanitizeSessionId(123)).toBe("");
    expect(sanitizeSessionId(null)).toBe("");
  });

  it("drops invalid qualityStats shapes", () => {
    expect(sanitizeQualityStats({ health: "good" })).toBeUndefined();
    expect(
      sanitizeQualityStats({
        health: "good",
        entryCount: 1,
        charCount: 2,
        estimatedBytes: 3,
        lastComputedAt: "2026-03-10T09:00:00.000Z",
      }),
    ).toEqual({
      health: "good",
      entryCount: 1,
      charCount: 2,
      estimatedBytes: 3,
      fallbackOnly: undefined,
      lastComputedAt: "2026-03-10T09:00:00.000Z",
    });
  });

  it("normalizes id and qualityStats on the session record path", () => {
    const record = normalizeSessionRecord({
      id: "  sid_norm  ",
      version: "4",
      title: "t",
      committeeName: "c",
      sourceUrl: "https://assembly.webcast.go.kr/main/player.asp",
      startedAt: "2026-03-10T09:00:00.000Z",
      endedAt: "2026-03-10T09:00:01.000Z",
      createdAt: "2026-03-10T09:00:00.000Z",
      updatedAt: "2026-03-10T09:00:01.000Z",
      subtitleCount: 0,
      charCount: 0,
      status: "saved",
      qualityStats: { health: "nope" } as never,
      entries: [],
    });

    expect(record.id).toBe("sid_norm");
    expect(record.qualityStats).toBeUndefined();
    expect(record.lineageId).toBe("sid_norm");
  });
});
