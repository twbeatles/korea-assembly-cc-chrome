import { computeCurrentFramePath } from "../../frame-probe";

export const isTopFrame = window.top === window;
export const localFramePath = computeCurrentFramePath();
export const injectedScriptId = "assembly-subtitle-observer-script";
export const DEFAULT_IN_PAGE_NOTICE =
  "페이지 오른쪽에서 수집된 자막을 바로 보고 있습니다.";
export const NON_CAPTURE_PAGE_NOTICE =
  "국회 의사중계 플레이어 페이지로 이동하면 오른쪽 패널에서 바로 자막을 모을 수 있습니다.";
export const SUBTITLE_RESET_GRACE_MS = 1000;
export const INVALIDATED_CONTEXT_NOTICE =
  "확장이 업데이트되었거나 연결이 끊어졌습니다. 페이지를 새로고침(F5) 해주세요.";
export const TRANSIENT_MESSAGING_NOTICE =
  "확장 백그라운드와 잠시 연결되지 않았습니다. 자동으로 다시 시도합니다.";
export const FRAME_FORWARD_NONCE_RESYNC_INTERVAL_MS = 15_000;
export const FALLBACK_COMMIT_STABLE_MS = 400;
export const FALLBACK_COMMIT_OBSERVATION_THRESHOLD = 2;
