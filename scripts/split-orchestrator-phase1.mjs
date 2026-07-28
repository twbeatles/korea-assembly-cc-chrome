/* eslint-disable */
/**
 * Phase 1 orchestrator 폴더 분리.
 *
 * 1) 원본을 impl.ts 로 보존
 * 2) 응집 단위 파일을 함수 이름 구간으로 잘라 생성
 * 3) 각 파일은 동일 모듈 스코프가 아니므로, 잘라낸 조각은
 *    다시 합치는 방식이 아니라 **단일 impl 을 논리적 파일로 재구성**한다.
 *
 * 순환 의존이 심한 orchestrator 특성상, 안전한 SOLID 1차 형태는:
 *   - state.ts : 상태 bag 싱글톤
 *   - modules/*.ts : bag 을 import 해서 함수 정의 후 bag.api 에 등록
 *   - index.ts : bag 생성 + 모듈 등록 + createContentRuntime
 *
 * 여기서는 검증된 점진 전략을 쓴다:
 *   A. orchestrator/ 폴더 + facade
 *   B. 순수/저의존 유틸 분리 (notices-pure)
 *   C. impl 유지 + 큰 블록을 별도 파일로 옮기고 impl 이 re-export/import
 */

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const runtimeDir = path.join(root, "src/content/app/runtime");
const outDir = path.join(runtimeDir, "orchestrator");
const sourceCandidates = [
  path.join(outDir, "index.ts"),
  path.join(runtimeDir, "orchestrator.ts"),
];

const sourcePath = sourceCandidates.find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
if (!sourcePath) {
  console.error("orchestrator source not found");
  process.exit(1);
}

const src = fs.readFileSync(sourcePath, "utf8");
fs.mkdirSync(outDir, { recursive: true });

// --- Extract import block (everything until first top-level let settings or function) ---
const settingsMatch = src.match(/\nlet settings: ExtensionSettings/);
const firstFnMatch = src.match(/\nfunction isCapturePage/);
if (!settingsMatch || !firstFnMatch) {
  console.error("markers not found");
  process.exit(1);
}

const importEnd = settingsMatch.index + 1; // points to 'let settings'
const stateStart = importEnd;
const bodyStart = firstFnMatch.index + 1; // 'function isCapturePage'

const importBlock = src.slice(0, stateStart);
const stateBlock = src.slice(stateStart, bodyStart);
const bodyBlock = src.slice(bodyStart);

// --- Write state.ts as module-level lets (same module scope pattern via re-export carefully) ---
// Because ES imports of `let` cannot be reassigned from outside, we use a bag object.

function indent(block, n = 2) {
  const pad = " ".repeat(n);
  return block
    .split("\n")
    .map((line) => (line.length ? pad + line : line))
    .join("\n");
}

// Fix forward refs in state: panelNotice = resolveDefaultPanelNotice() and observerBridgeToken = createObserverBridgeToken()
// These functions are in body. Initialize with placeholders then fix in bag factory after functions exist.
// Simpler: keep initialization inline by moving those two function defs into state.ts

const pureHelpers = `
import { isSupportedAssemblyUrl } from "../../../shared/constants";
import {
  DEFAULT_IN_PAGE_NOTICE,
  NON_CAPTURE_PAGE_NOTICE,
  isTopFrame,
} from "./../constants";
import { createRandomToken } from "../../../shared/random-token";
import type { ObserverBridgeEvent } from "../../../shared/message-types";

export function isCapturePage(): boolean {
  return isSupportedAssemblyUrl(window.location.href);
}

export function resolveDefaultPanelNotice(): string {
  return isCapturePage() ? DEFAULT_IN_PAGE_NOTICE : NON_CAPTURE_PAGE_NOTICE;
}

export function createObserverBridgeToken(): string {
  return createRandomToken();
}

export function cloneObserverBridgeEventForReplay(
  event: ObserverBridgeEvent,
): ObserverBridgeEvent {
  return {
    ...event,
    rows: event.rows?.map((row) => ({
      ...row,
    })),
    framePath: event.framePath ? [...event.framePath] : undefined,
  };
}

export function deriveCommitteeName(title: string): string {
  return title.replace(/\\s+\\|\\s+[^|]+$/, "").trim();
}
`;

// Build state bag from original state block text by eval-like structure:
// We'll keep original declarations inside createRuntimeState() function body.

let normalizedState = stateBlock
  // observerBridgeToken init uses function - keep createObserverBridgeToken import
  .replace(
    /let observerBridgeToken = createObserverBridgeToken\(\);/,
    "let observerBridgeToken = createObserverBridgeToken();",
  )
  .replace(
    /let panelNotice = resolveDefaultPanelNotice\(\);/,
    "let panelNotice = resolveDefaultPanelNotice();",
  );

// segmentRolloverEventsDroppedTotal is declared later in original - find it
const droppedDecl = bodyBlock.match(
  /let segmentRolloverEventsDroppedTotal = 0;\r?\n/,
);
if (droppedDecl) {
  normalizedState += "let segmentRolloverEventsDroppedTotal = 0;\n";
}

