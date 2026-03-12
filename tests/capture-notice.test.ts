import { describe, expect, it } from "vitest";

import {
  ACTIVE_CAPTURE_NOTICE,
  FALLBACK_CAPTURE_NOTICE,
  POLLING_CAPTURE_NOTICE,
  RESET_CAPTURE_NOTICE,
  resolveCaptureNotice,
} from "../src/content/capture-notice";

describe("capture notice helper", () => {
  it("keeps structured observer capture separate from degraded capture paths", () => {
    expect(
      resolveCaptureNotice({
        captureMode: "structured",
        observerActive: true,
        hasStableRows: true,
      }),
    ).toBe(ACTIVE_CAPTURE_NOTICE);

    expect(
      resolveCaptureNotice({
        captureMode: "structured",
        observerActive: true,
        hasStableRows: false,
      }),
    ).toBe(FALLBACK_CAPTURE_NOTICE);

    expect(
      resolveCaptureNotice({
        captureMode: "fallback",
        observerActive: true,
        hasStableRows: false,
      }),
    ).toBe(FALLBACK_CAPTURE_NOTICE);

    expect(
      resolveCaptureNotice({
        captureMode: "structured",
        observerActive: false,
        hasStableRows: true,
      }),
    ).toBe(POLLING_CAPTURE_NOTICE);
  });

  it("keeps the reset copy independent from active capture notices", () => {
    expect(RESET_CAPTURE_NOTICE).not.toBe(ACTIVE_CAPTURE_NOTICE);
    expect(RESET_CAPTURE_NOTICE).not.toBe(FALLBACK_CAPTURE_NOTICE);
    expect(RESET_CAPTURE_NOTICE).not.toBe(POLLING_CAPTURE_NOTICE);
  });
});
