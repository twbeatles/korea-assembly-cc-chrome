/**
 * 세그먼트 롤오버 진단 스냅샷 (runtime-core 에서 분리한 순수 헬퍼).
 */
import type { SegmentRolloverDiagnostics } from "../../shared/message-types";

export function buildSegmentRolloverDiagnostics(input: {
  inFlight: boolean;
  queueSize: number;
  queueMax: number;
  droppedTotal: number;
}): SegmentRolloverDiagnostics {
  return {
    inFlight: Boolean(input.inFlight),
    queueSize: Math.max(0, Math.floor(input.queueSize)),
    queueMax: Math.max(1, Math.floor(input.queueMax)),
    droppedTotal: Math.max(0, Math.floor(input.droppedTotal)),
  };
}
