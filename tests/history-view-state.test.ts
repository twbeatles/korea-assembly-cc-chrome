import { DEFAULT_EXTENSION_SETTINGS } from "../src/shared/constants";
import {
  buildDeleteAllFailureMessage,
  buildDeleteAllSuccessMessage,
  buildHistoryRefreshMessage,
  buildSessionImportMessage,
  buildSelectedDeleteMessage,
  extractHistoryViewSettings,
  resolveSelectedEntryIds,
  resolveSelectedSessionIds,
  resolveSelectedSessionId,
  selectAllEntryIds,
  selectAllSessionIds,
  toggleSelectedEntryId,
  toggleSelectedSessionId,
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

  it("keeps only still-existing checked ids and toggles selection cleanly", () => {
    expect(
      resolveSelectedSessionIds(["session_1", "session_3"], [
        { id: "session_1" },
        { id: "session_2" },
      ]),
    ).toEqual(["session_1"]);

    expect(toggleSelectedSessionId(["session_1"], "session_2")).toEqual([
      "session_1",
      "session_2",
    ]);
    expect(toggleSelectedSessionId(["session_1", "session_2"], "session_1")).toEqual([
      "session_2",
    ]);
    expect(selectAllSessionIds([{ id: "session_1" }, { id: "session_2" }])).toEqual([
      "session_1",
      "session_2",
    ]);
  });

  it("keeps entry selection across search changes and supports select-all helpers", () => {
    expect(
      resolveSelectedEntryIds(["entry_1", "entry_3"], [{ id: "entry_1" }, { id: "entry_2" }]),
    ).toEqual(["entry_1"]);

    expect(toggleSelectedEntryId(["entry_1"], "entry_2")).toEqual(["entry_1", "entry_2"]);
    expect(toggleSelectedEntryId(["entry_1", "entry_2"], "entry_1")).toEqual(["entry_2"]);
    expect(selectAllEntryIds([{ id: "entry_1" }, { id: "entry_2" }])).toEqual([
      "entry_1",
      "entry_2",
    ]);
  });

  it("builds refresh and deletion status messages without losing action context", () => {
    expect(buildHistoryRefreshMessage(3)).toBe("최신 기록부터 보여주고 있습니다.");
    expect(buildHistoryRefreshMessage(0)).toBe("저장된 기록이 없습니다.");

    expect(buildSelectedDeleteMessage(3, 3, 0)).toBe("선택한 기록 3건을 삭제했습니다.");
    expect(buildSelectedDeleteMessage(3, 2, 1)).toBe(
      "선택한 기록 2건을 삭제했고 1건은 삭제하지 못했습니다.",
    );
    expect(buildSelectedDeleteMessage(3, 0, 3)).toBe("선택한 기록 3건을 삭제하지 못했습니다.");

    expect(buildDeleteAllSuccessMessage(12)).toBe("저장된 기록 12건을 모두 삭제했습니다.");
    expect(buildDeleteAllFailureMessage()).toBe(
      "저장된 기록 전체 삭제를 완료하지 못했습니다. 남은 기록을 다시 확인해주세요.",
    );
    expect(
      buildSessionImportMessage({
        addedCount: 2,
        updatedCount: 1,
        keptCount: 3,
        failedCount: 1,
        invalidCount: 4,
      }),
    ).toBe("JSON 가져오기를 완료했습니다. 추가 2건 / 갱신 1건 / 유지 3건 / 실패 1건 / 무효 4건");
  });
});