const stateModule = `${importBlock}
import {
  createObserverBridgeToken,
  resolveDefaultPanelNotice,
} from "./helpers";

/**
 * 런타임 가변 상태 단일 bag.
 * 기능 모듈은 bag 필드를 읽고 쓰며, 함수는 bag.api 에 연결한다.
 */
export type ContentRuntimeBag = ReturnType<typeof createContentRuntimeBag>;

export function createContentRuntimeBag() {
${indent(normalizedState.trimEnd(), 2)}

  const bag = {
    get settings() {
      return settings;
    },
    set settings(value) {
      settings = value;
    },
    get state() {
      return state;
    },
    set state(value) {
      state = value;
    },
    popupPorts,
    diagnosticsPorts,
    get localPollingTimer() {
      return localPollingTimer;
    },
    set localPollingTimer(value) {
      localPollingTimer = value;
    },
    get topFallbackTimer() {
      return topFallbackTimer;
    },
    set topFallbackTimer(value) {
      topFallbackTimer = value;
    },
    get persistTimer() {
      return persistTimer;
    },
    set persistTimer(value) {
      persistTimer = value;
    },
    get pendingRunningPersistSince() {
      return pendingRunningPersistSince;
    },
    set pendingRunningPersistSince(value) {
      pendingRunningPersistSince = value;
    },
    get pendingRunningPersistTrigger() {
      return pendingRunningPersistTrigger;
    },
    set pendingRunningPersistTrigger(value) {
      pendingRunningPersistTrigger = value;
    },
    get pendingResetTimer() {
      return pendingResetTimer;
    },
    set pendingResetTimer(value) {
      pendingResetTimer = value;
    },
    get localLastProbeSignature() {
      return localLastProbeSignature;
    },
    set localLastProbeSignature(value) {
      localLastProbeSignature = value;
    },
    get localHadProbeText() {
      return localHadProbeText;
    },
    set localHadProbeText(value) {
      localHadProbeText = value;
    },
    get topFallbackMissStreak() {
      return topFallbackMissStreak;
    },
    set topFallbackMissStreak(value) {
      topFallbackMissStreak = value;
    },
    get lastSuccessfulFallbackFramePath() {
      return lastSuccessfulFallbackFramePath;
    },
    set lastSuccessfulFallbackFramePath(value) {
      lastSuccessfulFallbackFramePath = value;
    },
    get localPollingUnconfirmedFallbackBlockStreak() {
      return localPollingUnconfirmedFallbackBlockStreak;
    },
    set localPollingUnconfirmedFallbackBlockStreak(value) {
      localPollingUnconfirmedFallbackBlockStreak = value;
    },
    get topFallbackUnconfirmedFallbackBlockStreak() {
      return topFallbackUnconfirmedFallbackBlockStreak;
    },
    set topFallbackUnconfirmedFallbackBlockStreak(value) {
      topFallbackUnconfirmedFallbackBlockStreak = value;
    },
    get panelCollapsed() {
      return panelCollapsed;
    },
    set panelCollapsed(value) {
      panelCollapsed = value;
    },
    get previewCollapsed() {
      return previewCollapsed;
    },
    set previewCollapsed(value) {
      previewCollapsed = value;
    },
    get panelNotice() {
      return panelNotice;
    },
    set panelNotice(value) {
      panelNotice = value;
    },
    get inPagePanel() {
      return inPagePanel;
    },
    set inPagePanel(value) {
      inPagePanel = value;
    },
    get frameForwardNonce() {
      return frameForwardNonce;
    },
    set frameForwardNonce(value) {
      frameForwardNonce = value;
    },
    get frameForwardNonceRefreshTimer() {
      return frameForwardNonceRefreshTimer;
    },
    set frameForwardNonceRefreshTimer(value) {
      frameForwardNonceRefreshTimer = value;
    },
    get frameForwardNonceRefreshInFlight() {
      return frameForwardNonceRefreshInFlight;
    },
    set frameForwardNonceRefreshInFlight(value) {
      frameForwardNonceRefreshInFlight = value;
    },
    get observerBridgeToken() {
      return observerBridgeToken;
    },
    set observerBridgeToken(value) {
      observerBridgeToken = value;
    },
    get lastSubtitleActivationAttemptAt() {
      return lastSubtitleActivationAttemptAt;
    },
    set lastSubtitleActivationAttemptAt(value) {
      lastSubtitleActivationAttemptAt = value;
    },
    get lastNavigationSnapshotAt() {
      return lastNavigationSnapshotAt;
    },
    set lastNavigationSnapshotAt(value) {
      lastNavigationSnapshotAt = value;
    },
    get liveCaptureLedger() {
      return liveCaptureLedger;
    },
    set liveCaptureLedger(value) {
      liveCaptureLedger = value;
    },
    get extensionContextInvalidated() {
      return extensionContextInvalidated;
    },
    set extensionContextInvalidated(value) {
      extensionContextInvalidated = value;
    },
    get failedStoppedSessionGuard() {
      return failedStoppedSessionGuard;
    },
    set failedStoppedSessionGuard(value) {
      failedStoppedSessionGuard = value;
    },
    get latestPersistabilityState() {
      return latestPersistabilityState;
    },
    set latestPersistabilityState(value) {
      latestPersistabilityState = value;
    },
    get latestRowDiagnostics() {
      return latestRowDiagnostics;
    },
    set latestRowDiagnostics(value) {
      latestRowDiagnostics = value;
    },
    get latestFallbackCommitState() {
      return latestFallbackCommitState;
    },
    set latestFallbackCommitState(value) {
      latestFallbackCommitState = value;
    },
    get segmentRolloverInFlight() {
      return segmentRolloverInFlight;
    },
    set segmentRolloverInFlight(value) {
      segmentRolloverInFlight = value;
    },
    get queuedSegmentRolloverEvents() {
      return queuedSegmentRolloverEvents;
    },
    set queuedSegmentRolloverEvents(value) {
      queuedSegmentRolloverEvents = value;
    },
    get flushingSegmentRolloverEvents() {
      return flushingSegmentRolloverEvents;
    },
    set flushingSegmentRolloverEvents(value) {
      flushingSegmentRolloverEvents = value;
    },
    get segmentRolloverToken() {
      return segmentRolloverToken;
    },
    set segmentRolloverToken(value) {
      segmentRolloverToken = value;
    },
    get fallbackCommitCandidate() {
      return fallbackCommitCandidate;
    },
    set fallbackCommitCandidate(value) {
      fallbackCommitCandidate = value;
    },
    get fallbackCommitTimer() {
      return fallbackCommitTimer;
    },
    set fallbackCommitTimer(value) {
      fallbackCommitTimer = value;
    },
    get fallbackCommitToken() {
      return fallbackCommitToken;
    },
    set fallbackCommitToken(value) {
      fallbackCommitToken = value;
    },
    get capturePipelineStarted() {
      return capturePipelineStarted;
    },
    set capturePipelineStarted(value) {
      capturePipelineStarted = value;
    },
    get urlChangePollingTimer() {
      return urlChangePollingTimer;
    },
    set urlChangePollingTimer(value) {
      urlChangePollingTimer = value;
    },
    captureLifecycleLock,
    urlReconcileController,
    get lastSegmentCapacityWarningReason() {
      return lastSegmentCapacityWarningReason;
    },
    set lastSegmentCapacityWarningReason(value) {
      lastSegmentCapacityWarningReason = value;
    },
    captureOwnerId,
    get captureOwnershipHeartbeatTimer() {
      return captureOwnershipHeartbeatTimer;
    },
    set captureOwnershipHeartbeatTimer(value) {
      captureOwnershipHeartbeatTimer = value;
    },
    get segmentRolloverEventsDroppedTotal() {
      return segmentRolloverEventsDroppedTotal;
    },
    set segmentRolloverEventsDroppedTotal(value) {
      segmentRolloverEventsDroppedTotal = value;
    },
  };

  return bag;
}

/** 프로세스(탭)당 단일 runtime bag */
export const rt = createContentRuntimeBag();
`;

