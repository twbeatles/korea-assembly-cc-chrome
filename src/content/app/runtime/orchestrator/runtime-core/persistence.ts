

import { type SessionRecord } from "../../../../../core/subtitle-models";

import { applyPersistSuccess, resolveRunningPersistDelayMs, scheduleRunningPersistTimer, shouldPersistFinalSession, shouldScheduleRunningPersist, type RunningPersistTrigger } from "../../../../autosave";

import { sendRuntimeMessage } from "../../../../../shared/chrome-api";

import { isExtensionContextInvalidatedError } from "../../../../../shared/extension-context";
import type { BackgroundCommandResponse } from "../../../../../shared/message-types";

import { clearFailedStoppedSessionGuard, rememberFailedStoppedSession } from "../../../../failed-stopped-session";

import { queueExitPersistRecord, recordPageExitPersistAttempt } from "../../../../../storage/persist-recovery";

import { persistQueuedPageExitRecord } from "../../../../page-exit-persist";

import { INVALIDATED_CONTEXT_NOTICE, isTopFrame } from "../../constants";

import type { RuntimeCoreContext } from "./context";
import { clearRunningPersistTimer } from "./timers";
import { reportRuntimeError, setPanelNotice } from "./notices";
import { syncUserInterfaces } from "./panel-status";
import { buildPreparedSessionRecord, canPersistCurrentRunningState } from "./snapshots";

/** running/stopped 스냅샷 저장과 autosave 스케줄 (단일 책임: 영속화). */
export async function persistSessionRecord(ctx: RuntimeCoreContext, 
  record: SessionRecord,
): Promise<SessionRecord> {
  const response = await sendRuntimeMessage({
    type: "PERSIST_SESSION_RECORD",
    record,
  });
  if (!response.ok) {
    throw new Error(response.error);
  }

  return {
    ...record,
    updatedAt: response.updatedAt ?? record.updatedAt,
  };
}

export async function deletePersistedSession(ctx: RuntimeCoreContext, sessionId: string): Promise<void> {
  const response = await sendRuntimeMessage({
    type: "DELETE_SESSION_RECORD",
    sessionId,
  });
  if (!response.ok) {
    throw new Error(response.error);
  }
}

export async function persistStoppedSession(ctx: RuntimeCoreContext, record: SessionRecord): Promise<void> {
  if (!shouldPersistFinalSession(isTopFrame, record.entries.length)) {
    try {
      await deletePersistedSession(ctx, record.id);
      ctx.failedStoppedSessionGuard = clearFailedStoppedSessionGuard();
      ctx.state.lastPersistedAt = null;
    } catch (error) {
      reportRuntimeError(ctx, "빈 종료 세션 정리에 실패했습니다.", error);
    }
    return;
  }

  try {
    const saved = await persistSessionRecord(ctx, record);
    ctx.failedStoppedSessionGuard = clearFailedStoppedSessionGuard();
    ctx.state = applyPersistSuccess(ctx.state, saved.updatedAt);
    setPanelNotice(ctx, "모든 자막을 저장했습니다.");
  } catch (error) {
    ctx.failedStoppedSessionGuard = rememberFailedStoppedSession(record, error);
    reportRuntimeError(ctx, "종료된 세션 저장에 실패했습니다.", error);
  }
}

export function persistSessionRecordInBackground(ctx: RuntimeCoreContext, 
  record: SessionRecord,
  retryAttempt = 0,
  trackPageExitDiagnostics = false,
): void {
  if (ctx.extensionContextInvalidated) {
    return;
  }

  const maxRetryAttempts = 1;

  const handlePersistFailure = (message: string, detail?: unknown): void => {
    if (isExtensionContextInvalidatedError(detail)) {
      reportRuntimeError(ctx, INVALIDATED_CONTEXT_NOTICE, detail);
      return;
    }

    if (retryAttempt < maxRetryAttempts) {
      persistSessionRecordInBackground(ctx, 
        record,
        retryAttempt + 1,
        trackPageExitDiagnostics,
      );
      return;
    }

    if (trackPageExitDiagnostics) {
      void recordPageExitPersistAttempt(record, detail ?? message).catch(() => {
        // Preserve the original background persist failure.
      });
    }

    if (document.visibilityState === "visible") {
      reportRuntimeError(ctx, message, detail);
      return;
    }

    console.warn(
      "[assembly-subtitle] Background session persist failed",
      message,
      detail,
    );
  };

  try {
    chrome.runtime.sendMessage(
      {
        type: "PERSIST_SESSION_RECORD",
        record,
      },
      (response?: BackgroundCommandResponse) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          handlePersistFailure(
            "백그라운드 세션 저장 요청이 실패했습니다.",
            lastError.message,
          );
          return;
        }

        if (!response?.ok) {
          handlePersistFailure(
            response?.error || "백그라운드 세션 저장에 실패했습니다.",
            response,
          );
          return;
        }

        if (record.status === "running" && ctx.state.sessionId === record.id) {
          ctx.state = applyPersistSuccess(
            ctx.state,
            response.updatedAt ?? record.updatedAt,
          );
          if (document.visibilityState === "visible") {
            syncUserInterfaces(ctx);
          }
        }
      },
    );
  } catch (error) {
    handlePersistFailure("백그라운드 세션 저장 전송이 실패했습니다.", error);
  }
}

