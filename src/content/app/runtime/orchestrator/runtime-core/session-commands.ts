

import { cloneEntry, type ExportFormat } from "../../../../../core/subtitle-models";

import { mapDownloadErrorMessage } from "../../../../../shared/download-errors";
import { applyPersistSuccess } from "../../../../autosave";

import { sendRuntimeMessage } from "../../../../../shared/chrome-api";
import { buildCopyText, copyTextToClipboard, selectCopyEntries } from "../../../../../shared/copy-utils";

import { clearAutoStartCooldown } from "../../../../runtime/autostart-cooldown";

import { clearFailedStoppedSessionGuard, rememberFailedStoppedSession } from "../../../../failed-stopped-session";

import { buildSegmentCapacityWarningNotice, resolveRuntimeSessionSegmentationThresholds, resolveSegmentCapacityWarning } from "../../../../runtime/segmentation-policy";

import { isTopFrame } from "../../constants";

import { deriveCommitteeName } from "../helpers";
import type { RuntimeCoreContext } from "./context";
import { reportRuntimeError, setPanelNotice } from "./notices";
import { syncUserInterfaces } from "./panel-status";
import { buildPreparedSessionState, buildVisibleOutputEntries, buildVisibleSessionRecord } from "./snapshots";
import { persistSessionRecord, scheduleRunningPersist } from "./persistence";
import { dispatchObserverConfig } from "./observer-bridge";
import { resetRuntimeState } from "./session-lifecycle";

/** 저장·내보내기·복사 등 사용자 명령 (단일 책임: 명령 실행). */
export async function saveCurrentSessionSnapshotUnlocked(ctx: RuntimeCoreContext): Promise<{
  saved: boolean;
  message?: string;
}> {
  if (!isTopFrame || buildVisibleOutputEntries(ctx).length === 0) {
    const message = "저장할 자막이 아직 없습니다.";
    setPanelNotice(ctx, message);
    return {
      saved: false,
      message,
    };
  }

  const record = buildVisibleSessionRecord(ctx, "saved");
  if (!record.entries.length) {
    const message = "저장할 자막이 아직 없습니다.";
    setPanelNotice(ctx, message);
    return {
      saved: false,
      message,
    };
  }

  try {
    const saved = await persistSessionRecord(ctx, record);
    if (ctx.failedStoppedSessionGuard.record?.id === saved.id) {
      ctx.failedStoppedSessionGuard = clearFailedStoppedSessionGuard();
    }
    ctx.state = applyPersistSuccess(ctx.state, saved.updatedAt);
    const message = "현재까지 모든 내용을 저장했습니다.";
    setPanelNotice(ctx, message);
    return {
      saved: true,
      message,
    };
  } catch (error) {
    if (ctx.state.status !== "running") {
      ctx.failedStoppedSessionGuard = rememberFailedStoppedSession(record, error);
    }
    reportRuntimeError(ctx, "세션 저장에 실패했습니다.", error);
    throw error;
  }
}

export async function saveCurrentSessionSnapshot(ctx: RuntimeCoreContext): Promise<{
  saved: boolean;
  message?: string;
}> {
  return ctx.captureLifecycleLock.run("save", () => saveCurrentSessionSnapshotUnlocked(ctx));
}

export async function saveAndStartNewSession(ctx: RuntimeCoreContext): Promise<void> {
  return ctx.captureLifecycleLock.run("save_and_new", async () => {
  if (ctx.state.status !== "running") {
    setPanelNotice(ctx, "수집 중일 때만 중간 저장 후 새 세션을 시작할 수 있습니다.");
    syncUserInterfaces(ctx);
    return;
  }

  const result = await saveCurrentSessionSnapshotUnlocked(ctx);
  if (!result.saved) {
    syncUserInterfaces(ctx);
    return;
  }

  resetRuntimeState(ctx);
  ctx.lastSegmentCapacityWarningReason = null;
  clearAutoStartCooldown(isTopFrame);
  const now = new Date().toISOString();
  ctx.state.status = "running";
  ctx.state.createdAt = now;
  ctx.state.startedAt = now;
  ctx.state.updatedAt = now;
  ctx.state.title = document.title;
  ctx.state.committeeName = deriveCommitteeName(document.title);
  setPanelNotice(ctx, "중간 저장을 마치고 새 세션으로 계속 수집합니다.");
  dispatchObserverConfig(ctx);
  syncUserInterfaces(ctx);
  });
}

export function maybeEmitSegmentCapacityWarning(ctx: RuntimeCoreContext, now = Date.now()): void {
  const warning = resolveSegmentCapacityWarning(
    ctx.state,
    now,
    resolveRuntimeSessionSegmentationThresholds(ctx.settings),
  );
  if (!warning) {
    if (ctx.lastSegmentCapacityWarningReason) {
      ctx.lastSegmentCapacityWarningReason = null;
    }
    return;
  }
  if (ctx.lastSegmentCapacityWarningReason === warning) {
    return;
  }
  ctx.lastSegmentCapacityWarningReason = warning;
  setPanelNotice(ctx, buildSegmentCapacityWarningNotice(warning));
}

