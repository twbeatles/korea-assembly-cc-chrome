import { describe, expect, it } from "vitest";
import {
  applyStructuredEntry,
  applyKeepalive,
  finalizeSession,
} from "../src/core/subtitle-pipeline";
import { createEmptySessionState } from "../src/core/subtitle-models";

describe("simplified subtitle pipeline", () => {
  it("appends new entries and ignores duplicated ones", () => {
    let state = createEmptySessionState("http://test.com", "Test");
    const now = Date.now();

    // 1. Initial entry
    let result = applyStructuredEntry(state, "첫 번째 문장", "첫 번째 문장", now, undefined, { sourceNodeKey: "node-1" });
    expect(result.changed).toBe(true);
    expect(result.state.entries).toHaveLength(1);
    expect(result.state.entries[0].text).toBe("첫 번째 문장");

    // 2. Same text, same node key -> ignored
    result = applyStructuredEntry(result.state, "첫 번째 문장", "첫 번째 문장", now + 1000, undefined, { sourceNodeKey: "node-1" });
    const result2 = applyStructuredEntry(result.state, "첫 번째 문장", "첫 번째 문장", now + 2000, undefined, { sourceNodeKey: "node-1" });
    expect(result2.changed).toBe(false);
    expect(result2.state.entries).toHaveLength(1);

    // 3. Different text, same node key -> merged/replaced
    const result3 = applyStructuredEntry(result2.state, "첫 번째 문장 수정", "첫 번째 문장 수정", now + 3000, undefined, { sourceNodeKey: "node-1" });
    expect(result3.changed).toBe(true);
    expect(result3.state.entries).toHaveLength(1);
    expect(result3.state.entries[0].text).toBe("첫 번째 문장 수정");

    // 4. Force new entry
    const result4 = applyStructuredEntry(result3.state, "두 번째 문장", "두 번째 문장", now + 4000, undefined, { forceNewEntry: true });
    expect(result4.changed).toBe(true);
    expect(result4.state.entries).toHaveLength(2);
    expect(result4.state.entries[1].text).toBe("두 번째 문장");
  });

  it("finalizes session properly", () => {
    let state = createEmptySessionState("http://test.com", "Test");
    const now = Date.now();
    const result = applyStructuredEntry(state, "완료될 문장", "완료될 문장", now);

    const finalized = finalizeSession(result.state, now + 5000);
    expect(finalized.state.status).toBe("stopped");
    expect(finalized.state.entries[0].endTime).toBeTruthy();
  });
});
