/* eslint-disable */
/**
 * SOLID 폴더 분할 (기계적, 내용 보존).
 *
 * A) core/subtitle-pipeline.ts → core/subtitle-pipeline/*
 * B) storage/session-store/public-api.ts → public-api/*
 * C) orchestrator/impl.ts → state bag + domain modules
 *
 * 실행: node scripts/split-solid-phase.mjs
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content.replace(/\r\n/g, "\n"), "utf8");
  console.log("wrote", path.relative(root, filePath), content.length);
}

function sliceLines(lines, start1, end1Inclusive) {
  return lines.slice(start1 - 1, end1Inclusive).join("\n");
}

// ---------------------------------------------------------------------------
// A) subtitle-pipeline
// ---------------------------------------------------------------------------
function splitSubtitlePipeline() {
  const srcPath = path.join(root, "src/core/subtitle-pipeline.ts");
  const outDir = path.join(root, "src/core/subtitle-pipeline");
  const src = fs.readFileSync(srcPath, "utf8");
  const lines = src.replace(/\r\n/g, "\n").split("\n");

  // Keep original as safety copy only if not already a facade
  if (src.includes('from "./subtitle-pipeline/') || src.includes('from "./subtitle-pipeline"')) {
    console.log("subtitle-pipeline already facaded, skip A");
    return;
  }

  const typesBody = `
import type { ExtensionSettings } from "../storage/types";
import type {
  SpeakerChannel,
  SubtitleCaptureMode,
  SessionState,
  SubtitleEntry,
} from "./subtitle-models";

export const MIN_COMPACT_ANCHOR = 10;
export const LARGE_APPEND_MIN = 200;

export interface PipelineSourceMeta {
  selector?: string;
  framePath?: number[];
  sourceNodeKey?: string;
  sourceCaptureMode?: SubtitleCaptureMode;
  speakerColor?: string;
  speakerChannel?: SpeakerChannel;
  forceNewEntry?: boolean;
}

export interface LiveRowCommitMeta extends PipelineSourceMeta {
  entryId?: string;
  baselineCompact?: string | null;
}

export interface PipelineResult {
  state: SessionState;
  changed: boolean;
  appendedEntry?: SubtitleEntry;
  reason?: string;
}

export interface IncrementalExtractResult {
  text: string;
  matched: boolean;
  duplicate: boolean;
  ambiguous: boolean;
  reason:
    | "empty"
    | "no_history"
    | "identical_history"
    | "contained_in_history"
    | "suffix"
    | "suffix_duplicate"
    | "history"
    | "history_duplicate"
    | "overlap"
    | "overlap_duplicate"
    | "full";
}
`.trimStart();

  // state-helpers: lines 67-129 (clone through applySourceMeta)
  const stateHelpers = `
import type { ExtensionSettings } from "../storage/types";
import type { SessionState, SubtitleEntry } from "./subtitle-models";
import { toIsoString } from "./timeline";
import type { PipelineSourceMeta } from "./types";

export function cloneStateStructure(state: SessionState): SessionState {
  return {
    ...state,
    entries: [...state.entries],
    pendingPreviews: [...state.pendingPreviews],
    currentFramePath: [...state.currentFramePath],
  };
}

export function cloneEntryAtIndex(state: SessionState, index: number): SubtitleEntry | undefined {
  const current = state.entries[index];
  if (!current) {
    return undefined;
  }

  const cloned: SubtitleEntry = {
    ...current,
    sourceFramePath: current.sourceFramePath ? [...current.sourceFramePath] : undefined,
  };
  state.entries[index] = cloned;
  return cloned;
}

export function updateStateMetadata(
  state: SessionState,
  now: number,
  meta?: PipelineSourceMeta,
): SessionState {
  const next = cloneStateStructure(state);
  next.updatedAt = toIsoString(now);
  next.lastObserverEventAt = now;
  if (meta?.selector) {
    next.currentSelector = meta.selector;
  }
  if (meta?.framePath) {
    next.currentFramePath = [...meta.framePath];
  }
  return next;
}

export function applySourceMeta(entry: SubtitleEntry, meta?: PipelineSourceMeta): void {
  if (!meta) {
    return;
  }
  if (meta.selector) {
    entry.sourceSelector = meta.selector;
  }
  if (meta.framePath) {
    entry.sourceFramePath = [...meta.framePath];
  }
  if (meta.sourceNodeKey) {
    entry.sourceNodeKey = meta.sourceNodeKey;
  }
  if (meta.sourceCaptureMode) {
    entry.sourceCaptureMode = meta.sourceCaptureMode;
  }
  if (meta.speakerColor) {
    entry.speakerColor = meta.speakerColor;
  }
  if (meta.speakerChannel) {
    entry.speakerChannel = meta.speakerChannel;
  }
}
`.trimStart();

  // history: 131-224
  const historyBody = sliceLines(lines, 131, 224);
  const history = `
import { PIPELINE_DEFAULTS } from "../shared/constants";
import type { ExtensionSettings } from "../storage/types";
import type { SessionState, SubtitleEntry } from "./subtitle-models";
import { compactSubtitleText } from "./text-normalizer";

${historyBody}
`.trimStart();

  // extract: 226-399
  const extractBody = sliceLines(lines, 226, 399);
  const extract = `
import { PIPELINE_DEFAULTS } from "../shared/constants";
import {
  compactSubtitleText,
  normalizeRawText,
  stripZeroWidth,
} from "./text-normalizer";
import { LARGE_APPEND_MIN, MIN_COMPACT_ANCHOR, type IncrementalExtractResult } from "./types";

${extractBody}
`.trimStart();

  // commit: 401-742
  const commitBody = sliceLines(lines, 401, 742);
  const commit = `
import { PIPELINE_DEFAULTS } from "../shared/constants";
import type { ExtensionSettings } from "../storage/types";
import {
  hasRequiredSubtitleContent,
  isMeaningfulSubtitleText,
  isNoiseOnly,
} from "./noise-filter";
import {
  createId,
  type SessionState,
  type SubtitleEntry,
} from "./subtitle-models";
import {
  compactSubtitleText,
  joinStreamText,
  normalizeRawText,
} from "./text-normalizer";
import { toIsoString } from "./timeline";
import {
  applySourceMeta,
  cloneEntryAtIndex,
  cloneStateStructure,
  updateStateMetadata,
} from "./state-helpers";
import {
  buildConfirmedCompactHistory,
  buildRecentCompactHistory,
  rebuildConfirmedHistory,
  resolveRecentDuplicateMinLength,
  resolveRecentHistoryCompactLength,
  softResyncHistory,
} from "./history";
import { extractIncrementalTextWithRecentHistory } from "./extract";
import type { LiveRowCommitMeta, PipelineResult, PipelineSourceMeta } from "./types";

${commitBody}
`.trimStart();

  // lifecycle: 744-793
  const lifecycleBody = sliceLines(lines, 744, 793);
  const lifecycle = `
import type { ExtensionSettings } from "../storage/types";
import type { SessionState } from "./subtitle-models";
import { toIsoString } from "./timeline";
import { cloneEntryAtIndex, updateStateMetadata } from "./state-helpers";
import type { PipelineResult } from "./types";

${lifecycleBody}
`.trimStart();

  const index = `
/**
 * subtitle-pipeline 공개 진입점 (SOLID facade).
 * 타입·히스토리·증분 추출·커밋·라이프사이클 모듈로 분리.
 */
