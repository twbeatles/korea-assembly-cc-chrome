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
  lastSeenAt: number;
  observationCount: number;
  token: number;
}
