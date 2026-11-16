import type { RowKeySource } from "../../../shared/message-types";

export interface RowDiagnosticsState {
  stableRowCount: number;
  unstableRowCount: number;
  filteredUnconfirmedCount: number;
  rowKeySources: Partial<Record<RowKeySource, number>>;
}

export interface FallbackCommitCandidate {
  raw: string;
  selector?: string;
  framePath?: number[];
  firstSeenAt: number;
  /** 후보가 다른 raw 로 바뀌어도 유지되는 첫 미확정 관측 시각 (최대 대기 상한 기준). */
  pendingSince: number;
  lastSeenAt: number;
  observationCount: number;
  token: number;
}
