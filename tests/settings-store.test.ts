import { DEFAULT_EXTENSION_SETTINGS } from "../src/shared/constants";
import { sanitizeSettings } from "../src/storage/settings-store";

describe("settings store", () => {
  it("sanitizes new autosave, copy, and segmentation settings", () => {
    const sanitized = sanitizeSettings({
      runningAutoSaveEnabled: false,
      runningAutoSaveDebounceMs: 1200,
      recentCopyLineCount: 9,
      maxEntriesPerSegment: 2500,
      maxCharsPerSegment: 150000,
      maxSegmentDurationMinutes: 120,
      recentDuplicateMinLength: 12,
      txtExportTimestampsEnabled: true,
      txtExportSpeakerEnabled: true,
      txtExportEntryNotesEnabled: true,
      panelSpeakerHighlightEnabled: false,
      filterUnconfirmedEnabled: false,
    });

    expect(sanitized.runningAutoSaveEnabled).toBe(false);
    expect(sanitized.runningAutoSaveDebounceMs).toBe(1200);
    expect(sanitized.recentCopyLineCount).toBe(9);
    expect(sanitized.maxEntriesPerSegment).toBe(2500);
    expect(sanitized.maxCharsPerSegment).toBe(150000);
    expect(sanitized.maxSegmentDurationMinutes).toBe(120);
    expect(sanitized.recentDuplicateMinLength).toBe(12);
    expect(sanitized.txtExportTimestampsEnabled).toBe(true);
    expect(sanitized.txtExportSpeakerEnabled).toBe(true);
    expect(sanitized.txtExportEntryNotesEnabled).toBe(true);
    expect(sanitized.panelSpeakerHighlightEnabled).toBe(false);
    expect(sanitized.filterUnconfirmedEnabled).toBe(false);
  });

  it("falls back to defaults when autosave and segmentation settings are invalid", () => {
    const sanitized = sanitizeSettings({
      runningAutoSaveDebounceMs: -10,
      recentCopyLineCount: 0,
      maxEntriesPerSegment: 10,
      maxCharsPerSegment: 100,
      maxSegmentDurationMinutes: 1,
      recentDuplicateMinLength: 0,
      filenamePattern: "{date}/bad",
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
    expect(sanitized.maxEntriesPerSegment).toBe(
      DEFAULT_EXTENSION_SETTINGS.maxEntriesPerSegment,
    );
    expect(sanitized.maxCharsPerSegment).toBe(
      DEFAULT_EXTENSION_SETTINGS.maxCharsPerSegment,
    );
    expect(sanitized.maxSegmentDurationMinutes).toBe(
      DEFAULT_EXTENSION_SETTINGS.maxSegmentDurationMinutes,
    );
    expect(sanitized.recentDuplicateMinLength).toBe(
      DEFAULT_EXTENSION_SETTINGS.recentDuplicateMinLength,
    );
    expect(sanitized.filenamePattern).toBe(DEFAULT_EXTENSION_SETTINGS.filenamePattern);
    expect(sanitized.txtExportTimestampsEnabled).toBe(
      DEFAULT_EXTENSION_SETTINGS.txtExportTimestampsEnabled,
    );
    expect(sanitized.txtExportSpeakerEnabled).toBe(
      DEFAULT_EXTENSION_SETTINGS.txtExportSpeakerEnabled,
    );
    expect(sanitized.txtExportEntryNotesEnabled).toBe(
      DEFAULT_EXTENSION_SETTINGS.txtExportEntryNotesEnabled,
    );
    expect(sanitized.panelSpeakerHighlightEnabled).toBe(
      DEFAULT_EXTENSION_SETTINGS.panelSpeakerHighlightEnabled,
    );
    expect(sanitized.filterUnconfirmedEnabled).toBe(
      DEFAULT_EXTENSION_SETTINGS.filterUnconfirmedEnabled,
    );
  });

  it("falls back to defaults when numeric settings are fractional", () => {
    const sanitized = sanitizeSettings({
      runningAutoSaveDebounceMs: 800.5,
      recentCopyLineCount: 2.5,
      maxEntriesPerSegment: 2000.5,
      maxCharsPerSegment: 120000.5,
      maxSegmentDurationMinutes: 90.5,
      recentDuplicateMinLength: 8.25,
      keepaliveIntervalMs: 1000.1,
    });

    expect(sanitized.runningAutoSaveDebounceMs).toBe(
      DEFAULT_EXTENSION_SETTINGS.runningAutoSaveDebounceMs,
    );
    expect(sanitized.recentCopyLineCount).toBe(
      DEFAULT_EXTENSION_SETTINGS.recentCopyLineCount,
    );
    expect(sanitized.maxEntriesPerSegment).toBe(
      DEFAULT_EXTENSION_SETTINGS.maxEntriesPerSegment,
    );
    expect(sanitized.maxCharsPerSegment).toBe(
      DEFAULT_EXTENSION_SETTINGS.maxCharsPerSegment,
    );
    expect(sanitized.maxSegmentDurationMinutes).toBe(
      DEFAULT_EXTENSION_SETTINGS.maxSegmentDurationMinutes,
    );
    expect(sanitized.recentDuplicateMinLength).toBe(
      DEFAULT_EXTENSION_SETTINGS.recentDuplicateMinLength,
    );
    expect(sanitized.keepaliveIntervalMs).toBe(DEFAULT_EXTENSION_SETTINGS.keepaliveIntervalMs);
  });

  it("migrates legacy noiseMinLength into the new duplicate setting", () => {
    const sanitized = sanitizeSettings({
      noiseMinLength: 15,
    });

    expect(sanitized.recentDuplicateMinLength).toBe(15);
  });

  it("sanitizes presets and drops duplicate urls", () => {
    const sanitized = sanitizeSettings({
      presets: [
        {
          id: "preset_1",
          name: "법사위",
          url: "https://assembly.webcast.go.kr/main/player.asp?xcode=10",
          committeeName: "법제사법위원회",
          autoStartEnabled: false,
          noiseFilterEnabled: false,
        },
        {
          id: "preset_2",
          name: "중복",
          url: "https://assembly.webcast.go.kr/main/player.asp?xcode=10",
          committeeName: "",
          autoStartEnabled: true,
          noiseFilterEnabled: true,
        },
        {
          id: "preset_3",
          name: "외부",
          url: "https://example.com",
          committeeName: "",
          autoStartEnabled: true,
          noiseFilterEnabled: true,
        },
      ],
    });

    expect(sanitized.presets).toHaveLength(1);
    expect(sanitized.presets[0]).toMatchObject({
      id: "preset_1",
      name: "법사위",
      committeeName: "법제사법위원회",
      autoStartEnabled: false,
      noiseFilterEnabled: false,
    });
  });
});
