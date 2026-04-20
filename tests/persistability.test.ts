import { describe, expect, it } from "vitest";

import {
  buildPersistabilityDiagnostics,
  resolvePersistabilityHint,
  resolvePreviewPersistabilityState,
} from "../src/content/persistability";

describe("persistability helpers", () => {
  it("maps persistability states to user-facing hints", () => {
    expect(resolvePersistabilityHint("idle")).toBe("화면 자막을 기다리고 있습니다.");
    expect(resolvePersistabilityHint("persistable")).toBe(
      "저장 가능한 확정 자막이 누적되고 있습니다.",
    );
    expect(resolvePersistabilityHint("preview_only")).toBe(
      "화면에는 자막이 보이지만 아직 저장 가능한 확정 자막은 없습니다.",
    );
  });

  it("derives preview-only states from preview pipeline reasons", () => {
    expect(resolvePreviewPersistabilityState("preview_history_duplicate")).toBe("duplicate");
    expect(resolvePreviewPersistabilityState("preview_filtered")).toBe("filtered");
    expect(resolvePreviewPersistabilityState("preview_suffix")).toBe("preview_only");
    expect(buildPersistabilityDiagnostics("unstable_only")).toEqual({
      state: "unstable_only",
      hint: "현재 감지된 자막 행이 아직 확정되지 않아 저장하지 않고 있습니다.",
    });
  });
});
