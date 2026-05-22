import type { CaptureMode } from "../../core/live-capture";
import type { CaptureStatus } from "../../core/subtitle-models";

export function formatDate(value: string | null | number): string {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString("ko-KR");
}

export function formatElapsedTime(
  startedAt: string | null,
  status: CaptureStatus,
): string {
  if (!startedAt) {
    return "-";
  }
  const startedMs = new Date(startedAt).getTime();
  if (!Number.isFinite(startedMs)) {
    return "-";
  }
  const elapsedMs = Math.max(Date.now() - startedMs, 0);
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number): string => value.toString().padStart(2, "0");
  const formatted =
    hours > 0
      ? `${hours}:${pad(minutes)}:${pad(seconds)}`
      : `${pad(minutes)}:${pad(seconds)}`;
  if (status === "stopped") {
    return `${formatted} (멈춤)`;
  }
  return formatted;
}

export function formatCaptureMode(mode: CaptureMode): string {
  switch (mode) {
    case "structured":
      return "수집된 자막";
    case "fallback":
      return "실시간 자막";
    default:
      return "준비 중";
  }
}