export async function highlightLatestCommittedEntry(ctx: RuntimeCoreContext): Promise<void> {
  const latestEntry = ctx.state.entries[ctx.state.entries.length - 1];
  if (!latestEntry) {
    setPanelNotice(ctx, "중요 표시할 확정 자막이 아직 없습니다.");
    syncUserInterfaces(ctx);
    return;
  }

  if (latestEntry.highlighted) {
    setPanelNotice(ctx, "최신 확정 자막은 이미 중요 표시되어 있습니다.");
    syncUserInterfaces(ctx);
    return;
  }

  const now = new Date().toISOString();
  ctx.state = {
    ...ctx.state,
    updatedAt: now,
    entries: ctx.state.entries.map((entry) =>
      entry.id === latestEntry.id
        ? { ...cloneEntry(entry), highlighted: true }
        : entry,
    ),
  };
  setPanelNotice(ctx, "최신 확정 자막을 중요 표시했습니다.");

  if (ctx.state.status === "running") {
    scheduleRunningPersist(ctx);
    syncUserInterfaces(ctx);
    return;
  }

  try {
    const saved = await persistSessionRecord(ctx, 
      buildVisibleSessionRecord(ctx, "stopped"),
    );
    ctx.state = applyPersistSuccess(ctx.state, saved.updatedAt);
  } catch (error) {
    reportRuntimeError(ctx, "중요 표시 저장에 실패했습니다.", error);
  }
  syncUserInterfaces(ctx);
}

export async function exportCurrentSession(ctx: RuntimeCoreContext, format: ExportFormat): Promise<void> {
  return ctx.captureLifecycleLock.run("export", () => exportCurrentSessionUnlocked(ctx, format));
}

export async function exportCurrentSessionUnlocked(ctx: RuntimeCoreContext, format: ExportFormat): Promise<void> {
  const record = buildVisibleSessionRecord(ctx, 
    ctx.state.status === "running" ? "running" : "stopped",
  );
  if (!record.entries.length) {
    setPanelNotice(ctx, "먼저 자막을 모은 뒤 파일로 저장하세요.");
    syncUserInterfaces(ctx);
    return;
  }

  const saved = await persistSessionRecord(ctx, record);
  ctx.state = applyPersistSuccess(ctx.state, saved.updatedAt);
  const response = await sendRuntimeMessage({
    type: "DOWNLOAD_SESSION_EXPORT",
    sessionId: record.id,
    format,
    filenamePattern: ctx.settings.filenamePattern,
    txtExportTimestampsEnabled: ctx.settings.txtExportTimestampsEnabled,
    txtExportSpeakerEnabled: ctx.settings.txtExportSpeakerEnabled,
    txtExportEntryNotesEnabled: ctx.settings.txtExportEntryNotesEnabled,
  });
  if (!response.ok) {
    throw new Error(
      mapDownloadErrorMessage(response.error, "single-session") ||
        "파일 저장을 시작하지 못했습니다.",
    );
  }
  setPanelNotice(ctx, `${format.toUpperCase()} 파일 저장 창을 열었습니다.`);
  syncUserInterfaces(ctx);
}

export async function copyRecentSessionLines(ctx: RuntimeCoreContext): Promise<void> {
  const prepared = buildPreparedSessionState(ctx);
  // 실시간 세션에는 speakerLabels 맵이 없으므로 entry channel/label 만 사용
  const copyOptions = {
    limit: ctx.settings.recentCopyLineCount,
    includeSpeaker: ctx.settings.txtExportSpeakerEnabled,
  };
  const copiedEntries = selectCopyEntries(prepared.entries, copyOptions);
  const copyText = buildCopyText(prepared.entries, copyOptions);

  if (!copyText) {
    setPanelNotice(ctx, "복사할 자막이 아직 없습니다.");
    syncUserInterfaces(ctx);
    return;
  }

  await copyTextToClipboard(copyText);
  setPanelNotice(ctx, `최근 ${copiedEntries.length}줄을 복사했습니다.`);
  syncUserInterfaces(ctx);
}

export async function openHistoryPage(ctx: RuntimeCoreContext): Promise<void> {
  const response = await sendRuntimeMessage({ type: "OPEN_HISTORY_PAGE" });
  if (!response.ok) {
    throw new Error(response.error);
  }
  setPanelNotice(ctx, "저장된 기록 화면을 열었습니다.");
  syncUserInterfaces(ctx);
}

export async function openOptionsPage(ctx: RuntimeCoreContext): Promise<void> {
  const response = await sendRuntimeMessage({ type: "OPEN_OPTIONS_PAGE" });
  if (!response.ok) {
    throw new Error(response.error);
  }
  setPanelNotice(ctx, "환경 설정 화면을 열었습니다.");
  syncUserInterfaces(ctx);
}

export async function openDiagnosticsPage(ctx: RuntimeCoreContext): Promise<void> {
  const response = await sendRuntimeMessage({ type: "OPEN_DIAGNOSTICS_PAGE" });
  if (!response.ok) {
    throw new Error(response.error);
  }
  setPanelNotice(ctx, "상태 확인 화면을 열었습니다.");
  syncUserInterfaces(ctx);
}
