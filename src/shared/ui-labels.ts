import type {
  CaptureStatus,
  ExportFormat,
  PersistedSessionStatus,
} from "../core/subtitle-models";

export const UI_TEXT = {
  appName: "국회 자막 도우미",
  statusReady: "준비됨",
  statusRunning: "수집 중",
  statusStopped: "잠시 멈춤",
  statusError: "오류",
  statusSaved: "저장됨",
  startCapture: "자막 모으기",
  stopCapture: "멈추기",
  clearSession: "화면 비우기",
  saveSession: "지금 저장",
  openHistory: "저장된 기록",
  openOptions: "환경 설정",
  openPanel: "페이지 패널 열기",
  livePreview: "실시간 내용",
  screenSubtitles: "화면 자막",
  copyRecent: "최근 N줄 복사",
  search: "내용 찾기",
  copy: "복사",
  export: "파일로 저장",
  collapse: "접기",
  expand: "자막 보기",
} as const;

export const CAPTURE_STATUS_LABELS: Record<CaptureStatus, string> = {
  idle: UI_TEXT.statusReady,
  running: UI_TEXT.statusRunning,
  stopped: UI_TEXT.statusStopped,
  error: UI_TEXT.statusError,
};

export const PERSISTED_STATUS_LABELS: Record<PersistedSessionStatus, string> = {
  running: UI_TEXT.statusRunning,
  stopped: UI_TEXT.statusStopped,
  saved: UI_TEXT.statusSaved,
};

export const EXPORT_FORMAT_LABELS: Record<ExportFormat, string> = {
  txt: "텍스트(TXT)",
  srt: "자막(SRT)",
  vtt: "웹자막(VTT)",
  json: "기록(JSON)",
};

export function getCaptureStatusLabel(status: CaptureStatus): string {
  return CAPTURE_STATUS_LABELS[status];
}

export function getPersistedStatusLabel(status: PersistedSessionStatus): string {
  return PERSISTED_STATUS_LABELS[status];
}

export function getExportFormatLabel(format: ExportFormat): string {
  return EXPORT_FORMAT_LABELS[format];
}
