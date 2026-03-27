import type { SpeakerChannel, SubtitleEntry } from "./subtitle-models";
import { normalizeSubtitleText } from "./text-normalizer";
import type { ObservedSubtitleRow } from "../shared/message-types";
import { PIPELINE_DEFAULTS } from "../shared/constants";

export type CaptureMode = "idle" | "structured" | "fallback";

export interface LivePanelRow {
  key: string;
  text: string;
  nodeKey: string;
  entryId: string | null;
  timestamp: string;
  startTime: string;
  endTime: string;
  sourceSelector?: string;
  sourceFramePath?: number[];
  sourceNodeKey: string;
  speakerColor: string;
  speakerChannel: SpeakerChannel;
  updatedAt: number;
}

export interface LiveCaptureRow extends LivePanelRow {
  framePath: number[];
  selector?: string;
  unstableKey: boolean;
  firstSeenAt: number;
  committedEntryId: string | null;
  baselineCompact: string | null;
}

export interface LiveCaptureLedger {
  rows: Record<string, LiveCaptureRow>;
  order: string[];
  activeRowKeys: string[];
  previewText: string;
  captureMode: CaptureMode;
}

export interface NormalizedCaptureEvent {
  previewText: string;
  rows: ObservedSubtitleRow[];
  selector?: string;
  framePath: number[];
  timestamp: number;
  captureMode: CaptureMode;
}

export interface LiveRowChange {
  key: string;
  row: LiveCaptureRow;
  isNew: boolean;
  textChanged: boolean;
}

export interface LiveCaptureReconciliation {
  ledger: LiveCaptureLedger;
  changed: boolean;
  rowChanges: LiveRowChange[];
  liveRows: LivePanelRow[];
  activeRow: LiveCaptureRow | null;
}

function cloneRow(row: LiveCaptureRow): LiveCaptureRow {
  return {
    ...row,
    framePath: [...row.framePath],
    sourceFramePath: row.sourceFramePath ? [...row.sourceFramePath] : undefined,
  };
}

function cloneOptionalFramePath(framePath?: number[]): number[] | undefined {
  return framePath ? [...framePath] : undefined;
}

function toIsoTimestamp(value: number): string {
  return new Date(value).toISOString();
}

export function resolveLiveRowUpdatedAt(
  entry: Pick<SubtitleEntry, "endTime" | "timestamp" | "startTime">,
): number {
  const endTime = Date.parse(entry.endTime || "");
  if (Number.isFinite(endTime)) {
    return endTime;
  }

  const timestamp = Date.parse(entry.timestamp || "");
  if (Number.isFinite(timestamp)) {
    return timestamp;
  }

  const startTime = Date.parse(entry.startTime || "");
  return Number.isFinite(startTime) ? startTime : 0;
}

export function createLivePanelRowFromEntry(
  entry: SubtitleEntry,
  key = `entry::${entry.id}`,
): LivePanelRow {
  return {
    key,
    text: entry.text,
    nodeKey: entry.sourceNodeKey || entry.id,
    entryId: entry.id,
    timestamp: entry.timestamp,
    startTime: entry.startTime,
    endTime: entry.endTime,
    sourceSelector: entry.sourceSelector,
    sourceFramePath: cloneOptionalFramePath(entry.sourceFramePath),
    sourceNodeKey: entry.sourceNodeKey || entry.id,
    speakerColor: entry.speakerColor || "",
    speakerChannel: entry.speakerChannel || "unknown",
    updatedAt: resolveLiveRowUpdatedAt(entry),
  };
}

function toLivePanelRow(row: LiveCaptureRow): LivePanelRow {
  return {
    key: row.key,
    text: row.text,
    nodeKey: row.nodeKey,
    entryId: row.entryId,
    timestamp: row.timestamp,
    startTime: row.startTime,
    endTime: row.endTime,
    sourceSelector: row.sourceSelector,
    sourceFramePath: cloneOptionalFramePath(row.sourceFramePath),
    sourceNodeKey: row.sourceNodeKey,
    speakerColor: row.speakerColor,
    speakerChannel: row.speakerChannel,
    updatedAt: row.updatedAt,
  };
}

