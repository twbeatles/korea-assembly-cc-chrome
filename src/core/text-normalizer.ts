const ZERO_WIDTH_RE = /\u200b|\u200c|\u200d|\ufeff/g;
const MULTI_SPACE_RE = /\s+/g;

export function stripZeroWidth(text: string): string {
  return text.replace(ZERO_WIDTH_RE, "");
}

export function cleanDisplayText(text: string): string {
  return stripZeroWidth(String(text ?? ""))
    .replace(/\r/g, "\n")
    .replace(/\n+/g, "\n")
    .replace(/\t+/g, " ")
    .trim();
}

export function normalizeSubtitleText(text: string): string {
  if (!text) {
    return "";
  }

  return cleanDisplayText(text).replace(MULTI_SPACE_RE, " ").trim();
}

export function compactSubtitleText(text: string): string {
  if (!text) {
    return "";
  }

  return stripZeroWidth(String(text ?? "")).replace(MULTI_SPACE_RE, "").trim();
}

export function normalizeRawText(raw: string): string {
  return normalizeSubtitleText(raw);
}

export function extractTailLines(text: string, maxLines = 3): string {
  const lines = cleanDisplayText(text)
    .split("\n")
    .map((line) => normalizeSubtitleText(line))
    .filter(Boolean);

  if (!lines.length) {
    return "";
  }

  return lines.slice(-maxLines).join(" ");
}

export function joinStreamText(base: string, addition: string): string {
  const left = String(base ?? "").trimEnd();
  const right = String(addition ?? "").trimStart();

  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }

  const noSpaceBefore = new Set([
    ".",
    ",",
    "!",
    "?",
    ";",
    ":",
    ")",
    "]",
    "}",
    "%",
    "\"",
    "'",
    "”",
    "’",
    "…",
  ]);
  const noSpaceAfter = new Set(["(", "[", "{", "<", "\"", "'", "“", "‘"]);

  if (noSpaceBefore.has(right[0]) || noSpaceAfter.has(left[left.length - 1])) {
    return `${left}${right}`;
  }

  return `${left} ${right}`;
}
