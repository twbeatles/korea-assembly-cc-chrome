function includesAny(target: string, patterns: string[]): boolean {
  return patterns.some((pattern) => target.includes(pattern));
}

export function mapDownloadErrorMessage(rawMessage: string): string {
  const normalized = String(rawMessage ?? "").trim();
  if (!normalized) {
    return "";
  }

  const lower = normalized.toLowerCase();
  const messageLengthPatterns = [
    "message length exceeded",
    "message length",
    "max message length",
    "message too long",
  ];
  if (includesAny(lower, messageLengthPatterns)) {
    return "내보내기 데이터가 커서 저장 요청을 전송하지 못했습니다. 범위를 나누어 다시 시도해 주세요.";
  }

  const largeFallbackPatterns = [
    "data url fallback disabled for large export",
    "too large for data url fallback",
  ];
  if (includesAny(lower, largeFallbackPatterns)) {
    return "내보내기 데이터가 매우 커서 브라우저 fallback 다운로드로 전환할 수 없습니다. 범위를 나누거나 일부만 다시 시도해 주세요.";
  }

  const invalidUrlPatterns = [
    "invalid url",
    "url is invalid",
    "malformed url",
    "data url",
    "data:",
  ];
  if (includesAny(lower, invalidUrlPatterns)) {
    return "내보내기 데이터가 너무 커서 다운로드 URL을 만들지 못했습니다. 범위를 나누어 다시 시도해 주세요.";
  }

  return normalized;
}

export function resolveDownloadErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof Error) {
    return mapDownloadErrorMessage(error.message) || fallbackMessage;
  }
  if (typeof error === "string") {
    return mapDownloadErrorMessage(error) || fallbackMessage;
  }

  return fallbackMessage;
}
