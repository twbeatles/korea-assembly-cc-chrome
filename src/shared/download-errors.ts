function includesAny(target: string, patterns: string[]): boolean {
  return patterns.some((pattern) => target.includes(pattern));
}

export type DownloadErrorContext = "generic" | "single-session" | "partial" | "library";

function resolveOversizeGuidance(context: DownloadErrorContext): string {
  switch (context) {
    case "single-session":
      return "내보내기 데이터가 커서 저장 요청을 전송하지 못했습니다. 저장된 기록 화면에서 필요한 항목만 선택해 부분 저장을 시도해 주세요.";
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
      return "내보내기 데이터가 너무 커서 다운로드 URL을 만들지 못했습니다. 저장된 기록 화면에서 필요한 항목만 선택해 부분 저장을 시도해 주세요.";
    case "partial":
      return "선택한 내보내기 데이터가 너무 커서 다운로드 URL을 만들지 못했습니다. 선택 범위를 더 줄여 다시 시도해 주세요.";
    case "library":
      return "전체 백업 데이터가 너무 커서 다운로드 URL을 만들지 못했습니다. 저장된 기록을 줄인 뒤 다시 시도해 주세요.";
    default:
      return "내보내기 데이터가 너무 커서 다운로드 URL을 만들지 못했습니다. 범위를 나누어 다시 시도해 주세요.";
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
