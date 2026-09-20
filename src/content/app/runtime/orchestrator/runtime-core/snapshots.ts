
import { applyPreview } from "../../../../../core/subtitle-pipeline";

import { cloneState, type SessionRecord, type SessionState } from "../../../../../core/subtitle-models";

import { hasPersistableRunningContent } from "../../../../autosave";

import type { PersistabilityState } from "../../../../../shared/message-types";

import { buildPreparedSessionRecord as buildPreparedSessionRecordFromState, buildPreparedSessionState as buildPreparedSessionStateFromState, buildVisibleOutputEntries as buildVisibleOutputEntriesFromEntries, buildVisibleSessionRecord as buildVisibleSessionRecordFromState } from "../../../../runtime/session-records";

import { resolvePreviewPersistabilityState } from "../../../../persistability";

import type { RuntimeCoreContext } from "./context";
import { getLivePreviewText } from "./panel-status";

/** 저장·출력용 세션 스냅샷 조립 (단일 책임: 스냅샷 의미론). */
export function canPersistCurrentRunningState(ctx: RuntimeCoreContext): boolean {
  return hasPersistableRunningContent(ctx.state);
}

export function buildPreparedSessionState(ctx: RuntimeCoreContext, now = Date.now()): SessionState {
  return buildPreparedSessionStateFromState(ctx.state, ctx.settings, now);
}

export function buildVisibleOutputEntries(ctx: RuntimeCoreContext, now = Date.now()) {
  void now;
  return buildVisibleOutputEntriesFromEntries(ctx.state.entries);
}

export function buildVisibleSessionRecord(ctx: RuntimeCoreContext, 
  persistedStatus: "running" | "saved" | "stopped",
  now = Date.now(),
): SessionRecord {
  return buildVisibleSessionRecordFromState(
    ctx.state,
    ctx.settings,
    persistedStatus,
    getLivePreviewText(ctx),
    now,
  );
}

export function buildPreparedSessionRecord(ctx: RuntimeCoreContext, 
  persistedStatus: "running" | "saved" | "stopped",
  now = Date.now(),
): SessionRecord {
  return buildPreparedSessionRecordFromState(
    ctx.state,
    ctx.settings,
    persistedStatus,
    now,
  );
}

export function resolvePreviewPersistability(ctx: RuntimeCoreContext, 
  previewText: string,
  now: number,
): PersistabilityState {
  if (!previewText.trim()) {
    return "idle";
  }

  const previewResult = applyPreview(
    cloneState(ctx.state),
    previewText,
    now,
    ctx.settings,
    {
      selector: ctx.state.currentSelector || undefined,
      framePath: ctx.state.currentFramePath.length
        ? ctx.state.currentFramePath
        : undefined,
    },
  );

  return resolvePreviewPersistabilityState(previewResult.reason);
}
