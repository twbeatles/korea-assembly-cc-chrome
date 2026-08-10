import { isSupportedAssemblySiteUrl } from "../../shared/constants";
import { getTab, queryTabs } from "../../shared/chrome-api";
import type {
  ContentToPopupMessage,
  StatusSnapshot,
} from "../../shared/message-types";
import type {
  AssemblyPreset,
  ExtensionSettings,
  SegmentPreset,
} from "../../storage/types";
import { ADVANCED_NUMBER_FIELDS, BASIC_NUMBER_FIELDS } from "../settings-fields";

export type OptionsView = "settings" | "diagnostics";
export type NumberField =
  | (typeof BASIC_NUMBER_FIELDS)[number]
  | (typeof ADVANCED_NUMBER_FIELDS)[number];
export type NumberDraftState = Record<NumberField, string>;
export type NumberFieldErrorState = Partial<Record<NumberField, string>>;

export const EMPTY_PRESET_DRAFT: Omit<AssemblyPreset, "id"> = {
  name: "",
  url: "",
  committeeName: "",
  autoStartEnabled: true,
  noiseFilterEnabled: true,
};

export const NUMBER_FIELDS: NumberField[] = [
  ...BASIC_NUMBER_FIELDS,
  ...ADVANCED_NUMBER_FIELDS,
];
export const SEGMENT_PRESET_OPTIONS: Array<{
  value: SegmentPreset;
  label: string;
  description: string;
}> = [
  {
    value: "stability",
    label: "작게 나누기",
    description: "짧은 파일로 자주 저장",
  },
  {
    value: "balanced",
    label: "기본",
    description: "일반 회의에 적합",
  },
  {
    value: "capacity",
    label: "긴 회의",
    description: "긴 회의를 덜 자주 나눔",
  },
  {
    value: "custom",
    label: "직접 설정",
    description: "아래 숫자를 직접 사용",
  },
];

export type SettingsToggleKey =
  | "autoScroll"
  | "runningAutoSaveEnabled"
  | "autoStartEnabled"
  | "filterUnconfirmedEnabled"
  | "panelSpeakerHighlightEnabled"
  | "txtExportTimestampsEnabled"
  | "txtExportSpeakerEnabled"
  | "txtExportEntryNotesEnabled"
  | "noiseFilterEnabled"
  | "debugLogging";

export const SETTINGS_DEFAULT_MESSAGE = "바꾼 뒤 아래 저장을 누르세요.";

export function getToggleCopy(field: SettingsToggleKey): {
  title: string;
  description: string;
  caution?: string;
} {
  switch (field) {
    case "autoStartEnabled":
      return {
        title: "플레이어 열면 바로 수집",
        description: "플레이어 페이지에 들어오면 수집을 시작합니다. 직접 시작만 원하면 끄세요.",
        caution: "다른 회의로 이동해도 다시 시작할 수 있습니다.",
      };
    case "runningAutoSaveEnabled":
      return {
        title: "수집 중 자동 저장",
        description: "모으는 동안 중간 결과를 저장해 둡니다.",
      };
    case "autoScroll":
      return {
        title: "새 자막으로 화면 따라가기",
        description: "패널의 실시간·수집 목록을 맨 아래로 맞춥니다.",
      };
    case "filterUnconfirmedEnabled":
      return {
        title: "확정된 자막만 저장",
        description: "아직 바뀌는 중인 자막은 잠시 기다린 뒤 넣습니다.",
      };
    case "panelSpeakerHighlightEnabled":
      return {
        title: "발언자 색으로 구분 표시",
        description:
          "패널·기록에서 화자별 색 띠와 A/B 표시. 중계 페이지 패널에서도 켤 수 있습니다.",
      };
    case "txtExportTimestampsEnabled":
      return {
        title: "내보내기에 시간 넣기",
        description: "TXT 내보내기에서 각 자막 앞에 시간을 붙입니다.",
      };
    case "txtExportSpeakerEnabled":
      return {
        title: "내보내기·복사에 발언자 넣기",
        description:
          "켜면 파일·복사에 [발언자 A] 등을 넣습니다. MD/CSV에는 발언자 열이 생깁니다.",
      };
    case "txtExportEntryNotesEnabled":
      return {
        title: "내보내기에 메모·중요 표시",
        description: "TXT에 중요 표시와 메모를 함께 넣습니다.",
      };
    case "noiseFilterEnabled":
      return {
        title: "잡음·기호만 있는 줄 제외",
        description:
          "숫자·기호·안내 문구 위주 줄은 저장하지 않습니다. 필요한 문장이 빠진다면 이 옵션을 끄세요.",
      };
    case "debugLogging":
      return {
        title: "자세한 로그 (문제 해결용)",
        description: "이상 확인 시 브라우저 콘솔에 상세 로그를 남깁니다.",
      };
  }
}

