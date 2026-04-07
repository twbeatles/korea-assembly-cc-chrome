import { beforeEach, describe, expect, it } from "vitest";

import {
  createExtensionContextInvalidatedError,
  hasExtensionContextInvalidated,
  isExtensionContextInvalidatedError,
  markExtensionContextInvalidated,
  resetExtensionContextInvalidationForTests,
} from "../src/shared/extension-context";

describe("extension context helpers", () => {
  beforeEach(() => {
    resetExtensionContextInvalidationForTests();
  });

  it("detects stale extension context errors from chrome runtime APIs", () => {
    expect(
      isExtensionContextInvalidatedError(
        new Error("Could not establish connection. Receiving end does not exist."),
      ),
    ).toBe(true);
    expect(isExtensionContextInvalidatedError("Extension context invalidated.")).toBe(true);
  });

  it("does not classify unrelated runtime errors as invalidated contexts", () => {
    expect(isExtensionContextInvalidatedError(new Error("Background command failed"))).toBe(false);
  });

  it("tracks invalidated state and normalizes the public error", () => {
    expect(hasExtensionContextInvalidated()).toBe(false);
    expect(markExtensionContextInvalidated(new Error("Background command failed"))).toBe(false);
    expect(hasExtensionContextInvalidated()).toBe(false);

    expect(
      markExtensionContextInvalidated(
        new Error("Could not establish connection. Receiving end does not exist."),
      ),
    ).toBe(true);
    expect(hasExtensionContextInvalidated()).toBe(true);
    expect(createExtensionContextInvalidatedError().message).toBe("Extension context invalidated");
  });
});