// For body: strip functions moved to helpers and dropped decl; prefix state access with rt.
// Easiest safe approach for phase1: keep body as single impl that uses module-level vars
// WITHOUT bag transform — just folder structure + extract helpers + split by copying body sections
// into files that share via `import { rt } from './state'` after transforming assignments.

// Simpler validated approach for this script version:
// 1) helpers.ts pure
// 2) impl.ts = full original source (unchanged logic)
// 3) index re-exports createContentRuntime from impl
// 4) facade orchestrator.ts re-exports from orchestrator/

// PLUS extract pipeline and history in other scripts.

fs.writeFileSync(path.join(outDir, "helpers.ts"), pureHelpers.trimStart(), "utf8");

// Write full impl as-is (original content) for behavior preservation
fs.writeFileSync(path.join(outDir, "impl.ts"), src, "utf8");

fs.writeFileSync(
  path.join(outDir, "index.ts"),
  `/**
 * Content runtime orchestrator 진입점 (SOLID facade).
 * 구현 본문: ./impl.ts
 * 순수 헬퍼: ./helpers.ts
 */
export { createContentRuntime } from "./impl";
export {
  isCapturePage,
  resolveDefaultPanelNotice,
  deriveCommitteeName,
  createObserverBridgeToken,
  cloneObserverBridgeEventForReplay,
} from "./helpers";
`,
  "utf8",
);

fs.writeFileSync(
  path.join(runtimeDir, "orchestrator.ts"),
  `/**
 * 하위 호환 facade — 기존 import 경로 유지.
 */
export { createContentRuntime } from "./orchestrator/index";
`,
  "utf8",
);

// Remove duplicate index full copy if it was full source
// (index is now thin)

console.log("Phase1 base structure written.");
console.log("Next: split impl.ts into domain modules (manual/codemod).");
console.log({
  helpers: path.join(outDir, "helpers.ts"),
  impl: path.join(outDir, "impl.ts"),
  index: path.join(outDir, "index.ts"),
  facade: path.join(runtimeDir, "orchestrator.ts"),
});
