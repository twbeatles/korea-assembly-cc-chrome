import type { StatusSnapshot } from "../../shared/message-types";

export function formatEntryTime(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return "-";
  }
  return timestamp.toLocaleString("ko-KR");
}

export function getCaptureModeBadge(snapshot: StatusSnapshot | null): string {
  switch (snapshot?.diagnostics.captureMode) {
    case "structured":
      return "수집된 자막";
    case "fallback":
      return "실시간 자막";
    default:
      return "준비 중";
  }
}
