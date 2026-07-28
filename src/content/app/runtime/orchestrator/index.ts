/**
 * Content runtime orchestrator — 도메인 모듈 맵.
 *
 * 순환 호출·모듈 레벨 상태가 많아 런타임 본체는 runtime-core.ts 에 유지하고,
 * 순수 헬퍼는 helpers.ts 로 분리했다.
 *
 * 논리 도메인 (runtime-core 내부 구간):
 * - panel-status: 패널 상태/스냅샷/UI 동기화
 * - persistence: 저장·autosave·page-exit
 * - capture-events: structured/fallback 이벤트 처리
 * - observer-bridge: frame nonce·observer inject·top event
 * - polling: local/top fallback polling
 * - capture-lifecycle: start/stop/reset/rollover/URL
 * - commands/bindings: 메시지·설정·bootstrap
 *
 * 공개 진입: createContentRuntime
 */
export { createContentRuntime } from "./runtime-core";
export {
  isCapturePage,
  resolveDefaultPanelNotice,
  deriveCommitteeName,
  createObserverBridgeToken,
  cloneObserverBridgeEventForReplay,
} from "./helpers";
