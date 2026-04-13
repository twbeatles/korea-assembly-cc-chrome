import { describe, expect, it } from "vitest";

import {
  analyzeCaptureCommit,
  shouldCommitCaptureEvent,
} from "../src/content/subtitle-event-handler";

describe("subtitle event handler", () => {
  it("commits structured events when at least one stable row is present", () => {
    const stableRow = {
      nodeKey: "class:row_1",
      text: "확정 자막",
      speakerColor: "rgb(35, 124, 147)",
      speakerChannel: "primary" as const,
      unstableKey: false,
    };
    const unstableRow = {
      nodeKey: "row_generated",
      text: "인식 중 자막",
      speakerColor: "rgb(35, 124, 147)",
      speakerChannel: "primary" as const,
      unstableKey: true,
    };

    expect(
      analyzeCaptureCommit({
        captureMode: "structured",
        previewText: "확정 자막 인식 중 자막",
        rows: [stableRow, unstableRow],
      }),
    ).toEqual({
      previewText: "확정 자막 인식 중 자막",
      stableRows: [stableRow],
      hasUnstableRows: true,
      shouldCommit: true,
    });

    expect(
      shouldCommitCaptureEvent({
        captureMode: "structured",
        rows: [stableRow],
      }),
    ).toBe(true);

    expect(
      shouldCommitCaptureEvent({
        captureMode: "structured",
        rows: [stableRow, unstableRow],
      }),
    ).toBe(true);

    expect(
      shouldCommitCaptureEvent({
        captureMode: "fallback",
        rows: [],
      }),
    ).toBe(false);
  });

  it("keeps all-unstable structured events in preview-only mode", () => {
    expect(
      analyzeCaptureCommit({
        captureMode: "structured",
        previewText: "인식 중 자막",
        rows: [
          {
            nodeKey: "row_generated",
            text: "인식 중 자막",
            speakerColor: "rgb(35, 124, 147)",
            speakerChannel: "primary",
            unstableKey: true,
          },
        ],
      }),
    ).toEqual({
      previewText: "인식 중 자막",
      stableRows: [],
      hasUnstableRows: true,
      shouldCommit: false,
    });
  });
});
