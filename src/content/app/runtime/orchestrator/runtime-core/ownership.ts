

import { claimCaptureOwnership, getChromeLocalOwnershipStorage, heartbeatCaptureOwnership, releaseCaptureOwnership } from "../../../../runtime/capture-ownership";

import { isTopFrame } from "../../constants";

import type { RuntimeCoreContext } from "./context";
import { clearCaptureOwnershipHeartbeat } from "./timers";

/** 다중 탭 수집 소유권 heartbeat (단일 책임: 소유권 유지). */
export function startCaptureOwnershipHeartbeat(ctx: RuntimeCoreContext): void {
  clearCaptureOwnershipHeartbeat(ctx);
  if (!isTopFrame || ctx.extensionContextInvalidated) {
    return;
  }
  ctx.captureOwnershipHeartbeatTimer = window.setInterval(() => {
    if (ctx.state.status !== "running" || ctx.extensionContextInvalidated) {
      clearCaptureOwnershipHeartbeat(ctx);
      return;
    }
    void heartbeatCaptureOwnership({
      storage: getChromeLocalOwnershipStorage(),
      ownerId: ctx.captureOwnerId,
      committeeName: ctx.state.committeeName,
      sessionId: ctx.state.sessionId,
    });
  }, 8_000);
}

export async function claimCaptureOwnershipForStart(ctx: RuntimeCoreContext): Promise<boolean> {
  if (!isTopFrame) {
    return false;
  }
  const claim = await claimCaptureOwnership({
    storage: getChromeLocalOwnershipStorage(),
    ownerId: ctx.captureOwnerId,
    committeeName: ctx.state.committeeName,
    sessionId: ctx.state.sessionId,
  });
  startCaptureOwnershipHeartbeat(ctx);
  return claim.foreignActive;
}

export async function releaseCaptureOwnershipForStop(ctx: RuntimeCoreContext): Promise<void> {
  clearCaptureOwnershipHeartbeat(ctx);
  if (!isTopFrame) {
    return;
  }
  await releaseCaptureOwnership({
    storage: getChromeLocalOwnershipStorage(),
    ownerId: ctx.captureOwnerId,
  });
}