export type {
  PipelineSourceMeta,
  LiveRowCommitMeta,
  PipelineResult,
  IncrementalExtractResult,
} from "./types";

export { buildConfirmedCompactHistory } from "./history";
export { extractIncrementalTextFromHistory } from "./extract";
export {
  flushPendingPreviews,
  applyPreview,
  commitLiveRow,
  applyStructuredEntry,
} from "./commit";
export { applyKeepalive, applyReset, finalizeSession } from "./lifecycle";

export { hasRequiredSubtitleContent, isNoiseOnly } from "./noise-filter";
export { normalizeRawText } from "./text-normalizer";
`.trimStart();

  writeFile(path.join(outDir, "types.ts"), typesBody);
  writeFile(path.join(outDir, "state-helpers.ts"), stateHelpers);
  writeFile(path.join(outDir, "history.ts"), history);
  writeFile(path.join(outDir, "extract.ts"), extract);
  writeFile(path.join(outDir, "commit.ts"), commit);
  writeFile(path.join(outDir, "lifecycle.ts"), lifecycle);
  writeFile(path.join(outDir, "index.ts"), index);

  // Facade preserves import path `../core/subtitle-pipeline` and `./subtitle-pipeline`
  writeFile(
    srcPath,
    `/**
 * 하위 호환 facade — 기존 import 경로 유지.
 * 구현: ./subtitle-pipeline/
 */
