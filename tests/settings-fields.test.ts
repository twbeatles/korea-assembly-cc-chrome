import { describe, expect, it } from "vitest";

import type { ExtensionSettings } from "../src/storage/types";
import { EXPOSED_OPTION_FIELDS } from "../src/options/settings-fields";

describe("options settings field registry", () => {
  it("keeps every extension setting exposed through the options schema", () => {
    const expectedKeys = [
      "autoScroll",
      "keepaliveIntervalMs",
      "pollingFallbackIntervalMs",
      "maxBufferLength",
      "noiseFilterEnabled",
      "recentDuplicateMinLength",
      "filenamePattern",
      "txtExportTimestampsEnabled",
      "runningAutoSaveEnabled",
      "runningAutoSaveDebounceMs",
      "recentCopyLineCount",
      "debugLogging",
      "autoStartEnabled",
      "filterUnconfirmedEnabled",
    ] satisfies Array<keyof ExtensionSettings>;

    expect(new Set(EXPOSED_OPTION_FIELDS)).toEqual(new Set(expectedKeys));
  });
});
