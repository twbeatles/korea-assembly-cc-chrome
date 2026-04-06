import {
  listLivePanelRows,
  type CaptureMode,
  type LiveCaptureLedger,
  type LivePanelRow,
} from "../../core/live-capture";
import {
  cloneEntry,
  cloneState,
  getSessionCharCount,
  toSessionRecord,
  type SessionRecord,
  type SessionState,
  type SubtitleEntry,
} from "../../core/subtitle-models";
import { buildCaptureDiagnostics } from "../../shared/capture-diagnostics";
import { isSupportedAssemblyUrl } from "../../shared/constants";
import type { PersistContext, StatusSnapshot } from "../../shared/message-types";
import {
  createPreparedEligibilitySnapshot,
  type PreparedEligibilitySnapshot,
} from "../autosave";
import { finalizeSession } from "../../core/subtitle-pipeline";
import {
  buildOutputEntriesFromPanelRows,
  filterPanelLiveRows,
  resolvePanelLiveRows,
} from "../panel-live-rows";
import type { ExtensionSettings } from "../../storage/types";

export interface PreparedOutputSnapshot {
  liveRows: LivePanelRow[];
  livePreviewText: string;
  outputEntries: SubtitleEntry[];
  eligibility: PreparedEligibilitySnapshot;
}

function getPanelLiveRows(
  liveCaptureLedger: LiveCaptureLedger,
  state: SessionState,
  sourceUrl: string,
  settings?: Partial<ExtensionSettings>,
): LivePanelRow[] {
  return filterPanelLiveRows(
    resolvePanelLiveRows({
      structuredRows: listLivePanelRows(liveCaptureLedger),
      entries: state.entries,
      captureMode: liveCaptureLedger.captureMode,
      sourceUrl,
    }),
    settings,
  );
}

export function resolveCurrentOutputEntries(
  liveCaptureLedger: LiveCaptureLedger,
  state: SessionState,
  sourceUrl: string,
  settings?: Partial<ExtensionSettings>,
  now = Date.now(),
): SubtitleEntry[] {
  const liveRows = getPanelLiveRows(liveCaptureLedger, state, sourceUrl, settings);
  if (liveRows.length > 0) {
    return buildOutputEntriesFromPanelRows(liveRows, now, settings);
  }
  return state.entries.map((entry) => cloneEntry(entry));
}

export function buildPreparedOutputSnapshot(
  liveCaptureLedger: LiveCaptureLedger,
  state: SessionState,
  sourceUrl: string,
  settings?: Partial<ExtensionSettings>,
  now = Date.now(),
): PreparedOutputSnapshot {
  const liveRows = getPanelLiveRows(liveCaptureLedger, state, sourceUrl, settings);
  const livePreviewText = liveCaptureLedger.previewText || state.previewText;
  const outputEntries =
    liveRows.length > 0
      ? buildOutputEntriesFromPanelRows(liveRows, now, settings)
      : resolveCurrentOutputEntries(liveCaptureLedger, state, sourceUrl, settings, now);

  return {
    liveRows,
    livePreviewText,
    outputEntries,
    eligibility: createPreparedEligibilitySnapshot({
      status: state.status,
      preparedEntryCount: outputEntries.length,
      previewText: state.previewText,
      livePreviewText,
      liveRowCount: liveRows.length,
    }),
  };
}

export function buildStatusSnapshot(
  currentUrl: string,
  liveCaptureLedger: LiveCaptureLedger,
  state: SessionState,
  settings: ExtensionSettings,
  persistContext: PersistContext,
  stopPersistInFlight: boolean,
  requiresReload = false,
): StatusSnapshot {
  const preparedOutput = buildPreparedOutputSnapshot(
    liveCaptureLedger,
    state,
    currentUrl,
    settings,
  );
  return {
    connected: isSupportedAssemblyUrl(currentUrl),
    requiresReload,
    status: state.status,
    sessionId: state.sessionId,
    title: state.title,
    committeeName: state.committeeName,
    sourceUrl: state.sourceUrl,
    subtitleCount: preparedOutput.outputEntries.length,
    charCount: getSessionCharCount(preparedOutput.outputEntries),
    previewText: preparedOutput.livePreviewText,
    recentEntries: preparedOutput.outputEntries.slice(-20),
    startedAt: state.startedAt,
    endedAt: state.endedAt,
    updatedAt: state.updatedAt,
    lastPersistedAt: state.lastPersistedAt,
    canPersistPreparedContent: preparedOutput.eligibility.canPersistPreparedContent,
    persistContext,
    stopPersistInFlight,
    observerActive: state.observerActive,
    currentSelector: state.currentSelector,
    currentFramePath: [...state.currentFramePath],
    diagnostics: buildCaptureDiagnostics({
      captureMode: liveCaptureLedger.captureMode,
      observerActive: state.observerActive,
      currentSelector: state.currentSelector,
      currentFramePath: state.currentFramePath,
    }),
  };
}

export function buildPreparedSessionState(
  liveCaptureLedger: LiveCaptureLedger,
  state: SessionState,
  sourceUrl: string,
  settings: ExtensionSettings,
  now = Date.now(),
): SessionState {
  const prepared = cloneState(state);
  prepared.entries = buildPreparedOutputSnapshot(
    liveCaptureLedger,
    state,
    sourceUrl,
    settings,
    now,
  ).outputEntries;
  return prepared;
}

export function buildPreparedSessionRecord(
  liveCaptureLedger: LiveCaptureLedger,
  state: SessionState,
  settings: ExtensionSettings,
  sourceUrl: string,
  persistedStatus: "running" | "saved" | "stopped",
  now = Date.now(),
): SessionRecord {
  const preparedState = buildPreparedSessionState(liveCaptureLedger, state, sourceUrl, settings, now);
  if (persistedStatus !== "stopped") {
    return toSessionRecord(preparedState, persistedStatus);
  }

  return toSessionRecord(finalizeSession(preparedState, now, settings).state, persistedStatus);
}

export function getCaptureMode(liveCaptureLedger: LiveCaptureLedger): CaptureMode {
  return liveCaptureLedger.captureMode;
}
