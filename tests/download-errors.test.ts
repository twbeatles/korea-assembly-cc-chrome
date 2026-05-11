import { describe, expect, it } from "vitest";

import {
  mapDownloadErrorMessage,
  resolveDownloadErrorMessage,
} from "../src/shared/download-errors";

describe("download error message mapping", () => {
  it("maps oversized runtime message failures to a friendly guidance", () => {
    expect(mapDownloadErrorMessage("Message length exceeded")).toBe(
      "내보내기 데이터가 커서 저장 요청을 전송하지 못했습니다. 범위를 나누어 다시 시도해 주세요.",
    );
    expect(mapDownloadErrorMessage("Message length exceeded", "single-session")).toContain(
      "저장된 기록",
    );
    expect(mapDownloadErrorMessage("Message length exceeded", "single-session")).toContain(
      "부분 저장",
    );
    expect(mapDownloadErrorMessage("Message length exceeded", "partial")).toBe(
      "선택한 내보내기 데이터가 커서 저장 요청을 전송하지 못했습니다. 선택 범위를 더 줄여 다시 시도해 주세요.",
    );
  });

  it("maps quota / disk full errors to a guidance message", () => {
    expect(mapDownloadErrorMessage("QuotaExceededError", "library")).toContain(
      "저장 공간",
    );
    expect(mapDownloadErrorMessage("disk full", "single-session")).toContain(
      "저장 공간",
    );
  });

  it("maps invalid data-url failures to a friendly guidance", () => {
    expect(mapDownloadErrorMessage("Invalid URL: data:text/plain;base64,...")).toBe(
      "내보내기 데이터가 너무 커서 다운로드 URL을 만들지 못했습니다. 범위를 나누어 다시 시도해 주세요.",
    );
    expect(mapDownloadErrorMessage("Invalid URL: data:text/plain;base64,...", "library")).toBe(
      "전체 백업 데이터가 너무 커서 다운로드 URL을 만들지 못했습니다. 저장된 기록을 줄인 뒤 다시 시도해 주세요.",
    );
  });

  it("maps disabled large data-url fallback failures to a friendly guidance", () => {
    expect(mapDownloadErrorMessage("Data URL fallback disabled for large export (4194304 bytes)")).toBe(
      "내보내기 데이터가 매우 커서 브라우저 fallback 다운로드로 전환할 수 없습니다. 범위를 나누거나 일부만 다시 시도해 주세요.",
    );
  });

  it("keeps unknown download errors unchanged", () => {
    expect(mapDownloadErrorMessage("some unknown error")).toBe("some unknown error");
    expect(resolveDownloadErrorMessage(new Error("unknown"), "fallback")).toBe("unknown");
    expect(resolveDownloadErrorMessage(undefined, "fallback")).toBe("fallback");
  });
});
