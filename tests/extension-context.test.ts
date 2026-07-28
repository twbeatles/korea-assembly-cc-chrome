import { beforeEach, describe, expect, it } from "vitest";

import {
  createExtensionContextInvalidatedError,
  hasExtensionContextInvalidated,
  isExtensionContextInvalidatedError,
  isTransientExtensionMessagingError,
  markExtensionContextInvalidated,
  resetExtensionContextInvalidationForTests,
} from "../src/shared/extension-context";

describe("extension context helpers", () => {
  beforeEach(() => {
    resetExtensionContextInvalidationForTests();
  });

  it("detects permanent invalidated extension context errors", () => {
    expect(isExtensionContextInvalidatedError(new Error("Extension context invalidated."))).toBe(
      true,
    );
    expect(isExtensionContextInvalidatedError("Extension context invalidated")).toBe(true);
  });

  it("treats missing receiver as transient messaging failure, not permanent invalidation", () => {
    const missingReceiver = new Error(
      "Could not establish connection. Receiving end does not exist.",
    );
    expect(isTransientExtensionMessagingError(missingReceiver)).toBe(true);
    expect(isExtensionContextInvalidatedError(missingReceiver)).toBe(false);
    expect(markExtensionContextInvalidated(missingReceiver)).toBe(false);
    expect(hasExtensionContextInvalidated()).toBe(false);
  });

  it("does not classify unrelated runtime errors as invalidated contexts", () => {
    expect(isExtensionContextInvalidatedError(new Error("Background command failed"))).toBe(false);
    expect(isTransientExtensionMessagingError(new Error("Background command failed"))).toBe(
      false,
    );
  });

  it("tracks permanent invalidated state and normalizes the public error", () => {
    expect(hasExtensionContextInvalidated()).toBe(false);
    expect(markExtensionContextInvalidated(new Error("Background command failed"))).toBe(false);
    expect(hasExtensionContextInvalidated()).toBe(false);

    expect(
      markExtensionContextInvalidated(new Error("Extension context invalidated.")),
    ).toBe(true);
    expect(hasExtensionContextInvalidated()).toBe(true);
    expect(createExtensionContextInvalidatedError().message).toBe("Extension context invalidated");
  });
});
