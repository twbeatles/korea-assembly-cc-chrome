import {
  buildCaptureDiagnostics,
  formatCaptureDiagnosticsFramePath,
  getPersistabilityUserMessage,
  resolveCaptureSourceLabel,
} from "../src/shared/capture-diagnostics";

describe("capture diagnostics helpers", () => {
  it("resolves human-facing source labels from capture mode", () => {
    expect(resolveCaptureSourceLabel("structured", true)).toBe("structured");
    expect(resolveCaptureSourceLabel("fallback", true)).toBe("fallback");
    expect(resolveCaptureSourceLabel("fallback", false)).toBe("polling");
    expect(resolveCaptureSourceLabel("idle", false)).toBe("대기 중");
  });

  it("formats frame paths and builds immutable diagnostic snapshots", () => {
    const diagnostics = buildCaptureDiagnostics({
      captureMode: "structured",
      observerActive: true,
      currentSelector: "#viewSubtit",
      currentFramePath: [0, 2],
      persistabilityState: "persistable",
      persistabilityHint: "저장 가능한 확정 자막이 누적되고 있습니다.",
    });

    expect(formatCaptureDiagnosticsFramePath([])).toBe("top");
    expect(formatCaptureDiagnosticsFramePath([0, 2])).toBe("0 > 2");
    expect(diagnostics).toEqual({
      captureMode: "structured",
      observerActive: true,
      currentSelector: "#viewSubtit",
      currentFramePath: [0, 2],
      sourceLabel: "structured",
      persistabilityState: "persistable",
      persistabilityHint: "저장 가능한 확정 자막이 누적되고 있습니다.",
      health: "good",
      healthLabel: "좋음",
      healthHint: "자막이 안정적으로 수집되고 있습니다.",
      estimatedBytes: 0,
      sizeWarning: "",
    });
  });

  it("maps persistability states to user-facing messages", () => {
    expect(getPersistabilityUserMessage("preview_only")).toContain("확정 전");
    expect(getPersistabilityUserMessage("duplicate")).toContain("중복");
  });
});
