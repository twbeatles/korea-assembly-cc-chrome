/**
 * 하위 호환 facade — 기존 import 경로 및 esbuild 주입 번들 진입 유지.
 * 구현: ./injected-observer/ (constants/types/dom/reading/bridge) + bootstrap side-effect.
 */
export * from "./injected-observer/index";
import "./injected-observer/bootstrap";
