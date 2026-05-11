import { compactSubtitleText } from "../core/text-normalizer";
import type { DomProbeResult } from "./dom-probe";
import type { ObservedSubtitleRow } from "../shared/message-types";

export function buildObservedRowsSignature(rows: ObservedSubtitleRow[]): string {
  if (!rows.length) {
    return "";
  }

  return rows
    .map(
      (row) =>
        `${row.nodeKey}|${compactSubtitleText(row.text)}|${row.speakerColor}|${row.speakerChannel}|${row.unstableKey ? "1" : "0"}|${row.nodeKeySource ?? ""}`,
    )
    .join("||");
}

export function buildLocalProbeSignature(probe: Pick<DomProbeResult, "text" | "rows">): string {
  const compact = compactSubtitleText(probe.text);
  if (!compact) {
    return "";
  }

  return probe.rows?.length ? buildObservedRowsSignature(probe.rows) : compact;
}

export function shouldEmitLocalProbeUpdate(
  previousSignature: string,
  probe: Pick<DomProbeResult, "text" | "rows">,
): { shouldEmit: boolean; signature: string } {
  const signature = buildLocalProbeSignature(probe);
  if (!signature || signature === previousSignature) {
    return {
      shouldEmit: false,
      signature,
    };
  }

  return {
    shouldEmit: true,
    signature,
  };
}
