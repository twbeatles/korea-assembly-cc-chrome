import type { CaptureStatus } from "../../core/subtitle-models";

export const DUPLICATE_START_CAPTURE_NOTICE = "자막 모으기가 이미 실행 중입니다.";

export function shouldIgnoreStartCapture(status: CaptureStatus): boolean {
  return status === "running";
}

/**
 * URL reconcile 이 예약한 start 가 실행될 때,
 * 예약 당시 URL 과 현재 주소가 다르면 시작하지 않는다.
 */
export function shouldRunDeferredCaptureStart(options: {
  requestedUrl: string;
  currentUrl: string;
  isCapturePage: boolean;
}): boolean {
  return (
    options.isCapturePage &&
    options.requestedUrl.length > 0 &&
    options.requestedUrl === options.currentUrl
  );
}
