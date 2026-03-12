import type { SubtitleEntry } from "../core/subtitle-models";
import { formatClockTime } from "../core/timeline";

export interface BuildCopyTextOptions {
  limit?: number;
  query?: string;
  selectedIds?: string[];
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

function formatCopyLine(entry: SubtitleEntry): string {
  const timestamp = formatClockTime(entry.startTime || entry.timestamp);
  return `[${timestamp}] ${entry.text}`;
}

export function buildCopyText(
  entries: SubtitleEntry[],
  options: BuildCopyTextOptions = {},
): string {
  const selectedEntries = filterEntriesByIds(entries, options.selectedIds);
  const filteredEntries = filterEntriesByQuery(selectedEntries, options.query);
  const limitedEntries =
    typeof options.limit === "number" && options.limit > 0
      ? filteredEntries.slice(-options.limit)
      : filteredEntries;

  return limitedEntries.map(formatCopyLine).join("\n").trim();
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
