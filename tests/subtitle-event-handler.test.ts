import { describe, expect, it } from "vitest";

import { shouldCommitCaptureEvent } from "../src/content/subtitle-event-handler";

describe("subtitle event handler", () => {
  it("commits only structured events with stable rows", () => {
    expect(
      shouldCommitCaptureEvent({
        captureMode: "structured",
        rows: [
          {
            nodeKey: "class:row_1",
            text: "확정 자막",
            speakerColor: "rgb(35, 124, 147)",
            speakerChannel: "primary",
            unstableKey: false,
          },
        ],
      }),
    ).toBe(true);

    expect(
      shouldCommitCaptureEvent({
        captureMode: "structured",
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
    ).toBe(false);

    expect(
      shouldCommitCaptureEvent({
        captureMode: "fallback",
        rows: [],
      }),
    ).toBe(false);
  });
});