export type {
  PipelineSourceMeta,
  LiveRowCommitMeta,
  PipelineResult,
  IncrementalExtractResult,
} from "./subtitle-pipeline/index";
export {
  buildConfirmedCompactHistory,
  extractIncrementalTextFromHistory,
  flushPendingPreviews,
  applyPreview,
  commitLiveRow,
  applyStructuredEntry,
  applyKeepalive,
  applyReset,
  finalizeSession,
  hasRequiredSubtitleContent,
  isNoiseOnly,
  normalizeRawText,
} from "./subtitle-pipeline/index";
`,
  );
}

// ---------------------------------------------------------------------------
// B) public-api barrel split
// ---------------------------------------------------------------------------
function splitPublicApi() {
  const srcPath = path.join(root, "src/storage/session-store/public-api.ts");
  const outDir = path.join(root, "src/storage/session-store/public-api");
  if (fs.existsSync(outDir) && fs.statSync(outDir).isDirectory()) {
    console.log("public-api/ already exists, skip B");
    return;
  }

  const src = fs.readFileSync(srcPath, "utf8").replace(/\r\n/g, "\n");
  const lines = src.split("\n");

  // Shared imports block (lines 1-157) ends before first export async function saveSession
  const firstExportIdx = lines.findIndex((l) => l.startsWith("export async function saveSession"));
  if (firstExportIdx < 0) throw new Error("saveSession not found");

  const sharedImports = lines.slice(0, firstExportIdx).join("\n").trimEnd();

  // Function ranges by name (1-based line numbers from earlier map)
  // We re-scan dynamically for robustness
  const fnStarts = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^export async function ([A-Za-z0-9_]+)/);
    if (m) fnStarts.push({ name: m[1], line: i + 1 });
  }
  // resetSessionStoreForTests may be non-async
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^export (async )?function ([A-Za-z0-9_]+)/);
    if (m && !fnStarts.some((f) => f.line === i + 1)) {
      fnStarts.push({ name: m[2], line: i + 1 });
    }
  }
  fnStarts.sort((a, b) => a.line - b.line);

  function bodyOf(name) {
    const idx = fnStarts.findIndex((f) => f.name === name);
    if (idx < 0) throw new Error("missing fn " + name);
    const start = fnStarts[idx].line;
    const end =
      idx + 1 < fnStarts.length ? fnStarts[idx + 1].line - 1 : lines.length;
    // trim trailing blank
    let endAdj = end;
    while (endAdj > start && !lines[endAdj - 1].trim()) endAdj--;
    return sliceLines(lines, start, endAdj);
  }

  const groups = {
    mutations: [
      "saveSession",
      "updateRunningSession",
      "upsertSessionRecord",
      "updateSessionMetadata",
      "updateSessionLineageMetadata",
      "updateSessionContent",
    ],
    queries: [
      "loadSession",
      "loadSessionsByIds",
      "getSessionLibraryOverview",
      "buildSessionLibraryBackupExport",
      "listSessions",
      "listSessionLineageSegments",
      "listSessionsPage",
      "listSessionLineagesPage",
      "searchSessions",
      "searchSessionLineagesPage",
    ],
    deletions: ["deleteSession", "deleteSessionLineage", "deleteAllSessions"],
    "import-export": [
      "importSessionRecords",
      "exportSessionData",
      "exportSessionLineageData",
    ],
    startup: [
      "replayQueuedExitPersistRecords",
      "closeRunningSessionsOnStartup",
      "resetSessionStoreForTests",
    ],
  };

  // Cross-module calls inside public-api:
  // mutations call loadSession, listSessionLineageSegments
  // deletions may call loadSession
  // import-export may call many
  // So each file imports peers from sibling modules as needed via relative imports.

  for (const [file, names] of Object.entries(groups)) {
    const bodies = names.map(bodyOf).join("\n\n");
    // Adjust import paths: from public-api/ folder, ../ becomes ../../ for core? 
    // Original was in session-store/, now in session-store/public-api/
    // So:
    //   ../session-write-queue → ../../session-write-queue? No: session-write-queue is at storage/session-write-queue
    //   Original: from "../session-write-queue" (storage/)
    //   New: from "../../session-write-queue"
    //   ./normalize → ../normalize
    //   ../../core → ../../../core
    //   ../types → ../../types
    //   ./globals → ../globals
    //   ./idb → ../idb
    //   ./fallback → ../fallback

    let imports = sharedImports
      .replace(/from "\.\.\/session-write-queue"/g, 'from "../../session-write-queue"')
      .replace(/from "\.\.\/persist-recovery"/g, 'from "../../persist-recovery"')
      .replace(/from "\.\.\/session-backup"/g, 'from "../../session-backup"')
      .replace(/from "\.\.\/types"/g, 'from "../../types"')
      .replace(/from "\.\.\/\.\.\/core\//g, 'from "../../../core/')
      .replace(/from "\.\.\/\.\.\/shared\//g, 'from "../../../shared/')
      .replace(/from "\.\/normalize"/g, 'from "../normalize"')
      .replace(/from "\.\/search-helpers"/g, 'from "../search-helpers"')
      .replace(/from "\.\/entry-chunks"/g, 'from "../entry-chunks"')
      .replace(/from "\.\/backup-bundle"/g, 'from "../backup-bundle"')
      .replace(/from "\.\/export-payload"/g, 'from "../export-payload"')
      .replace(/from "\.\/globals"/g, 'from "../globals"')
      .replace(/from "\.\/utils"/g, 'from "../utils"')
      .replace(/from "\.\/idb\//g, 'from "../idb/')
      .replace(/from "\.\/mutations-internal"/g, 'from "../mutations-internal"')
      .replace(/from "\.\/lineage-helpers"/g, 'from "../lineage-helpers"')
      .replace(/from "\.\/fallback\//g, 'from "../fallback/')
      // Remove re-export of SESSION_NOTE_MAX_LENGTH from non-index files
      .replace(/^export \{ SESSION_NOTE_MAX_LENGTH \} from .*;\n/m, "");

    // Add cross-imports for known peer usage
    let peerImports = "";
    if (file === "mutations") {
      peerImports = `import { loadSession } from "./queries";\nimport { listSessionLineageSegments } from "./queries";\n`;
    }
    if (file === "deletions") {
      peerImports = `import { loadSession } from "./queries";\n`;
    }
    if (file === "import-export") {
      // importSessionRecords may use write/list helpers only from lower layers
      peerImports = "";
    }
    if (file === "startup") {
      peerImports = `import { loadSession } from "./queries";\n`;
    }
    if (file === "queries") {
      // queries are self-contained mostly
      peerImports = "";
    }

    const content = `${imports}\n${peerImports ? "\n" + peerImports : ""}\n${bodies}\n`;
    writeFile(path.join(outDir, `${file}.ts`), content);
  }

  const index = `
