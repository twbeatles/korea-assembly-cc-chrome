import { DEFAULT_EXTENSION_SETTINGS } from "../src/shared/constants";
import {
  extractHistoryViewSettings,
  resolveSelectedSessionId,
} from "../src/history/history-view-state";

describe("history view state helpers", () => {
  it("keeps the current selection only when the session still exists", () => {
    expect(
      resolveSelectedSessionId("session_2", [{ id: "session_1" }, { id: "session_2" }]),
    ).toBe("session_2");
    expect(
      resolveSelectedSessionId("session_missing", [{ id: "session_1" }, { id: "session_2" }]),
    ).toBe("session_1");
    expect(resolveSelectedSessionId("session_missing", [])).toBe("");
  });

  it("extracts and sanitizes history-facing settings from storage values", () => {
    expect(
      extractHistoryViewSettings({
        recentCopyLineCount: 9,
        filenamePattern: "{committee}_{date}",
      }),
    ).toEqual({
      recentCopyLineCount: 9,
      filenamePattern: "{committee}_{date}",
    });

    expect(
      extractHistoryViewSettings({
        recentCopyLineCount: 0,
        filenamePattern: "",
      }),
    ).toEqual({
      recentCopyLineCount: DEFAULT_EXTENSION_SETTINGS.recentCopyLineCount,
      filenamePattern: DEFAULT_EXTENSION_SETTINGS.filenamePattern,
    });
  });
});
