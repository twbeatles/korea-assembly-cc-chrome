function includesAny(target: string, patterns: string[]): boolean {
  return patterns.some((pattern) => target.includes(pattern));
}

export type DownloadErrorContext = "generic" | "single-session" | "partial" | "library";

const SELECT_EXPORT_HINT =
  "확장 아이콘 → '저장된 기록' 또는 페이지 패널의 '저장된 기록 보기'에서 항목을 선택해 부분 저장을 시도해 주세요.";

function resolveOversizeGuidance(context: DownloadErrorContext): string {
  switch (context) {
    case "single-session":
      return `내보내기 데이터가 커서 저장 요청을 전송하지 못했습니다. ${SELECT_EXPORT_HINT}`;
    case "partial":
      return "선택한 내보내기 데이터가 커서 저장 요청을 전송하지 못했습니다. 선택 범위를 더 줄여 다시 시도해 주세요.";
    case "library":
      return "전체 백업 데이터가 커서 저장 요청을 전송하지 못했습니다. 저장된 기록을 줄인 뒤 다시 시도해 주세요.";
    default:
      return "내보내기 데이터가 커서 저장 요청을 전송하지 못했습니다. 범위를 나누어 다시 시도해 주세요.";
  }
}

function resolveInvalidUrlGuidance(context: DownloadErrorContext): string {
  switch (context) {
    case "single-session":
      return `내보내기 데이터가 너무 커서 다운로드 URL을 만들지 못했습니다. ${SELECT_EXPORT_HINT}`;
    case "partial":
      return "선택한 내보내기 데이터가 너무 커서 다운로드 URL을 만들지 못했습니다. 선택 범위를 더 줄여 다시 시도해 주세요.";
    case "library":
      return "전체 백업 데이터가 너무 커서 다운로드 URL을 만들지 못했습니다. 저장된 기록을 줄인 뒤 다시 시도해 주세요.";
    default:
      return "내보내기 데이터가 너무 커서 다운로드 URL을 만들지 못했습니다. 범위를 나누어 다시 시도해 주세요.";
  }
}

function resolveQuotaExceededGuidance(context: DownloadErrorContext): string {
  switch (context) {
    case "single-session":
      return `브라우저 저장 공간이 부족해 다운로드를 만들지 못했습니다. 다운로드 폴더의 여유 공간을 확보하거나, ${SELECT_EXPORT_HINT}`;
    case "partial":
      return "브라우저 저장 공간이 부족해 부분 저장을 만들지 못했습니다. 선택 범위를 줄이거나 다운로드 폴더의 여유 공간을 확보해 주세요.";
    case "library":
      return "브라우저 저장 공간이 부족해 전체 백업 파일을 만들지 못했습니다. 다운로드 폴더의 여유 공간을 확보한 뒤 다시 시도해 주세요.";
    default:
      return "브라우저 저장 공간이 부족해 다운로드를 만들지 못했습니다.";
  }
}

export function mapDownloadErrorMessage(
  rawMessage: string,
  context: DownloadErrorContext = "generic",
): string {
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
    return resolveOversizeGuidance(context);
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
    return resolveInvalidUrlGuidance(context);
  }

  const quotaPatterns = [
    "quota",
    "no_space",
    "disk full",
    "no space left",
    "insufficient_resources",
  ];
  if (includesAny(lower, quotaPatterns)) {
    return resolveQuotaExceededGuidance(context);
  }

  return normalized;
}

export function resolveDownloadErrorMessage(
  error: unknown,
  fallbackMessage: string,
  context: DownloadErrorContext = "generic",
): string {
  if (error instanceof Error) {
    return mapDownloadErrorMessage(error.message, context) || fallbackMessage;
  }
  if (typeof error === "string") {
    return mapDownloadErrorMessage(error, context) || fallbackMessage;
  }

  return fallbackMessage;
}
