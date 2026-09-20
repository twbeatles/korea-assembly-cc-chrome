/**
 * runtime-core 공개 배럴 — 도메인 모듈 맵은 orchestrator/index.ts 주석을 따른다.
 * 외부 진입은 createContentRuntime 하나이며, 기존 import 경로는 facade가 유지한다.
 */
export { createContentRuntime } from "./lifecycle";
export { createRuntimeCoreContext } from "./context";
export type { RuntimeCoreContext } from "./context";
