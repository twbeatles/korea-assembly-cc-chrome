import type {
  SessionRecord,
  SpeakerChannel,
  SubtitleEntry,
} from "../subtitle-models";

export type SpeakerLabelsSource = {
  speakerLabels?: SessionRecord["speakerLabels"];
};

/**
 * 내보내기·복사·UI용 발언자 표시 문자열.
 * entry.speakerLabel → session.speakerLabels[channel] → 채널 기본 라벨.
 */
export function resolveSpeakerLabelForOutput(
  entry: Pick<SubtitleEntry, "speakerLabel" | "speakerChannel">,
  session?: SpeakerLabelsSource | null,
  options?: {
    /** unknown 채널 기본 라벨. 생략 시 빈 문자열(접두 없음). */
    unknownLabel?: string;
  },
): string {
  if (entry.speakerLabel?.trim()) {
    return entry.speakerLabel.trim();
  }

  const channel: SpeakerChannel = entry.speakerChannel ?? "unknown";
  const mapped = session?.speakerLabels?.[channel]?.trim();
  if (mapped) {
    return mapped;
  }

  switch (channel) {
    case "primary":
      return "발언자 A";
    case "secondary":
      return "발언자 B";
    default:
      return options?.unknownLabel ?? "";
  }
}

export function formatSpeakerBadge(
  channel: SpeakerChannel | undefined | null,
): string {
  switch (channel) {
    case "primary":
      return "A";
    case "secondary":
      return "B";
    default:
      return "?";
  }
}

const SAFE_SPEAKER_COLOR_PATTERN =
  /^(?:#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)|rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(?:0|1|0?\.\d+)\s*\))$/i;

/** 인라인 스타일용 안전한 색만 통과. 그 외는 빈 문자열. */
export function sanitizeSpeakerColorForCss(
  speakerColor: string | undefined | null,
): string {
  const color = String(speakerColor ?? "").trim().replace(/\s+/g, " ");
  if (!color || color.length > 64) {
    return "";
  }
  const compact = color.replace(/\s+/g, "");
  // rgb/rgba 내부 공백 허용을 위해 정규화 후 재검사
  const normalized = color
    .toLowerCase()
    .replace(/\s*,\s*/g, ", ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")");
  if (SAFE_SPEAKER_COLOR_PATTERN.test(normalized) || SAFE_SPEAKER_COLOR_PATTERN.test(compact)) {
    return normalized.startsWith("#") ? compact : normalized;
  }
  return "";
}

function channelDefaultAccent(
  channel: SpeakerChannel | undefined | null,
): string {
  switch (channel) {
    case "primary":
      return "rgb(35, 124, 147)";
    case "secondary":
      return "rgb(30, 30, 30)";
    default:
      return "";
  }
}

/** 패널 accent: 화이트리스트 통과 색 우선, 실패 시 채널 기본 색. */
export function resolveSpeakerAccentColor(
  speakerColor: string | undefined | null,
  channel: SpeakerChannel | undefined | null,
): string {
  const safe = sanitizeSpeakerColorForCss(speakerColor);
  if (safe) {
    return safe;
  }
  return channelDefaultAccent(channel);
}

/** cue/복사/TXT 공통 접두: 라벨이 있을 때만 `[발언자 A] ` 형태. */
export function formatSpeakerPrefix(label: string): string {
  const trimmed = label.trim();
  return trimmed ? `[${trimmed}] ` : "";
}
