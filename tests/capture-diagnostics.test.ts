import {
  buildCaptureDiagnostics,
  formatCaptureDiagnosticsFramePath,
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
      segment: {
        lineageId: "lineage_1",
        segmentNumber: 2,
        entryCount: 10,
        charCount: 120,
        elapsedMs: 1000,
        maxEntriesPerSegment: 2000,
        maxCharsPerSegment: 120000,
        maxDurationMs: 5400000,
        remainingEntries: 1990,
        remainingChars: 119880,
        remainingDurationMs: 5399000,
      },
      exportEstimates: {
        txtBytes: 120,
        srtBytes: 220,
        vttBytes: 240,
        jsonBytes: 420,
        txtIncludesTimestamps: false,
      },
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
      stableRowCount: 0,
      unstableRowCount: 0,
      filteredUnconfirmedCount: 0,
      rowKeySources: {},
      fallbackCommitState: "idle",
      segment: {
        lineageId: "lineage_1",
        segmentNumber: 2,
        entryCount: 10,
        charCount: 120,
        elapsedMs: 1000,
        maxEntriesPerSegment: 2000,
        maxCharsPerSegment: 120000,
        maxDurationMs: 5400000,
        remainingEntries: 1990,
        remainingChars: 119880,
        remainingDurationMs: 5399000,
      },
      exportEstimates: {
        txtBytes: 120,
        srtBytes: 220,
        vttBytes: 240,
        jsonBytes: 420,
        txtIncludesTimestamps: false,
      },
    });
  });
});
