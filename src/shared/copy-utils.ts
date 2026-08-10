import { normalizeEntriesForOutput } from "../core/output-normalizer";
import {
  formatSpeakerPrefix,
  resolveSpeakerLabelForOutput,
  type SpeakerLabelsSource,
} from "../core/exporters/speaker-label";
import type { SubtitleEntry } from "../core/subtitle-models";
import { formatClockTime } from "../core/timeline";

export interface BuildCopyTextOptions {
  limit?: number;
  query?: string;
  selectedIds?: string[];
  /** true 이면 `[시간] [발언자 A] 본문` 형태 */
  includeSpeaker?: boolean;
  session?: SpeakerLabelsSource | null;
}

function normalizeQuery(query: string): string {
  return query.trim().toLocaleLowerCase();
}

export function filterEntriesByQuery(entries: SubtitleEntry[], query = ""): SubtitleEntry[] {
  const normalizedQuery = normalizeQuery(query);
  if (!normalizedQuery) {
    return [...entries];
  }

  return entries.filter((entry) =>
    entry.text.toLocaleLowerCase().includes(normalizedQuery),
  );
}

export function filterEntriesByIds(
  entries: SubtitleEntry[],
  selectedIds: string[] = [],
): SubtitleEntry[] {
  if (!selectedIds.length) {
    return [...entries];
  }

  const selectedIdSet = new Set(selectedIds);
  return entries.filter((entry) => selectedIdSet.has(entry.id));
}

function formatCopyLine(
  entry: SubtitleEntry,
  options: Pick<BuildCopyTextOptions, "includeSpeaker" | "session"> = {},
): string {
  const timestamp = formatClockTime(entry.startTime || entry.timestamp);
  const speakerPrefix =
    options.includeSpeaker === true
      ? formatSpeakerPrefix(resolveSpeakerLabelForOutput(entry, options.session))
      : "";
  return `[${timestamp}] ${speakerPrefix}${entry.text}`;
}

export function selectCopyEntries(
  entries: SubtitleEntry[],
  options: BuildCopyTextOptions = {},
): SubtitleEntry[] {
  const normalizedEntries = normalizeEntriesForOutput(entries, {
    stripSpeakerMetadata: options.includeSpeaker !== true,
  });
  const selectedEntries = filterEntriesByIds(normalizedEntries, options.selectedIds);
  const filteredEntries = filterEntriesByQuery(selectedEntries, options.query);
  return typeof options.limit === "number" && options.limit > 0
    ? filteredEntries.slice(-options.limit)
    : filteredEntries;
}

export function buildCopyText(
  entries: SubtitleEntry[],
  options: BuildCopyTextOptions = {},
): string {
  return selectCopyEntries(entries, options)
    .map((entry) => formatCopyLine(entry, options))
    .join("\n")
    .trim();
}

export async function copyTextToClipboard(text: string): Promise<void> {
  const normalized = String(text ?? "");
  if (!normalized.trim()) {
    throw new Error("복사할 텍스트가 없습니다.");
  }

  const clipboard = globalThis.navigator?.clipboard;
  if (clipboard?.writeText) {
    await clipboard.writeText(normalized);
    return;
  }

  if (typeof document === "undefined" || !document.body) {
    throw new Error("클립보드 API를 사용할 수 없습니다.");
  }

  const textarea = document.createElement("textarea");
  textarea.value = normalized;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  try {
    const succeeded = document.execCommand("copy");
    if (!succeeded) {
      throw new Error("텍스트 복사에 실패했습니다.");
    }
  } finally {
    textarea.remove();
  }
}
