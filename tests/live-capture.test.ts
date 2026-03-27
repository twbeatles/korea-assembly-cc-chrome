import { describe, expect, it } from "vitest";

import {
  createEmptyLiveCaptureLedger,
  getLiveRow,
  listLivePanelRows,
  markLiveRowCommitted,
  normalizeCaptureEvent,
  reconcileLiveCapture,
  setLiveRowBaseline,
  syncLiveRowOutputEntry,
} from "../src/core/live-capture";
describe("live capture reducer", () => {
  it("keeps the same live row key when a row is corrected", () => {
    let ledger = createEmptyLiveCaptureLedger();

    const first = reconcileLiveCapture(
      ledger,
      normalizeCaptureEvent({
        raw: "첫 문장",
        rows: [
          {
            nodeKey: "row_1",
            text: "첫 문장",
            speakerColor: "rgb(35, 124, 147)",
            speakerChannel: "primary",
            unstableKey: false,
          },
        ],
        framePath: [],
        timestamp: 1,
      }),
    );
    ledger = setLiveRowBaseline(first.ledger, first.liveRows[0].key, "기준이력");
    ledger = markLiveRowCommitted(ledger, first.liveRows[0].key, "entry_1");

    const second = reconcileLiveCapture(
      ledger,
      normalizeCaptureEvent({
        raw: "첫 문장 수정",
        rows: [
          {
            nodeKey: "row_1",
            text: "첫 문장 수정",
            speakerColor: "rgb(35, 124, 147)",
            speakerChannel: "primary",
            unstableKey: false,
          },
        ],
        framePath: [],
        timestamp: 2,
      }),
    );

    expect(second.liveRows).toHaveLength(1);
    expect(second.liveRows[0].key).toBe(first.liveRows[0].key);
    expect(second.liveRows[0].startTime).toBe("1970-01-01T00:00:00.001Z");
    expect(second.liveRows[0].endTime).toBe("1970-01-01T00:00:00.002Z");
    expect(second.rowChanges).toHaveLength(1);
    expect(second.rowChanges[0].isNew).toBe(false);
    expect(getLiveRow(second.ledger, second.liveRows[0].key)?.committedEntryId).toBe("entry_1");
    expect(getLiveRow(second.ledger, second.liveRows[0].key)?.baselineCompact).toBe("기준이력");
  });

  it("syncs canonical entry metadata back into the live row after commit", () => {
    const first = reconcileLiveCapture(
      createEmptyLiveCaptureLedger(),
      normalizeCaptureEvent({
        raw: "첫 문장",
        rows: [
          {
            nodeKey: "row_1",
            text: "첫 문장",
            speakerColor: "rgb(35, 124, 147)",
            speakerChannel: "primary",
            unstableKey: false,
          },
        ],
        framePath: [1],
        timestamp: 1000,
      }),
    );

    const synced = syncLiveRowOutputEntry(first.ledger, first.liveRows[0].key, {
      id: "entry_1",
      text: "첫 문장 보정",
      timestamp: "2026-03-20T08:00:01.000Z",
      startTime: "2026-03-20T08:00:01.000Z",
      endTime: "2026-03-20T08:00:05.000Z",
      sourceSelector: "#viewSubtit .smi_word",
      sourceFramePath: [1],
      sourceNodeKey: "1::row_1",
      speakerColor: "rgb(35, 124, 147)",
      speakerChannel: "primary",
    });

    expect(getLiveRow(synced, first.liveRows[0].key)).toEqual(
      expect.objectContaining({
        text: "첫 문장 보정",
        entryId: "entry_1",
        committedEntryId: "entry_1",
        timestamp: "2026-03-20T08:00:01.000Z",
        startTime: "2026-03-20T08:00:01.000Z",
        endTime: "2026-03-20T08:00:05.000Z",
        sourceSelector: "#viewSubtit .smi_word",
        sourceFramePath: [1],
        sourceNodeKey: "1::row_1",
      }),
    );
    expect(listLivePanelRows(synced)[0]).toEqual(
      expect.objectContaining({
        entryId: "entry_1",
        startTime: "2026-03-20T08:00:01.000Z",
        endTime: "2026-03-20T08:00:05.000Z",
        sourceFramePath: [1],
      }),
    );
  });

  it("clears only the active live rows when fallback preview is used", () => {
    const structured = reconcileLiveCapture(
      createEmptyLiveCaptureLedger(),
      normalizeCaptureEvent({
        raw: "현재 row",
        rows: [
          {
            nodeKey: "row_1",
            text: "현재 row",
            speakerColor: "rgb(35, 124, 147)",
            speakerChannel: "primary",
            unstableKey: false,
          },
        ],
        framePath: [],
        timestamp: 10,
      }),
    );

    const fallback = reconcileLiveCapture(structured.ledger, {
      ...normalizeCaptureEvent({
        raw: "fallback preview",
        framePath: [],
        timestamp: 11,
      }),
      rows: [],
      captureMode: "fallback",
    });

    expect(fallback.liveRows).toHaveLength(0);
    expect(fallback.ledger.activeRowKeys).toHaveLength(0);
    expect(fallback.ledger.previewText).toBe("fallback preview");
    expect(getLiveRow(fallback.ledger, structured.liveRows[0].key)?.text).toBe("현재 row");
    expect(listLivePanelRows(fallback.ledger)).toEqual([
      {
        ...structured.liveRows[0],
      },
    ]);
  });

  it("keeps all rows when the live ledger is unbounded", () => {
    let ledger = createEmptyLiveCaptureLedger();
    const totalRows = 480;

    for (let i = 0; i < totalRows; i += 1) {
      ledger = reconcileLiveCapture(
        ledger,
        normalizeCaptureEvent({
          raw: `문장-${i}`,
          rows: [
            {
              nodeKey: `row_${i}`,
              text: `문장-${i}`,
              speakerColor: "rgb(35, 124, 147)",
              speakerChannel: "primary",
              unstableKey: false,
            },
          ],
          framePath: [],
          timestamp: i + 1,
        }),
      ).ledger;
    }

    expect(ledger.order.length).toBe(totalRows);
    expect(ledger.activeRowKeys).toHaveLength(1);
    expect(getLiveRow(ledger, "top::row_0")?.text).toBe("문장-0");
    expect(getLiveRow(ledger, `top::row_${totalRows - 1}`)?.text).toBe(`문장-${totalRows - 1}`);
  });
});
