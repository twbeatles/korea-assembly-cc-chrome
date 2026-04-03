import { cleanDisplayText } from "./text-normalizer";

// Meaningful-language detection is intentionally limited to Korean and English for now.
const LANGUAGE_RE = /[가-힣A-Za-z]/;
const NUMERIC_ONLY_RE = /^[\d\s.,:;+\-*/()%]+$/;
const SYMBOL_ONLY_RE = /^[\W_]+$/u;
const PLACEHOLDER_PUNCTUATION_RE = /[.\u2026!?,~·:\-_/()[\]{}"'`]/g;
const PLACEHOLDER_TEXT_SET = new Set(["로딩중", "loading"]);

export function normalizeForNoiseCheck(text: string): string {
  return cleanDisplayText(text).replace(/\s+/g, " ").trim();
}

export function hasLanguageCharacters(text: string): boolean {
  return LANGUAGE_RE.test(text);
}

export function isNumericOnly(text: string): boolean {
  const normalized = normalizeForNoiseCheck(text);
  return Boolean(normalized) && NUMERIC_ONLY_RE.test(normalized);
}

export function isSymbolOnly(text: string): boolean {
  const normalized = normalizeForNoiseCheck(text);
  return Boolean(normalized) && SYMBOL_ONLY_RE.test(normalized);
}

export function isShortLanguageUtterance(text: string): boolean {
  const normalized = normalizeForNoiseCheck(text);
  if (!normalized || !hasLanguageCharacters(normalized)) {
    return false;
  }

  const compact = normalized.replace(/\s+/g, "");
  return compact.length <= 2;
}

export function isPlaceholderSubtitleText(text: string): boolean {
  const normalized = normalizeForNoiseCheck(text);
  if (!normalized) {
    return false;
  }

  const compact = normalized
    .replace(PLACEHOLDER_PUNCTUATION_RE, "")
    .replace(/\s+/g, "")
    .trim()
    .toLowerCase();

  return PLACEHOLDER_TEXT_SET.has(compact);
}

export function isNoiseOnly(text: string): boolean {
  const normalized = normalizeForNoiseCheck(text);
  if (!normalized) {
    return true;
  }

  if (hasLanguageCharacters(normalized)) {
    return false;
  }

  if (isNumericOnly(normalized) || isSymbolOnly(normalized)) {
    return true;
  }

  // Mixed digit/symbol fragments such as "123_456" are also treated as noise.
  return true;
}

export function isMeaningfulSubtitleText(text: string): boolean {
  const normalized = normalizeForNoiseCheck(text);
  if (!normalized) {
    return false;
  }

  if (isShortLanguageUtterance(normalized)) {
    return true;
  }

  return !isNoiseOnly(normalized);
}

export function hasRequiredSubtitleContent(text: string): boolean {
  const normalized = normalizeForNoiseCheck(text);
  return Boolean(normalized) && !isPlaceholderSubtitleText(normalized);
}