export function getFieldLabel(field: keyof ExtensionSettings): string {
  switch (field) {
    case "runningAutoSaveDebounceMs":
      return "자동 저장 간격";
    case "recentCopyLineCount":
      return "한 번에 복사할 줄 수";
    case "keepaliveIntervalMs":
      return "같은 자막 확인 간격";
    case "pollingFallbackIntervalMs":
      return "화면 다시 확인 간격";
    case "maxBufferLength":
      return "중복 확인용 기억 길이";
    case "maxEntriesPerSegment":
      return "한 파일 최대 문장 수";
    case "maxCharsPerSegment":
      return "한 파일 최대 글자 수";
    case "maxSegmentDurationMinutes":
      return "한 파일 최대 시간";
    case "recentDuplicateMinLength":
      return "중복으로 볼 최소 글자 수";
    case "filenamePattern":
      return "저장 파일 이름";
    default:
      return field;
  }
}

export function getFieldDescription(field: keyof ExtensionSettings): string {
  switch (field) {
    case "runningAutoSaveDebounceMs":
      return "값이 작을수록 자주 저장합니다. 보통은 기본값이면 됩니다.";
    case "recentCopyLineCount":
      return "「최근 N줄 복사」에 넣을 문장 수입니다.";
    case "keepaliveIntervalMs":
      return "같은 자막이 계속 보일 때 시간을 갱신하는 간격입니다. 보통은 기본값이면 됩니다.";
    case "pollingFallbackIntervalMs":
      return "자막 변화를 놓치지 않도록 화면을 다시 확인하는 간격입니다.";
    case "maxBufferLength":
      return "이미 저장한 자막과 비교하려고 잠시 기억해 둘 글자 수입니다.";
    case "maxEntriesPerSegment":
      return "이 문장 수를 넘기면 파일을 나누어 저장합니다.";
    case "maxCharsPerSegment":
      return "이 글자 수를 넘기면 파일을 나누어 저장합니다.";
    case "maxSegmentDurationMinutes":
      return "이 시간을 넘기면 파일을 나누어 저장합니다.";
    case "recentDuplicateMinLength":
      return "짧은 글자는 중복으로 잘못 보지 않도록 제외합니다.";
    case "filenamePattern":
      return "{date}, {time}, {committee} 를 넣을 수 있습니다.";
    default:
      return "";
  }
}

export function getFieldUnit(field: keyof ExtensionSettings): string {
  switch (field) {
    case "runningAutoSaveDebounceMs":
    case "keepaliveIntervalMs":
    case "pollingFallbackIntervalMs":
      return "밀리초";
    case "recentCopyLineCount":
      return "줄";
    case "maxEntriesPerSegment":
      return "문장";
    case "maxCharsPerSegment":
      return "자";
    case "maxSegmentDurationMinutes":
      return "분";
    case "maxBufferLength":
    case "recentDuplicateMinLength":
      return "자";
    default:
      return "";
  }
}

export function getFieldMin(field: keyof ExtensionSettings): number {
  switch (field) {
    case "recentCopyLineCount":
      return 1;
    case "keepaliveIntervalMs":
      return 250;
    case "pollingFallbackIntervalMs":
      return 100;
    case "maxEntriesPerSegment":
      return 100;
    case "maxCharsPerSegment":
      return 5000;
    case "maxSegmentDurationMinutes":
      return 10;
    case "maxBufferLength":
      return 1000;
    case "runningAutoSaveDebounceMs":
      return 250;
    default:
      return 1;
  }
}

export function getCaptureModeSummary(snapshot: StatusSnapshot | null): string {
  if (!snapshot) {
    return "-";
  }

  if (snapshot.diagnostics.captureMode === "structured") {
    return "자막을 정상적으로 모으는 중";
  }

  if (snapshot.diagnostics.captureMode === "fallback" || !snapshot.diagnostics.observerActive) {
    return "화면을 다시 확인하며 모으는 중";
  }

  return snapshot.status === "idle" ? "대기 중" : "준비 중";
}

