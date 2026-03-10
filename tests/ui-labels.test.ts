import { describe, expect, it } from "vitest";

import {
  getCaptureStatusLabel,
  getExportFormatLabel,
  getPersistedStatusLabel,
} from "../src/shared/ui-labels";

describe("ui labels", () => {
  it("maps capture status to easy Korean labels", () => {
    expect(getCaptureStatusLabel("idle")).toBe("준비됨");
    expect(getCaptureStatusLabel("running")).toBe("수집 중");
    expect(getCaptureStatusLabel("stopped")).toBe("잠시 멈춤");
  });

  it("maps export formats and saved status", () => {
    expect(getExportFormatLabel("txt")).toBe("텍스트(TXT)");
    expect(getExportFormatLabel("vtt")).toBe("웹자막(VTT)");
    expect(getPersistedStatusLabel("saved")).toBe("저장됨");
  });
});