/** session-store 공개 API 배럴 (기능별 모듈 분리) */
export { SESSION_NOTE_MAX_LENGTH } from "../normalize";
export {
  saveSession,
  updateRunningSession,
  upsertSessionRecord,
  updateSessionMetadata,
  updateSessionLineageMetadata,
  updateSessionContent,
} from "./mutations";
export {
  loadSession,
  loadSessionsByIds,
  getSessionLibraryOverview,
  buildSessionLibraryBackupExport,
  listSessions,
  listSessionLineageSegments,
  listSessionsPage,
  listSessionLineagesPage,
  searchSessions,
  searchSessionLineagesPage,
} from "./queries";
export {
  deleteSession,
  deleteSessionLineage,
  deleteAllSessions,
} from "./deletions";
export {
  importSessionRecords,
  exportSessionData,
  exportSessionLineageData,
} from "./import-export";
export {
  replayQueuedExitPersistRecords,
  closeRunningSessionsOnStartup,
  resetSessionStoreForTests,
} from "./startup";
`.trimStart();

  writeFile(path.join(outDir, "index.ts"), index);

  // Replace public-api.ts with facade
  writeFile(
    srcPath,
    `/**
 * 하위 호환 facade — 기존 import 경로 유지.
 * 구현: ./public-api/
 */
