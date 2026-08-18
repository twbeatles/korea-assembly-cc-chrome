import { describe, expect, it } from "vitest";

import {
  searchRequiresEntryHydration,
  sessionMatchesMetadataFilters,
} from "../src/storage/session-store/search-helpers";

describe("session search metadata filters", () => {
  it("filters starred/tag/category without reading entries", () => {
    const session = {
      starred: true,
      tags: ["예산"],
      category: "재정",
    };

    expect(
      sessionMatchesMetadataFilters(session, {
        query: "",
        page: 1,
        pageSize: 10,
        starredOnly: true,
        tag: "예산",
        category: "재정",
      }),
    ).toBe(true);
    expect(
      sessionMatchesMetadataFilters(session, {
        query: "",
        page: 1,
        pageSize: 10,
        starredOnly: true,
        tag: "법사",
      }),
    ).toBe(false);
  });

  it("requires entry hydration only for text or highlighted search", () => {
    expect(searchRequiresEntryHydration({ highlightedOnly: false }, "")).toBe(false);
    expect(searchRequiresEntryHydration({ highlightedOnly: true }, "")).toBe(true);
    expect(searchRequiresEntryHydration({ highlightedOnly: false }, "민생")).toBe(true);
  });
});
