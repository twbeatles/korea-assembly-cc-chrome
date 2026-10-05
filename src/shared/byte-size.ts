export const SINGLE_SESSION_EXPORT_WARNING_BYTES = 8 * 1024 * 1024;

export function getUtf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}


/** 사람이 읽기 쉬운 크기 표기 (B / KB / MB). */
export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024) {
    return `${Math.max(0, Math.round(bytes) || 0)} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
