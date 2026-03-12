import type { CaptureMode } from "../core/live-capture";

export const ACTIVE_CAPTURE_NOTICE = "자막을 정상적으로 수집 중입니다.";
export const FALLBACK_CAPTURE_NOTICE = "자막 행 추적이 불안정해 실시간 내용 기준으로 수집 중입니다.";
export const POLLING_CAPTURE_NOTICE = "페이지 자막 감지가 불안정해 보조 탐지로 수집 중입니다.";
export const RESET_CAPTURE_NOTICE = "자막 영역이 비워져서 내용을 다시 모으고 있습니다.";

export function resolveCaptureNotice(input: {
  captureMode: CaptureMode;
  observerActive: boolean;
  hasStableRows: boolean;
}): string {
  if (input.captureMode === "structured" && input.hasStableRows && input.observerActive) {
    return ACTIVE_CAPTURE_NOTICE;
  }

  if (!input.observerActive) {
    return POLLING_CAPTURE_NOTICE;
  }

  return FALLBACK_CAPTURE_NOTICE;
}
