import { splitContentForBlobParts } from "../src/background/export-content";

describe("background export content helpers", () => {
  it("splits content without breaking surrogate pairs", () => {
    const parts = splitContentForBlobParts("가😀나다😀라", 3);

    expect(parts.join("")).toBe("가😀나다😀라");
    expect(parts).not.toContain("\ud83d");
    expect(parts).not.toContain("\ude00");
    expect(parts.some((part) => part.includes("😀"))).toBe(true);
  });
});