export function buildNumberDraftState(settings: ExtensionSettings): NumberDraftState {
  return NUMBER_FIELDS.reduce(
    (drafts, field) => ({
      ...drafts,
      [field]: String(settings[field]),
    }),
    {} as NumberDraftState,
  );
}

export function validateNumberDraft(field: NumberField, value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return "값을 입력하세요.";
  }

  const numericValue = Number(trimmed);
  if (!Number.isFinite(numericValue)) {
    return "숫자만 입력할 수 있습니다.";
  }

  if (!Number.isInteger(numericValue)) {
    return "정수만 입력할 수 있습니다.";
  }

  if (numericValue < getFieldMin(field)) {
    return `${getFieldMin(field)} 이상이어야 합니다.`;
  }

  return undefined;
}

export function getInitialView(): OptionsView {
  const view = new URLSearchParams(window.location.search).get("view");
  return view === "diagnostics" ? "diagnostics" : "settings";
}

export function getInitialDiagnosticsTabId(): number | null {
  const raw = new URLSearchParams(window.location.search).get("tabId");
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function updateUrl(view: OptionsView, tabId: number | null): void {
  const url = new URL(window.location.href);
  if (view === "diagnostics") {
    url.searchParams.set("view", view);
  } else {
    url.searchParams.delete("view");
  }

  if (typeof tabId === "number") {
    url.searchParams.set("tabId", String(tabId));
  } else {
    url.searchParams.delete("tabId");
  }

  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

export async function resolveDiagnosticsTab(
  preferredTabId: number | null,
): Promise<chrome.tabs.Tab | null> {
  if (typeof preferredTabId === "number") {
    try {
      const preferredTab = await getTab(preferredTabId);
      if (
        typeof preferredTab.id === "number" &&
        typeof preferredTab.url === "string" &&
        isSupportedAssemblySiteUrl(preferredTab.url)
      ) {
        return preferredTab;
      }
    } catch {
      // Fall back to another matching assembly tab in the current window.
    }
  }

  const tabs = await queryTabs({ currentWindow: true });
  const candidates = tabs.filter(
    (tab) =>
      typeof tab.id === "number" &&
      typeof tab.url === "string" &&
      isSupportedAssemblySiteUrl(tab.url),
  );
  candidates.sort((left, right) => {
    if (Boolean(left.active) !== Boolean(right.active)) {
      return left.active ? -1 : 1;
    }
    return (right.lastAccessed ?? 0) - (left.lastAccessed ?? 0);
  });
  return candidates[0] ?? null;
}

export function mergeSnapshot(
  current: StatusSnapshot | null,
  message: Exclude<ContentToPopupMessage, { type: "ERROR" } | { type: "POPUP_FEEDBACK" }>,
): StatusSnapshot | null {
  switch (message.type) {
    case "CAPTURE_STATUS":
      return {
        connected: message.payload.connected,
        requiresReload: message.payload.requiresReload,
        status: message.payload.status,
        sessionId: message.payload.sessionId,
        title: message.payload.title,
        committeeName: message.payload.committeeName,
        sourceUrl: message.payload.sourceUrl,
        subtitleCount: message.payload.subtitleCount,
        charCount: message.payload.charCount,
        previewText: message.payload.previewText,
        recentEntries: message.payload.recentEntries,
        startedAt: message.payload.startedAt,
        endedAt: message.payload.endedAt,
        updatedAt: message.payload.updatedAt,
        lastPersistedAt: message.payload.lastPersistedAt,
        observerActive: message.payload.observerActive,
        currentSelector: message.payload.currentSelector,
        currentFramePath: message.payload.currentFramePath,
        diagnostics: message.payload.diagnostics,
        hasPersistableContent: message.payload.hasPersistableContent,
      };
    case "PREVIEW_UPDATE":
      return current
        ? {
            ...current,
            previewText: message.payload.previewText,
            recentEntries: message.payload.recentEntries,
            hasPersistableContent: message.payload.hasPersistableContent,
          }
        : current;
    case "SESSION_STATS":
      return current
        ? {
            ...current,
            subtitleCount: message.payload.subtitleCount,
            charCount: message.payload.charCount,
            hasPersistableContent: message.payload.hasPersistableContent,
          }
        : current;
  }
}
