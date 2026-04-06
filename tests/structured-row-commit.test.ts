import { describe, expect, it } from "vitest";

import {
  createEmptyLiveCaptureLedger,
  getLiveRow,
  markLiveRowCommitted,
  normalizeCaptureEvent,
  reconcileLiveCapture,
  setLiveRowBaseline,
} from "../src/core/live-capture";
import { applyStructuredEntry } from "../src/core/subtitle-pipeline";
import { createEmptySessionState } from "../src/core/subtitle-models";
import { commitStructuredLiveRow } from "../src/content/bootstrap/structured-row-commit";

describe("structured row commit", () => {
  it("updates a stable row against its original baseline as the row grows", () => {
    let state = createEmptySessionState("http://test.com", "Test");
    const base = Date.parse("2026-04-06T09:00:00.000Z");

    state = applyStructuredEntry(
      state,
      "지금 국제전쟁은 이제는 단순히 옛날처럼",
      "지금 국제전쟁은 이제는 단순히 옛날처럼",
      base,
      undefined,
      { sourceNodeKey: "top::row_1" },
    ).state;

    let ledger = reconcileLiveCapture(
      createEmptyLiveCaptureLedger(),
      normalizeCaptureEvent({
        raw: "지금 국제전쟁은 이제는 단순히 옛날처럼 과거 재래전처럼",
        rows: [
          {
            nodeKey: "row_2",
            text: "지금 국제전쟁은 이제는 단순히 옛날처럼 과거 재래전처럼",
            speakerColor: "rgb(35, 124, 147)",
            speakerChannel: "primary",
            unstableKey: false,
          },
        ],
        framePath: [],
        timestamp: base + 1000,
      }),
    ).ledger;

    const firstRow = getLiveRow(ledger, "top::row_2");
    expect(firstRow).toBeTruthy();

    const firstCommit = commitStructuredLiveRow({
      state,
      row: firstRow!,
      previewText: firstRow!.text,
      now: base + 1000,
    });

    expect(firstCommit.state.entries).toHaveLength(2);
    expect(firstCommit.state.entries[1].text).toBe("과거 재래전처럼");

    ledger = setLiveRowBaseline(ledger, "top::row_2", firstCommit.baselineCompact ?? "");
    ledger = markLiveRowCommitted(ledger, "top::row_2", firstCommit.entry!.id);
    ledger = reconcileLiveCapture(
      ledger,
      normalizeCaptureEvent({
        raw: "지금 국제전쟁은 이제는 단순히 옛날처럼 과거 재래전처럼 이렇게 사람들이 직접 참여하는 육박전",
        rows: [
          {
            nodeKey: "row_2",
            text: "지금 국제전쟁은 이제는 단순히 옛날처럼 과거 재래전처럼 이렇게 사람들이 직접 참여하는 육박전",
            speakerColor: "rgb(35, 124, 147)",
            speakerChannel: "primary",
            unstableKey: false,
          },
        ],
        framePath: [],
        timestamp: base + 2000,
      }),
    ).ledger;

    const secondRow = getLiveRow(ledger, "top::row_2");
    expect(secondRow).toBeTruthy();

    const secondCommit = commitStructuredLiveRow({
      state: firstCommit.state,
      row: secondRow!,
      previewText: secondRow!.text,
      now: base + 2000,
    });

    expect(secondCommit.state.entries).toHaveLength(2);
    expect(secondCommit.state.entries[1].text).toBe(
      "과거 재래전처럼 이렇게 사람들이 직접 참여하는 육박전",
    );
  });

  it("treats unstable row key reuse as a new committed entry", () => {
    let state = createEmptySessionState("http://test.com", "Test");
    const base = Date.parse("2026-04-06T09:05:00.000Z");

    let ledger = reconcileLiveCapture(
      createEmptyLiveCaptureLedger(),
      normalizeCaptureEvent({
        raw: "위원님 말씀",
        rows: [
          {
            nodeKey: "slot:1",
            text: "위원님 말씀",
            speakerColor: "rgb(35, 124, 147)",
            speakerChannel: "primary",
            unstableKey: true,
          },
        ],
        framePath: [],
        timestamp: base,
      }),
    ).ledger;

    const firstRow = getLiveRow(ledger, "top::slot:1");
    const firstCommit = commitStructuredLiveRow({
      state,
      row: firstRow!,
      previewText: firstRow!.text,
      now: base,
    });
    expect(firstCommit.state.entries).toHaveLength(1);
    expect(firstCommit.state.entries[0].text).toBe("위원님 말씀");

    ledger = setLiveRowBaseline(ledger, "top::slot:1", firstCommit.baselineCompact ?? "");
    ledger = markLiveRowCommitted(ledger, "top::slot:1", firstCommit.entry!.id);
    ledger = reconcileLiveCapture(
      ledger,
      normalizeCaptureEvent({
        raw: "위원님 말씀 이어서 다음 문장",
        rows: [
          {
            nodeKey: "slot:1",
            text: "위원님 말씀 이어서 다음 문장",
            speakerColor: "rgb(35, 124, 147)",
            speakerChannel: "primary",
            unstableKey: true,
          },
        ],
        framePath: [],
        timestamp: base + 1000,
      }),
    ).ledger;

    const secondRow = getLiveRow(ledger, "top::slot:1");
    const secondCommit = commitStructuredLiveRow({
      state: firstCommit.state,
      row: secondRow!,
      previewText: secondRow!.text,
      now: base + 1000,
    });

    expect(secondCommit.state.entries).toHaveLength(2);
    expect(secondCommit.state.entries[0].text).toBe("위원님 말씀");
    expect(secondCommit.state.entries[1].text).toBe("이어서 다음 문장");
  });

  it("filters placeholder rows before they become committed entries", () => {
    const state = createEmptySessionState("http://test.com", "Test");
    const ledger = reconcileLiveCapture(
      createEmptyLiveCaptureLedger(),
      normalizeCaptureEvent({
        raw: "로딩중..",
        rows: [
          {
            nodeKey: "row_1",
            text: "로딩중..",
            speakerColor: "rgb(35, 124, 147)",
            speakerChannel: "primary",
            unstableKey: false,
          },
        ],
        framePath: [],
        timestamp: 1,
      }),
    ).ledger;

    const row = getLiveRow(ledger, "top::row_1");
    const result = commitStructuredLiveRow({
      state,
      row: row!,
      previewText: row!.text,
      now: 1,
    });

    expect(result.changed).toBe(false);
    expect(result.entry).toBeNull();
    expect(result.state.entries).toHaveLength(0);
  });
});
