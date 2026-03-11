import { cleanDisplayText } from "./text-normalizer";

const LANGUAGE_RE = /[가-힣A-Za-z]/;
const NUMERIC_ONLY_RE = /^[\d\s.,:;+\-*/()%]+$/;
const SYMBOL_ONLY_RE = /^[\W_]+$/u;

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
  return Boolean(normalizeForNoiseCheck(text));
}
