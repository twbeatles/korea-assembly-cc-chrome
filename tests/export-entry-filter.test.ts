import { describe, expect, it } from "vitest";

import { filterEntriesByTimeRange } from "../src/core/export-entry-filter";
import type { SubtitleEntry } from "../src/core/subtitle-models";

function entry(id: string, startTime: string): SubtitleEntry {
  return {
    id,
    text: id,
    timestamp: startTime,
    startTime,
    endTime: startTime,
  };
}

describe("filterEntriesByTimeRange", () => {
  const entries = [
    entry("a", "2026-07-28T01:00:00.000Z"),
    entry("b", "2026-07-28T02:00:00.000Z"),
    entry("c", "2026-07-28T03:00:00.000Z"),
  ];

  it("returns all entries when range is empty", () => {
    expect(filterEntriesByTimeRange(entries)).toEqual(entries);
    expect(filterEntriesByTimeRange(entries, {})).toEqual(entries);
  });

  it("filters by inclusive from/to absolute timestamps", () => {
    expect(
      filterEntriesByTimeRange(entries, {
        from: "2026-07-28T01:30:00.000Z",
        to: "2026-07-28T02:30:00.000Z",
      }).map((item) => item.id),
    ).toEqual(["b"]);
  });

  it("supports open-ended ranges", () => {
    expect(
      filterEntriesByTimeRange(entries, { from: "2026-07-28T02:00:00.000Z" }).map(
        (item) => item.id,
      ),
    ).toEqual(["b", "c"]);
    expect(
      filterEntriesByTimeRange(entries, { to: "2026-07-28T01:00:00.000Z" }).map(
        (item) => item.id,
      ),
    ).toEqual(["a"]);
  });
});
