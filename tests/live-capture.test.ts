import { describe, expect, it } from "vitest";

import {
  createEmptyLiveCaptureLedger,
  getLiveRow,
  markLiveRowCommitted,
  normalizeCaptureEvent,
  reconcileLiveCapture,
  setLiveRowBaseline,
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
    expect(second.rowChanges).toHaveLength(1);
    expect(second.rowChanges[0].isNew).toBe(false);
    expect(getLiveRow(second.ledger, second.liveRows[0].key)?.committedEntryId).toBe("entry_1");
    expect(getLiveRow(second.ledger, second.liveRows[0].key)?.baselineCompact).toBe("기준이력");
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
  });
});