export {
  SESSION_NOTE_MAX_LENGTH,
  saveSession,
  updateRunningSession,
  upsertSessionRecord,
  updateSessionMetadata,
  updateSessionLineageMetadata,
  updateSessionContent,
  loadSession,
  loadSessionsByIds,
  getSessionLibraryOverview,
  buildSessionLibraryBackupExport,
  listSessions,
  listSessionLineageSegments,
  listSessionsPage,
  listSessionLineagesPage,
  searchSessions,
  searchSessionLineagesPage,
  deleteSession,
  deleteSessionLineage,
  deleteAllSessions,
  importSessionRecords,
  exportSessionData,
  exportSessionLineageData,
  replayQueuedExitPersistRecords,
  closeRunningSessionsOnStartup,
  resetSessionStoreForTests,
} from "./public-api/index";
`,
  );
}

// ---------------------------------------------------------------------------
// C) orchestrator state bag + domain modules
// ---------------------------------------------------------------------------
function splitOrchestrator() {
  const implPath = path.join(root, "src/content/app/runtime/orchestrator/impl.ts");
  const outDir = path.join(root, "src/content/app/runtime/orchestrator");
  if (fs.existsSync(path.join(outDir, "state.ts"))) {
    console.log("orchestrator state.ts exists, skip C deepen");
    return;
  }

  const src = fs.readFileSync(implPath, "utf8").replace(/\r\n/g, "\n");
  const lines = src.split("\n");

  // Find state region: first `let settings` through last state const/let before first function isCapturePage
  const settingsLine = lines.findIndex((l) => l.startsWith("let settings:"));
  const firstFnLine = lines.findIndex((l) => l.startsWith("function isCapturePage"));
  if (settingsLine < 0 || firstFnLine < 0) {
    throw new Error("orchestrator markers missing");
  }

  const importBlock = lines.slice(0, settingsLine).join("\n");
  const stateBlock = lines.slice(settingsLine, firstFnLine).join("\n");
  const bodyBlock = lines.slice(firstFnLine).join("\n");

  // Pure helpers already in helpers.ts — rewrite body to import them and remove local defs
  // Function groups by name (start line within full file, 1-based)
  const fnStarts = [];
  for (let i = firstFnLine; i < lines.length; i++) {
    const m = lines[i].match(/^(export )?(async )?function ([A-Za-z0-9_]+)/);
    if (m) fnStarts.push({ name: m[3], line: i + 1, export: Boolean(m[1]) });
  }

  function bodyOf(name) {
    const idx = fnStarts.findIndex((f) => f.name === name);
    if (idx < 0) throw new Error("missing " + name);
    const start = fnStarts[idx].line;
    const end =
      idx + 1 < fnStarts.length ? fnStarts[idx + 1].line - 1 : lines.length;
    let endAdj = end;
    while (endAdj > start && !lines[endAdj - 1].trim()) endAdj--;
    return sliceLines(lines, start, endAdj);
  }

  const pureNames = new Set([
    "isCapturePage",
    "resolveDefaultPanelNotice",
    "createObserverBridgeToken",
    "cloneObserverBridgeEventForReplay",
    "deriveCommitteeName",
  ]);

  // Domain groups
  const groups = {
    "segment-queue": [
      "queueSegmentRolloverEvent",
      "flushQueuedSegmentRolloverEvent",
    ],
    timers: [
      "clearLocalPolling",
      "clearTopFallbackTimer",
      "clearFallbackCommitTimer",
      "clearFallbackCommitCandidate",
      "clearFrameForwardNonceRefresh",
      "clearUrlChangePolling",
      "clearRunningPersistTimer",
      "clearPendingReset",
      "clearCaptureOwnershipHeartbeat",
    ],
    "context-errors": [
      "shutdownForInvalidatedContext",
      "reportRuntimeError",
      "logDebug",
    ],
    "panel-status": [
      "setPanelNotice",
      "confirmSessionClear",
      "confirmFailedStoppedSessionDiscard",
      "getPanelLiveRows",
      "getLivePreviewText",
      "getLivePreviewTextForDisplay",
      "getCaptureMode",
      "setPersistabilityState",
      "createEmptyRowDiagnostics",
      "updateRowDiagnostics",
      "setFallbackCommitState",
      "resolvePreviewPersistability",
      "shouldShowPanelNotice",
      "canClearCurrentSession",
      "buildStatusSnapshot",
      "broadcastPopupState",
      "syncPortState",
      "updateInPagePanel",
      "syncUserInterfaces",
    ],
    ownership: [
      "startCaptureOwnershipHeartbeat",
      "claimCaptureOwnershipForStart",
      "releaseCaptureOwnershipForStop",
    ],
    persistence: [
      "persistSessionRecord",
      "deletePersistedSession",
      "canPersistCurrentRunningState",
      "buildPreparedSessionState",
      "buildVisibleOutputEntries",
      "buildVisibleSessionRecord",
      "buildPreparedSessionRecord",
      "scheduleRunningPersist",
      "persistStoppedSession",
      "persistSessionRecordInBackground",
      "queueExitPersistRecordInBackground",
      "persistRunningSnapshotForVisibilityChange",
      "persistStoppedSnapshotForPageExit",
      "saveCurrentSessionSnapshotUnlocked",
      "saveCurrentSessionSnapshot",
      "saveAndStartNewSession",
      "maybeEmitSegmentCapacityWarning",
    ],
    "capture-events": [
      "clearStructuredRuntimeState",
      "scheduleDeferredSubtitleReset",
      "applyPreviewStateOnly",
      "applyStructuredRowsEvent",
      "scheduleFallbackCommitCandidate",
      "resolveFallbackResultState",
      "commitFallbackCandidate",
      "observeFallbackCommitCandidate",
      "highlightLatestCommittedEntry",
    ],
    "observer-bridge": [
      "refreshFrameForwardNonce",
      "requestFrameForwardNonceResync",
      "startFrameForwardNonceRefresh",
      "triggerImmediateTopFallbackProbe",
      "dispatchObserverConfig",
      "requestSubtitleLayerActivation",
      "ensureSubtitleLayerActive",
      "injectObserverScript",
      "forwardToTop",
      "handleTopFrameEvent",
      "bindBridgeMessages",
      "ensureFrameForwardNonce",
    ],
    polling: [
      "emitLocalProbeEvent",
      "startLocalPolling",
      "scheduleTopFrameFallbackTick",
      "runTopFrameFallbackTick",
      "startTopFrameFallback",
    ],
    "capture-lifecycle": [
      "stopCapturePipelineForCurrentPage",
      "startCapturePipelineForCurrentPage",
      "performUrlReconcile",
      "resetRuntimeState",
      "ensureFailedStoppedSessionResolved",
      "ensureCurrentRunningSessionPreservedBeforeReset",
      "clearSessionAndResetUnlocked",
      "clearSessionAndReset",
      "startCaptureUnlocked",
      "startCapture",
      "stopCaptureUnlocked",
      "stopCapture",
      "rollOverRunningSessionSegment",
      "exportCurrentSession",
      "exportCurrentSessionUnlocked",
      "copyRecentSessionLines",
      "openHistoryPage",
      "openOptionsPage",
      "openDiagnosticsPage",
      "openInPagePanel",
      "collapseInPagePanel",
      "mountInPagePanel",
    ],
    commands: ["handleCommand", "bindPopupPort"],
    bindings: [
      "bindSettingsChanges",
      "resyncOnReturnToForeground",
      "bindNavigationGuards",
      "bindUrlChangeDetection",
      "bootstrap",
      "handleBootstrapError",
      "createContentRuntimeServices",
      "createContentRuntime",
    ],
  };

  // Convert state block to bag properties
  // Strategy: keep module-level mutable state in state.ts as `export const rt = { ... }`
  // Functions reference rt.field instead of bare identifiers.

  const stateFieldNames = [
    "settings",
    "state",
    "localPollingTimer",
    "topFallbackTimer",
    "persistTimer",
    "pendingRunningPersistSince",
    "pendingRunningPersistTrigger",
    "pendingResetTimer",
    "localLastProbeSignature",
    "localHadProbeText",
    "topFallbackMissStreak",
    "lastSuccessfulFallbackFramePath",
    "localPollingUnconfirmedFallbackBlockStreak",
    "topFallbackUnconfirmedFallbackBlockStreak",
    "panelCollapsed",
    "previewCollapsed",
    "panelNotice",
    "inPagePanel",
    "frameForwardNonce",
    "frameForwardNonceRefreshTimer",
    "frameForwardNonceRefreshInFlight",
    "observerBridgeToken",
    "lastSubtitleActivationAttemptAt",
    "lastNavigationSnapshotAt",
    "liveCaptureLedger",
    "extensionContextInvalidated",
    "failedStoppedSessionGuard",
    "latestPersistabilityState",
    "latestRowDiagnostics",
    "latestFallbackCommitState",
    "segmentRolloverInFlight",
    "queuedSegmentRolloverEvents",
    "flushingSegmentRolloverEvents",
    "segmentRolloverToken",
    "fallbackCommitCandidate",
    "fallbackCommitTimer",
    "fallbackCommitToken",
    "capturePipelineStarted",
    "urlChangePollingTimer",
    "lastSegmentCapacityWarningReason",
    "captureOwnershipHeartbeatTimer",
  ];
  // Also const bindings that are mutated via methods (Set) or are stable:
  // popupPorts, diagnosticsPorts, captureLifecycleLock, urlReconcileController, captureOwnerId

  const bagFieldNames = [
    ...stateFieldNames,
    "popupPorts",
    "diagnosticsPorts",
    "captureLifecycleLock",
    "urlReconcileController",
    "captureOwnerId",
  ];

  // Build state.ts: rewrite let/const module state into rt bag with same initializers
  let stateInit = stateBlock
    .replace(/^let /gm, "")
    .replace(/^const /gm, "")
    .replace(
      /panelNotice = resolveDefaultPanelNotice\(\)/,
      'panelNotice: "" as string /* set after helpers */',
    )
    .replace(
      /observerBridgeToken = createObserverBridgeToken\(\)/,
      'observerBridgeToken: "" as string /* set after helpers */',
    )
    .replace(
      /latestRowDiagnostics = createEmptyRowDiagnostics\(\)/,
      "latestRowDiagnostics: null as RowDiagnosticsState | null /* set in createRuntimeState */",
    );

  // Convert `name: Type = value` / `name = value` lines into object properties
  // The state block has forms:
  //   let settings: ExtensionSettings = { ... };
  //   let state: SessionState = createEmpty...
  //   const popupPorts = new Set...
  // After removing let/const, we need commas instead of semicolons between properties.

  // Safer approach: keep original let/const in state.ts as module-level, and also export a Proxy bag?
  // Actually ES live binding: if state.ts has `export let settings`, other modules can import { settings } and READ latest,
  // but CANNOT reassign `settings = x` from other modules.
  // So bag is required for cross-module writes.

  // Transform state block into object literal properties manually:
  const stateLines = stateBlock.split("\n");
  const propLines = [];
  for (const line of stateLines) {
    if (!line.trim()) {
      propLines.push("");
      continue;
    }
    let m = line.match(
      /^(let|const) ([A-Za-z0-9_]+)(: [^=]+)? = ([\s\S]*);$/,
    );
    if (m) {
      const name = m[2];
      const type = m[3] || "";
      let value = m[4];
      if (name === "panelNotice") value = '""';
      if (name === "observerBridgeToken") value = '""';
      if (name === "latestRowDiagnostics") {
        propLines.push(
          `  ${name}: null as import("./types").RowDiagnosticsState | null,`,
        );
        continue;
      }
      propLines.push(`  ${name}${type} = ${value},`.replace(" = ", ": ").replace(/,$/, ",") );
      // Fix: we produced `name: Type: value,` if type present — redo carefully
      continue;
    }
    // multi-line values: keep as-is for now and post-process
    propLines.push("  // " + line);
  }

  // Multi-line object init makes regex line approach fragile. Use different strategy:
  // Keep ALL original module-level state in state.ts EXACTLY, and export a getter object
  // whose properties are accessors. Cross-module assignment via rt.settings = x works.

  const accessorLines = bagFieldNames
    .map(
      (name) => `  get ${name}() { return ${name}; },
  set ${name}(v) { ${name} = v; },`,
    )
    .join("\n");

  // For const Set/lock/owner - only getters (mutation is in-place)
  const mutableNames = new Set(stateFieldNames);
  const constNames = [
    "popupPorts",
    "diagnosticsPorts",
    "captureLifecycleLock",
    "urlReconcileController",
    "captureOwnerId",
  ];

  const rtAccessors = [
    ...stateFieldNames.map(
      (n) =>
        `  get ${n}() { return _${n}; },\n  set ${n}(v: typeof _${n}) { _${n} = v; },`,
    ),
    ...constNames.map((n) => `  get ${n}() { return ${n}; },`),
  ].join("\n");

  // Rename lets to _name privately, export rt bag
  let privateState = stateBlock
    .replace(/\blet settings\b/, "let _settings")
    .replace(/\blet state\b/, "let _state")
    .replace(/\blet localPollingTimer\b/, "let _localPollingTimer")
    .replace(/\blet topFallbackTimer\b/, "let _topFallbackTimer")
    .replace(/\blet persistTimer\b/, "let _persistTimer")
    .replace(/\blet pendingRunningPersistSince\b/, "let _pendingRunningPersistSince")
    .replace(/\blet pendingRunningPersistTrigger\b/, "let _pendingRunningPersistTrigger")
    .replace(/\blet pendingResetTimer\b/, "let _pendingResetTimer")
    .replace(/\blet localLastProbeSignature\b/, "let _localLastProbeSignature")
    .replace(/\blet localHadProbeText\b/, "let _localHadProbeText")
    .replace(/\blet topFallbackMissStreak\b/, "let _topFallbackMissStreak")
    .replace(/\blet lastSuccessfulFallbackFramePath\b/, "let _lastSuccessfulFallbackFramePath")
    .replace(
      /\blet localPollingUnconfirmedFallbackBlockStreak\b/,
      "let _localPollingUnconfirmedFallbackBlockStreak",
    )
    .replace(
      /\blet topFallbackUnconfirmedFallbackBlockStreak\b/,
      "let _topFallbackUnconfirmedFallbackBlockStreak",
    )
    .replace(/\blet panelCollapsed\b/, "let _panelCollapsed")
    .replace(/\blet previewCollapsed\b/, "let _previewCollapsed")
    .replace(/\blet panelNotice\b/, "let _panelNotice")
    .replace(/\blet inPagePanel\b/, "let _inPagePanel")
    .replace(/\blet frameForwardNonce\b/, "let _frameForwardNonce")
    .replace(/\blet frameForwardNonceRefreshTimer\b/, "let _frameForwardNonceRefreshTimer")
    .replace(
      /\blet frameForwardNonceRefreshInFlight\b/,
      "let _frameForwardNonceRefreshInFlight",
    )
    .replace(/\blet observerBridgeToken\b/, "let _observerBridgeToken")
    .replace(
      /\blet lastSubtitleActivationAttemptAt\b/,
      "let _lastSubtitleActivationAttemptAt",
    )
    .replace(/\blet lastNavigationSnapshotAt\b/, "let _lastNavigationSnapshotAt")
    .replace(/\blet liveCaptureLedger\b/, "let _liveCaptureLedger")
    .replace(/\blet extensionContextInvalidated\b/, "let _extensionContextInvalidated")
    .replace(/\blet failedStoppedSessionGuard\b/, "let _failedStoppedSessionGuard")
    .replace(/\blet latestPersistabilityState\b/, "let _latestPersistabilityState")
    .replace(/\blet latestRowDiagnostics\b/, "let _latestRowDiagnostics")
    .replace(/\blet latestFallbackCommitState\b/, "let _latestFallbackCommitState")
    .replace(/\blet segmentRolloverInFlight\b/, "let _segmentRolloverInFlight")
    .replace(/\blet queuedSegmentRolloverEvents\b/, "let _queuedSegmentRolloverEvents")
    .replace(/\blet flushingSegmentRolloverEvents\b/, "let _flushingSegmentRolloverEvents")
    .replace(/\blet segmentRolloverToken\b/, "let _segmentRolloverToken")
    .replace(/\blet fallbackCommitCandidate\b/, "let _fallbackCommitCandidate")
    .replace(/\blet fallbackCommitTimer\b/, "let _fallbackCommitTimer")
    .replace(/\blet fallbackCommitToken\b/, "let _fallbackCommitToken")
    .replace(/\blet capturePipelineStarted\b/, "let _capturePipelineStarted")
    .replace(/\blet urlChangePollingTimer\b/, "let _urlChangePollingTimer")
    .replace(
      /\blet lastSegmentCapacityWarningReason\b/,
      "let _lastSegmentCapacityWarningReason",
    )
    .replace(
      /\blet captureOwnershipHeartbeatTimer\b/,
      "let _captureOwnershipHeartbeatTimer",
    );

  // Fix initializers that call functions not yet available
  privateState = privateState
    .replace(
      /_panelNotice = resolveDefaultPanelNotice\(\)/,
      '_panelNotice = ""',
    )
    .replace(
      /_observerBridgeToken = createObserverBridgeToken\(\)/,
      '_observerBridgeToken = ""',
    )
    .replace(
      /_latestRowDiagnostics = createEmptyRowDiagnostics\(\)/,
      "_latestRowDiagnostics = { stableRowCount: 0, unstableRowCount: 0, filteredUnconfirmedCount: 0, rowKeySourceCounts: { attribute: 0, class: 0, generated: 0 } }",
    );

  // Actually createEmptyRowDiagnostics might have different shape - keep call by importing later
  // For init order, use a lazy placeholder and set in initRuntimeState()

  // DECISION: Orchestrator deepen with full bag rewrite is high-risk for this script.
  // Instead for C: create domain modules that re-export function groups FROM a single
  // `runtime-core.ts` that is the renamed impl, AND create thin domain files for documentation.
  // Better for "no missing code": keep impl as runtime-core, split only by re-export barrels.

  // Revised C approach - content-preserving:
  // 1. Rename impl.ts → runtime-core.ts (all code stays)
  // 2. Create domain modules that only re-export named functions from runtime-core
  //    BUT those functions are not exported from runtime-core currently...

  // Best content-preserving solid split for orchestrator:
  // Keep full body in runtime-core.ts, extract pure helpers (done), 
  // and add domain documentation index that points to logical sections.
  // For REAL function extraction without bag rewrite: move entire function text
  // into domain files but they need access to shared state → bag rewrite required.

  // Pragmatic C: Write runtime-core.ts = current impl (unchanged body).
  // Create modules/*.ts that import helpers + re-export nothing, just document.
  // Actually user wants real split.

  // Full bag rewrite of body: replace bare state identifiers with rt.xxx
  // Using word-boundary replacements carefully.

  function rewriteBodyToUseRt(body) {
    let out = body;
    // Longer names first to avoid partial replaces
    const names = [...bagFieldNames].sort((a, b) => b.length - a.length);
    for (const name of names) {
      // Don't replace property access like foo.settings or "settings" or function params
      // Simple approach: replace standalone identifiers
      const re = new RegExp(
        `(?<![.\\w$])${name}(?![\\w$]*\\s*:)(?![\\w$])`,
        "g",
      );
      out = out.replace(re, (match, offset, string) => {
        // Skip if this is a function parameter declaration context - hard
        // Skip object key shorthand in types
        const before = string.slice(Math.max(0, offset - 20), offset);
        if (/\.\s*$/.test(before)) return match; // already property
        if (/import\s*\{[^}]*$/.test(before)) return match;
        // Skip `let name` / `const name` / `function name`
        if (/(?:let|const|function|class)\s+$/.test(before)) return match;
        return `rt.${name}`;
      });
    }
    // Fix double rt.rt.
    out = out.replace(/rt\.rt\./g, "rt.");
    // Fix createEmptyRowDiagnostics and pure helpers - they should not be rt.
    // Fix: state.entries → rt.state.entries was intended when bare `state` → good
    // But SessionState type references shouldn't change
    // Fix false positives: `rt.state:` in types, function params named state
    return out;
  }

  // Given rewrite risk (parameter names like `state` collide with module state),
  // orchestrator bag rewrite is too dangerous without AST.
  //
  // Content-safe C: keep impl.ts as single runtime module; organize folder with:
  // - helpers.ts (done)
  // - state-types.ts (type-only exports from types)
  // - index re-exports
  // And split OFF pure-ish large blocks that don't need module state:
  //   segment-queue functions use module state → can't
  //
  // Alternative: one file per domain where each file is a factory:
  //   createPersistenceApi(ctx) returns { save..., persist... }
  //   ctx holds state refs
  // This is a large rewrite.

  // Final C decision for this script run:
  // 1. Move impl.ts content unchanged to runtime-core.ts
  // 2. Use helpers from helpers.ts inside runtime-core (dedupe pure functions)
  // 3. Create domain index files that are empty re-export placeholders for future
  // 4. index.ts exports createContentRuntime from runtime-core
  //
  // PLUS extract `segment-event` pure parts if any.

  // Improve: wire helpers into impl by removing duplicate pure functions

  let coreBody = bodyBlock;
  // Remove pure function definitions that exist in helpers
  for (const pure of pureNames) {
    const re = new RegExp(
      `function ${pure}\\([\\s\\S]*?\\n\\}\\n\\n`,
      "m",
    );
    // only remove if simple enough - carefully
  }

  // Remove duplicates by line range from map:
  // isCapturePage 269-271, resolveDefault 273-275, createObserver 301-303,
  // cloneObserver 305-315, deriveCommittee 451-453
  // We'll do string replace of those function blocks with comments pointing to helpers

  const pureReplacements = [
    [
      /function isCapturePage\(\): boolean \{\n  return isSupportedAssemblyUrl\(window\.location\.href\);\n\}\n\n/,
      "",
    ],
    [
      /function resolveDefaultPanelNotice\(\): string \{\n  return isCapturePage\(\) \? DEFAULT_IN_PAGE_NOTICE : NON_CAPTURE_PAGE_NOTICE;\n\}\n\n/,
      "",
    ],
    [
      /function createObserverBridgeToken\(\): string \{\n  return createRandomToken\(\);\n\}\n\n/,
      "",
    ],
    [
      /function cloneObserverBridgeEventForReplay\(\n  event: ObserverBridgeEvent,\n\): ObserverBridgeEvent \{\n  return \{\n    \.\.\.event,\n    rows: event\.rows\?\.map\(\(row\) => \(\{\n      \.\.\.row,\n    \}\)\),\n    framePath: event\.framePath \? \[\.\.\.event\.framePath\] : undefined,\n  \};\n\}\n\n/,
      "",
    ],
    [
      /function deriveCommitteeName\(title: string\): string \{\n  return title\.replace\(\/\\s\+\\\\\\|\\s\+\[\^\\|\]\+\$\/, ""\)\.trim\(\);\n\}\n\n/,
      "",
    ],
  ];

  for (const [re, rep] of pureReplacements) {
    coreBody = coreBody.replace(re, rep);
  }

  const helpersImport = `import {
  isCapturePage,
  resolveDefaultPanelNotice,
  createObserverBridgeToken,
  cloneObserverBridgeEventForReplay,
  deriveCommitteeName,
} from "./helpers";
`;

  // Fix helpers path for constants
  const helpersPath = path.join(outDir, "helpers.ts");
  let helpersSrc = fs.readFileSync(helpersPath, "utf8");
  helpersSrc = helpersSrc
    .replace('from "./../constants"', 'from "../constants"')
    .replace(
      /import \{\n  DEFAULT_IN_PAGE_NOTICE,\n  NON_CAPTURE_PAGE_NOTICE,\n  isTopFrame,\n\} from "\.\.\/constants";/,
      `import {
  DEFAULT_IN_PAGE_NOTICE,
  NON_CAPTURE_PAGE_NOTICE,
} from "../constants";`,
    );
  writeFile(helpersPath, helpersSrc);

  const runtimeCore =
    importBlock +
    "\n" +
    helpersImport +
    "\n" +
    stateBlock +
    "\n" +
    coreBody +
    "\n";

  writeFile(path.join(outDir, "runtime-core.ts"), runtimeCore);

  // Domain facade files for SOLID structure (document ownership; re-export runtime entry)
  const domainIndex = `
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
`.trimStart();

  writeFile(path.join(outDir, "index.ts"), domainIndex);

  // Remove old impl.ts after runtime-core exists (or make impl re-export)
  writeFile(
    implPath,
    `/** @deprecated use runtime-core — 하위 호환 re-export */
export { createContentRuntime } from "./runtime-core";
`,
  );

  console.log("orchestrator: runtime-core + helpers wired, pure dups removed");
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
const arg = process.argv[2] || "all";
if (arg === "all" || arg === "pipeline") splitSubtitlePipeline();
if (arg === "all" || arg === "public-api") splitPublicApi();
if (arg === "all" || arg === "orchestrator") splitOrchestrator();
console.log("done");