export function queueExitPersistRecordInBackground(ctx: RuntimeCoreContext, record: SessionRecord): void {
  if (ctx.extensionContextInvalidated) {
    return;
  }

  try {
    chrome.runtime.sendMessage(
      {
        type: "QUEUE_EXIT_PERSIST_RECORD",
        record,
      },
      (response?: BackgroundCommandResponse) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          console.warn(
            "[assembly-subtitle] Background queued exit persist request failed",
            lastError.message,
          );
          return;
        }

        if (!response?.ok) {
          console.warn(
            "[assembly-subtitle] Background queued exit persist request was rejected",
            response,
          );
        }
      },
    );
  } catch (error) {
    console.warn(
      "[assembly-subtitle] Failed to queue exit persist record in background",
      error,
    );
  }
}

export function persistRunningSnapshotForVisibilityChange(ctx: RuntimeCoreContext, 
  now = Date.now(),
  options: { respectAutoSaveSetting?: boolean } = {},
): void {
  if (
    ctx.extensionContextInvalidated ||
    !isTopFrame ||
    !canPersistCurrentRunningState(ctx)
  ) {
    return;
  }

  // Page-exit (pagehide) snapshots must persist regardless of the autosave
  // toggle so the user does not silently lose work when the tab closes.
  // Routine visibility-hidden snapshots, however, should respect the user's
  // autosave preference.
  if (
    options.respectAutoSaveSetting !== false &&
    !ctx.settings.runningAutoSaveEnabled
  ) {
    return;
  }

  if (now - ctx.lastNavigationSnapshotAt < 250) {
    return;
  }

  clearRunningPersistTimer(ctx);
  const record = buildPreparedSessionRecord(ctx, "running", now);
  if (!record.entries.length) {
    return;
  }

  ctx.lastNavigationSnapshotAt = now;
  persistSessionRecordInBackground(ctx, record);
}

export function persistStoppedSnapshotForPageExit(ctx: RuntimeCoreContext, now = Date.now()): void {
  if (
    ctx.extensionContextInvalidated ||
    !isTopFrame ||
    !canPersistCurrentRunningState(ctx)
  ) {
    return;
  }

  clearRunningPersistTimer(ctx);
  const record = buildPreparedSessionRecord(ctx, "stopped", now);
  if (!record.entries.length) {
    return;
  }

  void persistQueuedPageExitRecord(record, {
    queueRecord: queueExitPersistRecord,
    queueRecordInBackground: (queuedRecord) => {
      queueExitPersistRecordInBackground(ctx, queuedRecord);
    },
    persistRecordInBackground: (queuedRecord) => {
      persistSessionRecordInBackground(ctx, queuedRecord, 0, true);
    },
    onPersistAttempt: (queuedRecord) =>
      recordPageExitPersistAttempt(queuedRecord),
    onPersistAttemptError: (error) => {
      console.warn(
        "[assembly-subtitle] Failed to record page-exit persist attempt",
        error,
      );
    },
    onQueueError: (error) => {
      void recordPageExitPersistAttempt(record, error).catch(() => {
        // The original page-exit failure is already logged below.
      });
      console.warn(
        "[assembly-subtitle] Failed to queue exit persist record",
        error,
      );
    },
  });
}

export function scheduleRunningPersist(ctx: RuntimeCoreContext, 
  trigger: RunningPersistTrigger = "commit",
  now = Date.now(),
): void {
  if (ctx.extensionContextInvalidated) {
    clearRunningPersistTimer(ctx);
    return;
  }

  if (!shouldScheduleRunningPersist(isTopFrame, ctx.state, ctx.settings)) {
    clearRunningPersistTimer(ctx);
    return;
  }

  if (trigger === "commit") {
    if (ctx.pendingRunningPersistTrigger !== "commit") {
      ctx.pendingRunningPersistSince = now;
    }
    ctx.pendingRunningPersistTrigger = "commit";
  } else if (ctx.pendingRunningPersistTrigger === null) {
    ctx.pendingRunningPersistSince = now;
    ctx.pendingRunningPersistTrigger = "keepalive";
  }

  const effectiveTrigger = ctx.pendingRunningPersistTrigger ?? trigger;
  const delayMs = resolveRunningPersistDelayMs({
    trigger: effectiveTrigger,
    now,
    pendingSince:
      effectiveTrigger === "commit" ? ctx.pendingRunningPersistSince : null,
    lastPersistedAt: ctx.state.lastPersistedAt,
    settings: ctx.settings,
  });

  if (delayMs === null) {
    if (effectiveTrigger === "keepalive") {
      ctx.pendingRunningPersistSince = null;
      ctx.pendingRunningPersistTrigger = null;
    }
    return;
  }

  ctx.persistTimer = scheduleRunningPersistTimer({
    currentTimer: ctx.persistTimer,
    delayMs,
    shouldSchedule: true,
    clearTimer: (timerId) => window.clearTimeout(timerId),
    setTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
    getSnapshot: () => ({
      status: ctx.state.status,
      record: buildPreparedSessionRecord(ctx, "running"),
    }),
    persistRecord: (record) => persistSessionRecord(ctx, record),
    onPersisted: (saved) => {
      ctx.persistTimer = null;
      ctx.pendingRunningPersistSince = null;
      ctx.pendingRunningPersistTrigger = null;
      ctx.state = applyPersistSuccess(ctx.state, saved.updatedAt);
      syncUserInterfaces(ctx);
    },
    onError: (error) => {
      ctx.persistTimer = null;
      ctx.pendingRunningPersistSince = null;
      ctx.pendingRunningPersistTrigger = null;
      reportRuntimeError(ctx, "수집 중 세션 저장에 실패했습니다.", error);
    },
  });
}