function sameKeyOrder(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function pruneLedgerRows(
  rows: Record<string, LiveCaptureRow>,
  order: string[],
  activeRowKeys: string[],
  maxRows: number,
): { rows: Record<string, LiveCaptureRow>; order: string[] } {
  if (order.length <= maxRows) {
    return { rows, order };
  }

  const keepKeys = new Set<string>(activeRowKeys);
  for (let index = order.length - 1; index >= 0 && keepKeys.size < maxRows; index -= 1) {
    const key = order[index];
    if (rows[key]) {
      keepKeys.add(key);
    }
  }

  const nextOrder = order.filter((key) => keepKeys.has(key));
  const nextRows: Record<string, LiveCaptureRow> = {};
  nextOrder.forEach((key) => {
    const row = rows[key];
    if (row) {
      nextRows[key] = row;
    }
  });

  return {
    rows: nextRows,
    order: nextOrder,
  };
}

export function buildLiveRowKey(nodeKey: string, framePath: number[] = []): string {
  const path = framePath.length ? framePath.join(".") : "top";
  return `${path}::${nodeKey}`;
}

export function createEmptyLiveCaptureLedger(): LiveCaptureLedger {
  return {
    rows: {},
    order: [],
    activeRowKeys: [],
    previewText: "",
    captureMode: "idle",
  };
}

export function clearLiveCaptureLedger(): LiveCaptureLedger {
  return createEmptyLiveCaptureLedger();
}

export function normalizeCaptureEvent(input: {
  raw?: string;
  rows?: ObservedSubtitleRow[];
  selector?: string;
  framePath?: number[];
  timestamp: number;
}): NormalizedCaptureEvent {
  const rows = (input.rows ?? []).filter((row) => normalizeSubtitleText(row.text));
  const previewFromRows = rows
    .map((row) => normalizeSubtitleText(row.text))
    .filter(Boolean)
    .join(" ")
    .trim();
  const previewText = normalizeSubtitleText(input.raw ?? "") || previewFromRows;

  return {
    previewText,
    rows,
    selector: input.selector,
    framePath: input.framePath ? [...input.framePath] : [],
    timestamp: input.timestamp,
    captureMode: rows.length ? "structured" : "fallback",
  };
}

export function setFallbackCapturePreview(
  ledger: LiveCaptureLedger,
  previewText: string,
): LiveCaptureLedger {
  const pruned = pruneLedgerRows(
    ledger.rows,
    ledger.order,
    [],
    PIPELINE_DEFAULTS.liveLedgerMaxRows,
  );

  return {
    ...ledger,
    rows: pruned.rows,
    order: pruned.order,
    activeRowKeys: [],
    previewText,
    captureMode: previewText ? "fallback" : "idle",
  };
}

export function getLiveRow(
  ledger: LiveCaptureLedger,
  key: string,
): LiveCaptureRow | null {
  const row = ledger.rows[key];
  return row ? cloneRow(row) : null;
}

export function listLivePanelRows(ledger: LiveCaptureLedger): LivePanelRow[] {
  return ledger.order
    .map((key) => ledger.rows[key])
    .filter((row): row is LiveCaptureRow => Boolean(row))
    .map(toLivePanelRow);
}

export function setLiveRowBaseline(
  ledger: LiveCaptureLedger,
  key: string,
  baselineCompact: string,
): LiveCaptureLedger {
  const existing = ledger.rows[key];
  if (!existing || existing.baselineCompact === baselineCompact) {
    return ledger;
  }

  return {
    ...ledger,
    rows: {
      ...ledger.rows,
      [key]: {
        ...existing,
        baselineCompact,
      },
    },
  };
}

export function markLiveRowCommitted(
  ledger: LiveCaptureLedger,
  key: string,
  entryId: string,
): LiveCaptureLedger {
  const existing = ledger.rows[key];
  if (!existing || existing.committedEntryId === entryId) {
    return ledger;
  }

  return {
    ...ledger,
    rows: {
      ...ledger.rows,
      [key]: {
        ...existing,
        entryId,
        committedEntryId: entryId,
      },
    },
  };
}

export function syncLiveRowOutputEntry(
  ledger: LiveCaptureLedger,
  key: string,
  entry: SubtitleEntry,
): LiveCaptureLedger {
  const existing = ledger.rows[key];
  if (!existing) {
    return ledger;
  }

  const nextUpdatedAt = resolveLiveRowUpdatedAt(entry) || existing.updatedAt;
  const nextSourceFramePath = cloneOptionalFramePath(entry.sourceFramePath);
  const nextSourceFramePathSignature = JSON.stringify(nextSourceFramePath ?? []);
  const currentSourceFramePathSignature = JSON.stringify(existing.sourceFramePath ?? []);
  const nextRow: LiveCaptureRow = {
    ...existing,
    text: entry.text,
    entryId: entry.id,
    timestamp: entry.timestamp,
    startTime: entry.startTime,
    endTime: entry.endTime,
    sourceSelector: entry.sourceSelector,
    sourceFramePath: nextSourceFramePath,
    sourceNodeKey: entry.sourceNodeKey || existing.sourceNodeKey || key,
    speakerColor: entry.speakerColor ?? existing.speakerColor,
    speakerChannel: entry.speakerChannel ?? existing.speakerChannel,
    updatedAt: nextUpdatedAt,
    committedEntryId: entry.id,
  };

  if (
    existing.text === nextRow.text &&
    existing.entryId === nextRow.entryId &&
    existing.timestamp === nextRow.timestamp &&
    existing.startTime === nextRow.startTime &&
    existing.endTime === nextRow.endTime &&
    existing.sourceSelector === nextRow.sourceSelector &&
    currentSourceFramePathSignature === nextSourceFramePathSignature &&
    existing.sourceNodeKey === nextRow.sourceNodeKey &&
    existing.speakerColor === nextRow.speakerColor &&
    existing.speakerChannel === nextRow.speakerChannel &&
    existing.updatedAt === nextRow.updatedAt &&
    existing.committedEntryId === nextRow.committedEntryId
  ) {
    return ledger;
  }

  return {
    ...ledger,
    rows: {
      ...ledger.rows,
      [key]: nextRow,
    },
  };
}

export function reconcileLiveCapture(
  ledger: LiveCaptureLedger,
  event: NormalizedCaptureEvent,
): LiveCaptureReconciliation {
  if (!event.rows.length) {
    const nextLedger = setFallbackCapturePreview(ledger, event.previewText);
    return {
      ledger: nextLedger,
      changed:
        nextLedger.previewText !== ledger.previewText ||
        nextLedger.captureMode !== ledger.captureMode ||
        !sameKeyOrder(nextLedger.activeRowKeys, ledger.activeRowKeys),
      rowChanges: [],
      liveRows: [],
      activeRow: null,
    };
  }

  const nextRows = { ...ledger.rows };
  const nextOrder = [...ledger.order];
  const nextActiveRowKeys: string[] = [];
  const rowChanges: LiveRowChange[] = [];

  event.rows.forEach((row) => {
    const text = normalizeSubtitleText(row.text);
    if (!text) {
      return;
    }

    const key = buildLiveRowKey(row.nodeKey, event.framePath);
    nextActiveRowKeys.push(key);
    const previous = nextRows[key];

    if (!previous) {
      const timestamp = toIsoTimestamp(event.timestamp);
      const nextRow: LiveCaptureRow = {
        key,
        nodeKey: row.nodeKey,
        text,
        entryId: null,
        timestamp,
        startTime: timestamp,
        endTime: timestamp,
        sourceSelector: event.selector,
        sourceFramePath: cloneOptionalFramePath(
          event.framePath.length ? event.framePath : undefined,
        ),
        sourceNodeKey: key,
        speakerColor: row.speakerColor,
        speakerChannel: row.speakerChannel,
        updatedAt: event.timestamp,
        firstSeenAt: event.timestamp,
        framePath: [...event.framePath],
        selector: event.selector,
        unstableKey: row.unstableKey,
        committedEntryId: null,
        baselineCompact: null,
      };
      nextRows[key] = nextRow;
      nextOrder.push(key);
      rowChanges.push({
        key,
        row: cloneRow(nextRow),
        isNew: true,
        textChanged: true,
      });
      return;
    }

    const textChanged =
      previous.text !== text ||
      previous.speakerColor !== row.speakerColor ||
      previous.speakerChannel !== row.speakerChannel;

    const nextRow: LiveCaptureRow = {
      ...previous,
      text,
      endTime: toIsoTimestamp(event.timestamp),
      sourceSelector: event.selector,
      sourceFramePath: cloneOptionalFramePath(
        event.framePath.length ? event.framePath : undefined,
      ),
      sourceNodeKey: key,
      speakerColor: row.speakerColor,
      speakerChannel: row.speakerChannel,
      updatedAt: event.timestamp,
      framePath: [...event.framePath],
      selector: event.selector,
      unstableKey: row.unstableKey,
    };
    nextRows[key] = nextRow;

    if (textChanged) {
      rowChanges.push({
        key,
        row: cloneRow(nextRow),
        isNew: false,
        textChanged: true,
      });
    }
  });

  const pruned = pruneLedgerRows(
    nextRows,
    nextOrder,
    nextActiveRowKeys,
    PIPELINE_DEFAULTS.liveLedgerMaxRows,
  );

  const nextLedger: LiveCaptureLedger = {
    rows: pruned.rows,
    order: pruned.order,
    activeRowKeys: nextActiveRowKeys,
    previewText: event.previewText,
    captureMode: "structured",
  };

  const liveRows = nextActiveRowKeys
    .map((key) => nextLedger.rows[key])
    .filter((row): row is LiveCaptureRow => Boolean(row))
    .map(toLivePanelRow);

  const activeRowKey = nextActiveRowKeys.at(-1);
  const activeRow = activeRowKey ? cloneRow(nextLedger.rows[activeRowKey]) : null;

  const changed =
    rowChanges.length > 0 ||
    nextLedger.previewText !== ledger.previewText ||
    nextLedger.captureMode !== ledger.captureMode ||
    !sameKeyOrder(nextLedger.activeRowKeys, ledger.activeRowKeys);

  return {
    ledger: nextLedger,
    changed,
    rowChanges,
    liveRows,
    activeRow,
  };
}
