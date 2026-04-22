import type { CaptureMode } from "../../core/live-capture";
import { getSessionCharCount, type SessionState } from "../../core/subtitle-models";
import { buildCaptureDiagnostics } from "../../shared/capture-diagnostics";
import { isSupportedAssemblyUrl } from "../../shared/constants";
import type { PersistabilityState, StatusSnapshot } from "../../shared/message-types";
import type { ExtensionSettings } from "../../storage/types";
import {
  buildPersistabilityDiagnostics,
  type PersistabilityDiagnostics,
} from "../persistability";
import {
  buildExportEstimateDiagnostics,
  buildSegmentDiagnostics,
} from "./diagnostic-details";

interface ResolvePersistabilityDiagnosticsOptions {
  status: SessionState["status"];
  entryCount: number;
  livePreviewText: string;
  latestPersistabilityState: PersistabilityState;
}

interface BuildContentStatusSnapshotOptions {
  currentUrl: string;
  sessionState: SessionState;
  settings: ExtensionSettings;
  captureMode: CaptureMode;
  livePreviewTextRaw: string;
  livePreviewTextForDisplay: string;
  latestPersistabilityState: PersistabilityState;
  requiresReload?: boolean;
}

interface CanClearCurrentSessionStateOptions {
  status: SessionState["status"];
  entryCount: number;
  livePreviewText: string;
  showNotice: boolean;
}

export function resolveContentPersistabilityDiagnostics(
  options: ResolvePersistabilityDiagnosticsOptions,
): PersistabilityDiagnostics {
  const {
    status,
    entryCount,
    livePreviewText,
    latestPersistabilityState,
  } = options;

  if (status !== "running") {
    return buildPersistabilityDiagnostics(entryCount > 0 ? "persistable" : "idle");
  }

  if (latestPersistabilityState !== "idle") {
    return buildPersistabilityDiagnostics(latestPersistabilityState);
  }

  if (entryCount > 0) {
    return buildPersistabilityDiagnostics("persistable");
  }

  if (livePreviewText.trim()) {
    return buildPersistabilityDiagnostics("preview_only");
  }

  return buildPersistabilityDiagnostics("idle");
}

export function buildContentStatusSnapshot(
  options: BuildContentStatusSnapshotOptions,
): StatusSnapshot {
  const {
    currentUrl,
    sessionState,
    settings,
    captureMode,
    livePreviewTextRaw,
    livePreviewTextForDisplay,
    latestPersistabilityState,
    requiresReload = false,
  } = options;
  const persistability = resolveContentPersistabilityDiagnostics({
    status: sessionState.status,
    entryCount: sessionState.entries.length,
    livePreviewText: livePreviewTextRaw,
    latestPersistabilityState,
  });

  return {
    connected: isSupportedAssemblyUrl(currentUrl),
    requiresReload,
    status: sessionState.status,
    sessionId: sessionState.sessionId,
    title: sessionState.title,
    committeeName: sessionState.committeeName,
    sourceUrl: sessionState.sourceUrl,
    subtitleCount: sessionState.entries.length,
    charCount: getSessionCharCount(sessionState.entries),
    previewText: livePreviewTextForDisplay,
    recentEntries: sessionState.entries.slice(-20),
    startedAt: sessionState.startedAt,
    endedAt: sessionState.endedAt,
    updatedAt: sessionState.updatedAt,
    lastPersistedAt: sessionState.lastPersistedAt,
    observerActive: sessionState.observerActive,
    currentSelector: sessionState.currentSelector,
    currentFramePath: [...sessionState.currentFramePath],
    diagnostics: buildCaptureDiagnostics({
      captureMode,
      observerActive: sessionState.observerActive,
      currentSelector: sessionState.currentSelector,
      currentFramePath: sessionState.currentFramePath,
      persistabilityState: persistability.state,
      persistabilityHint: persistability.hint,
      segment: buildSegmentDiagnostics(sessionState, settings),
      exportEstimates: buildExportEstimateDiagnostics(sessionState, settings),
    }),
    hasPersistableContent: sessionState.entries.length > 0,
  };
}

export function canClearCurrentSessionState(
  options: CanClearCurrentSessionStateOptions,
): boolean {
  const {
    status,
    entryCount,
    livePreviewText,
    showNotice,
  } = options;
  return status === "running" || entryCount > 0 || Boolean(livePreviewText.trim()) || showNotice;
}
