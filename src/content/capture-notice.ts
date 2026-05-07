import type { CaptureMode } from "../core/live-capture";

export const ACTIVE_CAPTURE_NOTICE = "자막을 정상적으로 수집 중입니다.";
export const FALLBACK_CAPTURE_NOTICE =
  "실시간 자막을 수집 중입니다. 화면 변화에 맞춰 내용을 자동으로 이어서 정리하고 있습니다.";
export const POLLING_CAPTURE_NOTICE =
  "실시간 자막을 수집 중입니다. 감지 경로를 자동으로 조정하고 있습니다.";
export const RESET_CAPTURE_NOTICE = "자막 영역이 비워져서 내용을 다시 모으고 있습니다.";
export const UNCONFIRMED_STALL_HINT_NOTICE =
  "자막이 일시적으로 잡히지 않습니다. 페이지가 인식 중이거나 자막 레이어가 잠시 비어 있을 수 있습니다.";
export const UNCONFIRMED_STALL_HINT_THRESHOLD = 3;

export function resolveCaptureNotice(input: {
  captureMode: CaptureMode;
  observerActive: boolean;
  hasStableRows: boolean;
  isResetting?: boolean;
}): string {
  if (input.isResetting) {
    return RESET_CAPTURE_NOTICE;
  }

  if (input.captureMode === "structured" && input.hasStableRows && input.observerActive) {
    return ACTIVE_CAPTURE_NOTICE;
  }

  if (!input.observerActive) {
    return POLLING_CAPTURE_NOTICE;
  }

  return FALLBACK_CAPTURE_NOTICE;
}
