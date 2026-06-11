import type { CaptureStatus } from "../../core/subtitle-models";

export const DUPLICATE_START_CAPTURE_NOTICE = "자막 모으기가 이미 실행 중입니다.";

export function shouldIgnoreStartCapture(status: CaptureStatus): boolean {
  return status === "running";
}
