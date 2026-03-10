import { DEFAULT_EXTENSION_SETTINGS } from "../src/shared/constants";
import { sanitizeSettings } from "../src/storage/settings-store";

describe("settings store", () => {
  it("sanitizes new autosave and copy settings", () => {
    const sanitized = sanitizeSettings({
      runningAutoSaveEnabled: false,
      runningAutoSaveDebounceMs: 1200,
      recentCopyLineCount: 9,
    });

    expect(sanitized.runningAutoSaveEnabled).toBe(false);
    expect(sanitized.runningAutoSaveDebounceMs).toBe(1200);
    expect(sanitized.recentCopyLineCount).toBe(9);
  });

  it("falls back to defaults when autosave settings are invalid", () => {
    const sanitized = sanitizeSettings({
      runningAutoSaveDebounceMs: -10,
      recentCopyLineCount: 0,
    });

    expect(sanitized.runningAutoSaveEnabled).toBe(
      DEFAULT_EXTENSION_SETTINGS.runningAutoSaveEnabled,
    );
    expect(sanitized.runningAutoSaveDebounceMs).toBe(
      DEFAULT_EXTENSION_SETTINGS.runningAutoSaveDebounceMs,
    );
    expect(sanitized.recentCopyLineCount).toBe(
      DEFAULT_EXTENSION_SETTINGS.recentCopyLineCount,
    );
  });
});
