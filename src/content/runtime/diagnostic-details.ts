import { exportJson } from "../../core/exporters/json";
import { normalizeSessionForExport } from "../../core/exporters/normalize-session";
import { exportSrt } from "../../core/exporters/srt";
import { exportTxt } from "../../core/exporters/txt";
import { exportVtt } from "../../core/exporters/vtt";
import {
  getSessionCharCount,
  resolveSessionLineageId,
  resolveSessionSegmentNumber,
  type SessionState,
} from "../../core/subtitle-models";
import type { ExtensionSettings } from "../../storage/types";
import type {
  ExportEstimateDiagnostics,
  SegmentDiagnostics,
} from "../../shared/message-types";
import { buildPreparedSessionRecord } from "./session-records";
import { resolveRuntimeSessionSegmentationThresholds } from "./segmentation-policy";

const textEncoder = new TextEncoder();
let lastExportEstimateCacheKey = "";
let lastExportEstimateCacheValue: ExportEstimateDiagnostics | null = null;

function getUtf8ByteLength(text: string): number {
  return textEncoder.encode(text).length;
}

function resolveSegmentElapsedMs(state: SessionState, now = Date.now()): number | null {
  if (!state.startedAt) {
    return null;
  }

  const startedAtMs = Date.parse(state.startedAt);
  if (!Number.isFinite(startedAtMs)) {
    return null;
  }

  const endedAtMs =
    state.status === "running"
      ? now
      : Date.parse(state.endedAt ?? state.updatedAt ?? state.startedAt);
  if (!Number.isFinite(endedAtMs)) {
    return null;
  }

  return Math.max(0, endedAtMs - startedAtMs);
}

export function buildSegmentDiagnostics(
  state: SessionState,
  settings: Pick<
    ExtensionSettings,
    "maxEntriesPerSegment" | "maxCharsPerSegment" | "maxSegmentDurationMinutes"
  >,
  now = Date.now(),
): SegmentDiagnostics {
  const thresholds = resolveRuntimeSessionSegmentationThresholds(settings);
  const elapsedMs = resolveSegmentElapsedMs(state, now);
  const charCount = getSessionCharCount(state.entries);

  return {
    lineageId: resolveSessionLineageId(state.sessionId, state.lineageId),
    segmentNumber: resolveSessionSegmentNumber(state.segmentNumber),
    entryCount: state.entries.length,
    charCount,
    elapsedMs,
    maxEntriesPerSegment: thresholds.maxEntriesPerSegment,
    maxCharsPerSegment: thresholds.maxCharsPerSegment,
    maxDurationMs: thresholds.maxDurationMs,
    remainingEntries: Math.max(0, thresholds.maxEntriesPerSegment - state.entries.length),
    remainingChars: Math.max(0, thresholds.maxCharsPerSegment - charCount),
    remainingDurationMs:
      elapsedMs === null ? null : Math.max(0, thresholds.maxDurationMs - elapsedMs),
  };
}

export function buildExportEstimateDiagnostics(
  state: SessionState,
  settings: ExtensionSettings,
  now = Date.now(),
): ExportEstimateDiagnostics {
  const cacheKey = [
    state.sessionId,
    state.status,
    state.updatedAt ?? "",
    state.endedAt ?? "",
    state.entries.length,
    settings.txtExportTimestampsEnabled ? "1" : "0",
  ].join("|");
  if (cacheKey === lastExportEstimateCacheKey && lastExportEstimateCacheValue) {
    return {
      ...lastExportEstimateCacheValue,
    };
  }

  if (!state.entries.length) {
    const emptyEstimates = {
      txtBytes: 0,
      srtBytes: 0,
      vttBytes: 0,
      jsonBytes: 0,
      txtIncludesTimestamps: settings.txtExportTimestampsEnabled,
    };
    lastExportEstimateCacheKey = cacheKey;
    lastExportEstimateCacheValue = emptyEstimates;
    return {
      ...emptyEstimates,
    };
  }

  const prepared = buildPreparedSessionRecord(
    state,
    settings,
    state.status === "stopped" ? "stopped" : "saved",
    now,
  );
  const normalized = normalizeSessionForExport(prepared);

  const estimates = {
    txtBytes: getUtf8ByteLength(
      exportTxt(normalized, {
        includeTimestamps: settings.txtExportTimestampsEnabled,
      }),
    ),
    srtBytes: getUtf8ByteLength(exportSrt(normalized)),
    vttBytes: getUtf8ByteLength(exportVtt(normalized)),
    jsonBytes: getUtf8ByteLength(exportJson(normalized)),
    txtIncludesTimestamps: settings.txtExportTimestampsEnabled,
  };
  lastExportEstimateCacheKey = cacheKey;
  lastExportEstimateCacheValue = estimates;
  return {
    ...estimates,
  };
}
