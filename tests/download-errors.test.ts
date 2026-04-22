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
  });

  it("maps invalid data-url failures to a friendly guidance", () => {
    expect(mapDownloadErrorMessage("Invalid URL: data:text/plain;base64,...")).toBe(
      "내보내기 데이터가 너무 커서 다운로드 URL을 만들지 못했습니다. 범위를 나누어 다시 시도해 주세요.",
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
