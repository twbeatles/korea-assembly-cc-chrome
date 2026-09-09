import { describe, expect, it } from "vitest";

import type { SubtitleEntry } from "../src/core/subtitle-models";
import {
  isStructuralEntryPatch,
  mergeCaptureEntriesWithUserEdits,
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

function buildEntry(id: string, text: string, extra: Partial<SubtitleEntry> = {}): SubtitleEntry {
  return {
    id,
    text,
    timestamp: "2026-03-10T09:00:00.000Z",
    startTime: "2026-03-10T09:00:00.000Z",
    endTime: "2026-03-10T09:00:02.000Z",
    ...extra,
  };
}

describe("mergeCaptureEntriesWithUserEdits", () => {
  it("preserves user text, highlight, and note when capture resends the same id", () => {
    const stored = [
      buildEntry("e1", "user edit", {
        originalText: "original",
        highlighted: true,
        entryNote: "user note",
        labels: ["검토"],
        speakerLabel: "위원장",
      }),
    ];
    const capture = [
      buildEntry("e1", "original", { endTime: "2026-03-10T09:00:05.000Z" }),
      buildEntry("e2", "new row"),
    ];

    const merged = mergeCaptureEntriesWithUserEdits(capture, stored);

    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({
      id: "e1",
      text: "user edit",
      originalText: "original",
      highlighted: true,
      entryNote: "user note",
      labels: ["검토"],
      speakerLabel: "위원장",
      endTime: "2026-03-10T09:00:05.000Z",
    });
    expect(merged[1]).toMatchObject({ id: "e2", text: "new row" });
  });

  it("keeps capture text when the stored row was not user-edited", () => {
    const stored = [buildEntry("e1", "stale")];
    const capture = [buildEntry("e1", "corrected live")];

    const merged = mergeCaptureEntriesWithUserEdits(capture, stored);

    expect(merged[0]?.text).toBe("corrected live");
    expect(merged[0]?.originalText).toBeUndefined();
  });

  it("does not reintroduce stored-only ids that capture no longer has", () => {
    const stored = [buildEntry("e1", "kept"), buildEntry("gone", "deleted")];
    const capture = [buildEntry("e1", "kept")];

    expect(mergeCaptureEntriesWithUserEdits(capture, stored).map((entry) => entry.id)).toEqual([
      "e1",
    ]);
  });
});

describe("isStructuralEntryPatch", () => {
  it("treats same-id overlay field changes as non-structural", () => {
    const existing = [buildEntry("e1", "original")];
    const next = [
      buildEntry("e1", "edited", {
        originalText: "original",
        highlighted: true,
        entryNote: "note",
      }),
    ];

    expect(isStructuralEntryPatch(existing, next)).toBe(false);
  });

  it("treats delete, reorder, and merge source ids as structural", () => {
    const existing = [buildEntry("e1", "a"), buildEntry("e2", "b")];

    expect(isStructuralEntryPatch(existing, [existing[0]])).toBe(true);
    expect(isStructuralEntryPatch(existing, [existing[1], existing[0]])).toBe(true);
    expect(
      isStructuralEntryPatch(existing, [
        buildEntry("merged", "ab", { sourceEntryIds: ["e1", "e2"] }),
      ]),
    ).toBe(true);
  });
});
