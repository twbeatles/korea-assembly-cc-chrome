/**
 * Content runtime orchestrator — 도메인 모듈 맵.
 *
 * runtime-core/ 는 상태 bag(context.ts) + 도메인 모듈로 분리되어 있다.
 * 가변 상태는 RuntimeCoreContext 인스턴스가 소유하고, 각 함수는 ctx 를
 * 첫 인자로 받는다. 모듈 간 순환 참조는 런타임 호출이므로 안전하다.
 *
 * 논리 도메인 (runtime-core/ 모듈):
 * - context: 상태 bag과 팩토리
 * - timers/notices: 타이머 정리·패널 알림·오류 통지
 * - panel-status/snapshots: 상태 가시화·스냅샷 조립
 * - ownership/persistence: 소유권 heartbeat·영속화/autosave
 * - fallback-commit/capture-events: fallback 확정·캡처 이벤트 처리
 * - observer-bridge/polling: page world 연결·폴링 루프
 * - session-lifecycle/session-commands: 수명주기·사용자 명령
 * - panel-host/bindings/lifecycle: 호스트 바인딩·부트스트랩 조립 루트
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
