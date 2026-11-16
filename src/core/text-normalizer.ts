const ZERO_WIDTH_RE = /\u200b|\u200c|\u200d|\ufeff/g;
// 공유 공백 규칙 (parity `whitespace`): JS `\s`(U+FEFF 포함)에 Python 이 공백으로 보는
// U+001C–U+001F·U+0085 를 더한 집합. 데스크톱 `strip_subtitle_whitespace` 와 같은 집합이다.
/* eslint-disable no-control-regex -- U+001C–U+001F 는 parity 계약 whitespace.extraSeparators 에 따라 의도적으로 공백으로 본다. */
const MULTI_SPACE_RE = /[\s\x1c-\x1f\x85]+/g;
const LEADING_SPACE_RE = /^[\s\x1c-\x1f\x85]+/;
const TRAILING_SPACE_RE = /[\s\x1c-\x1f\x85]+$/;
/* eslint-enable no-control-regex */

export function trimSubtitleWhitespaceStart(text: string): string {
  return String(text ?? "").replace(LEADING_SPACE_RE, "");
}

export function trimSubtitleWhitespaceEnd(text: string): string {
  return String(text ?? "").replace(TRAILING_SPACE_RE, "");
}

export function trimSubtitleWhitespace(text: string): string {
  return trimSubtitleWhitespaceEnd(trimSubtitleWhitespaceStart(text));
}

export function stripZeroWidth(text: string): string {
  return text.replace(ZERO_WIDTH_RE, "");
}

export function cleanDisplayText(text: string): string {
  return stripZeroWidth(String(text ?? ""))
    .replace(/\r/g, "\n")
    .replace(/\n+/g, "\n")
    .replace(/\t+/g, " ")
    .replace(LEADING_SPACE_RE, "")
    .replace(TRAILING_SPACE_RE, "");
}

export function normalizeSubtitleText(text: string): string {
  if (!text) {
    return "";
  }

  return trimSubtitleWhitespace(
    cleanDisplayText(text).replace(MULTI_SPACE_RE, " "),
  );
}

export function compactSubtitleText(text: string): string {
  if (!text) {
    return "";
  }

  return stripZeroWidth(String(text ?? "")).replace(MULTI_SPACE_RE, "");
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
  const left = trimSubtitleWhitespaceEnd(base);
  const right = trimSubtitleWhitespaceStart(addition);

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
    '"',
    "'",
    "”",
    "’",
    "…",
  ]);
  const noSpaceAfter = new Set(["(", "[", "{", "<", '"', "'", "“", "‘"]);

  if (noSpaceBefore.has(right[0]) || noSpaceAfter.has(left[left.length - 1])) {
    return `${left}${right}`;
  }

  return `${left} ${right}`;
}
