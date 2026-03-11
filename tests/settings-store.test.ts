import { DEFAULT_EXTENSION_SETTINGS } from "../src/shared/constants";
import { sanitizeSettings } from "../src/storage/settings-store";

describe("settings store", () => {
  it("sanitizes new autosave and copy settings", () => {
    const sanitized = sanitizeSettings({
      runningAutoSaveEnabled: false,
      runningAutoSaveDebounceMs: 1200,
      recentCopyLineCount: 9,
      recentDuplicateMinLength: 12,
      filterUnconfirmedEnabled: false,
    });

    expect(sanitized.runningAutoSaveEnabled).toBe(false);
    expect(sanitized.runningAutoSaveDebounceMs).toBe(1200);
    expect(sanitized.recentCopyLineCount).toBe(9);
    expect(sanitized.recentDuplicateMinLength).toBe(12);
    expect(sanitized.filterUnconfirmedEnabled).toBe(false);
  });

  it("falls back to defaults when autosave settings are invalid", () => {
    const sanitized = sanitizeSettings({
      runningAutoSaveDebounceMs: -10,
      recentCopyLineCount: 0,
      recentDuplicateMinLength: 0,
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
    expect(sanitized.recentDuplicateMinLength).toBe(
      DEFAULT_EXTENSION_SETTINGS.recentDuplicateMinLength,
    );
    expect(sanitized.filterUnconfirmedEnabled).toBe(
      DEFAULT_EXTENSION_SETTINGS.filterUnconfirmedEnabled,
    );
  });

  it("migrates legacy noiseMinLength into the new duplicate setting", () => {
    const sanitized = sanitizeSettings({
      noiseMinLength: 15,
    });

    expect(sanitized.recentDuplicateMinLength).toBe(15);
  });
});
