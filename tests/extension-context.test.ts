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
    expect(
      isExtensionContextInvalidatedError(
        new Error("Extension context invalidated."),
      ),
    ).toBe(true);
    expect(
      isExtensionContextInvalidatedError("Extension context invalidated"),
    ).toBe(true);
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
    expect(
      isExtensionContextInvalidatedError(
        new Error("Background command failed"),
      ),
    ).toBe(false);
    expect(
      isTransientExtensionMessagingError(
        new Error("Background command failed"),
      ),
    ).toBe(false);
  });

  it("extracts messages from chrome lastError-style objects", () => {
    expect(
      isExtensionContextInvalidatedError({
        message: "Extension context invalidated",
      }),
    ).toBe(true);
    expect(isExtensionContextInvalidatedError({ message: 42 })).toBe(false);
    expect(isExtensionContextInvalidatedError({ code: "NO_MESSAGE" })).toBe(
      false,
    );
  });

  it("treats empty or missing errors as neither transient nor invalidated", () => {
    expect(isExtensionContextInvalidatedError("")).toBe(false);
    expect(isExtensionContextInvalidatedError(null)).toBe(false);
    expect(isExtensionContextInvalidatedError(undefined)).toBe(false);
    expect(isTransientExtensionMessagingError("")).toBe(false);
    expect(isTransientExtensionMessagingError(null)).toBe(false);
    expect(isTransientExtensionMessagingError(undefined)).toBe(false);
    expect(markExtensionContextInvalidated()).toBe(false);
    expect(hasExtensionContextInvalidated()).toBe(false);
  });

  it("matches every documented transient port and connection phrase", () => {
    expect(
      isTransientExtensionMessagingError(
        new Error("Receiving end does not exist."),
      ),
    ).toBe(true);
    expect(
      isTransientExtensionMessagingError(
        new Error("Could not establish connection."),
      ),
    ).toBe(true);
    expect(
      isTransientExtensionMessagingError(
        new Error("The message port closed before a response was received."),
      ),
    ).toBe(true);
    expect(
      isTransientExtensionMessagingError(new Error("Message port closed.")),
    ).toBe(true);
    expect(
      isTransientExtensionMessagingError(
        new Error("Extension context invalidated"),
      ),
    ).toBe(false);
  });

  it("matches the invalidation phrase without regard to case", () => {
    expect(
      isExtensionContextInvalidatedError(
        new Error("extension context invalidated"),
      ),
    ).toBe(true);
  });

  it("short-circuits marking once the context is already invalidated", () => {
    expect(
      markExtensionContextInvalidated(
        new Error("Extension context invalidated"),
      ),
    ).toBe(true);
    expect(
      markExtensionContextInvalidated(new Error("Background command failed")),
    ).toBe(true);
    expect(hasExtensionContextInvalidated()).toBe(true);
  });

  it("tracks permanent invalidated state and normalizes the public error", () => {
    expect(hasExtensionContextInvalidated()).toBe(false);
    expect(
      markExtensionContextInvalidated(new Error("Background command failed")),
    ).toBe(false);
    expect(hasExtensionContextInvalidated()).toBe(false);

    expect(
      markExtensionContextInvalidated(
        new Error("Extension context invalidated."),
      ),
    ).toBe(true);
    expect(hasExtensionContextInvalidated()).toBe(true);
    expect(createExtensionContextInvalidatedError().message).toBe(
      "Extension context invalidated",
    );
  });
});
