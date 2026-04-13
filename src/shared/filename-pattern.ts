import { DEFAULT_EXTENSION_SETTINGS } from "./constants";

const FILENAME_PATTERN_INVALID_CHAR_REGEX = /[\\/*?:"<>|]/;
const FILENAME_PATTERN_INVALID_CHAR_GLOBAL_REGEX = /[\\/*?:"<>|]/g;
const ALLOWED_FILENAME_PLACEHOLDERS = ["{date}", "{time}", "{committee}"] as const;

export function validateFilenamePattern(pattern: string): string | undefined {
  const trimmed = pattern.trim();
  if (!trimmed) {
    return "값을 입력하세요.";
  }

  if (FILENAME_PATTERN_INVALID_CHAR_REGEX.test(trimmed)) {
    return "파일 이름에 사용할 수 없는 문자가 포함되어 있습니다.";
  }

  const normalized = ALLOWED_FILENAME_PLACEHOLDERS.reduce(
    (value, placeholder) => value.replaceAll(placeholder, ""),
    trimmed,
  );
  if (/[{}]/.test(normalized)) {
    return "지원하지 않는 치환자가 포함되어 있습니다.";
  }

  return undefined;
}

export function sanitizeFilenamePattern(
  pattern: unknown,
  fallback = DEFAULT_EXTENSION_SETTINGS.filenamePattern,
): string {
  if (typeof pattern !== "string") {
    return fallback;
  }

  const trimmed = pattern.trim();
  return validateFilenamePattern(trimmed) ? fallback : trimmed;
}

export function sanitizeFilenameBasename(value: string): string {
  return value.replace(FILENAME_PATTERN_INVALID_CHAR_GLOBAL_REGEX, "").trim();
}
