export const SINGLE_SESSION_EXPORT_WARNING_BYTES = 8 * 1024 * 1024;

export function getUtf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

