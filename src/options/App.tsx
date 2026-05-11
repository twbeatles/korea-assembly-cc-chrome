import { useEffect, useState } from "react";

import {
  POPUP_PORT_NAME,
  SESSION_SEGMENT_PRESETS,
  isSupportedAssemblyUrl,
  isSupportedAssemblySiteUrl,
} from "../shared/constants";
import { validateFilenamePattern } from "../shared/filename-pattern";
import {
  addTabActivatedListener,
  addTabRemovedListener,
  addTabUpdatedListener,
  connectToTab,
  getTab,
  queryTabs,
  removeTabActivatedListener,
  removeTabRemovedListener,
  removeTabUpdatedListener,
  sendRuntimeMessage,
} from "../shared/chrome-api";
import type {
  ContentToPopupMessage,
  PopupToContentMessage,
  StatusSnapshot,
} from "../shared/message-types";
import { getCaptureStatusLabel, UI_TEXT } from "../shared/ui-labels";
import {
  createEmptyPersistReplayDiagnostics,
  readPersistReplayDiagnostics,
} from "../storage/persist-recovery";
import { getSettings, resetSettings, saveSettings } from "../storage/settings-store";
import type {
  AssemblyPreset,
  ExtensionSettings,
  PersistReplayDiagnostics,
  SegmentPreset,
} from "../storage/types";
import { createPrefixedRandomToken } from "../shared/random-token";
import { ADVANCED_NUMBER_FIELDS, BASIC_NUMBER_FIELDS } from "./settings-fields";

type OptionsView = "settings" | "diagnostics";
type NumberField = (typeof BASIC_NUMBER_FIELDS)[number] | (typeof ADVANCED_NUMBER_FIELDS)[number];
type NumberDraftState = Record<NumberField, string>;
type NumberFieldErrorState = Partial<Record<NumberField, string>>;

const EMPTY_PRESET_DRAFT: Omit<AssemblyPreset, "id"> = {
  name: "",
  url: "",
  committeeName: "",
  autoStartEnabled: true,
  noiseFilterEnabled: true,
};

const NUMBER_FIELDS: NumberField[] = [...BASIC_NUMBER_FIELDS, ...ADVANCED_NUMBER_FIELDS];
const SEGMENT_PRESET_OPTIONS: Array<{
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

function getFieldLabel(field: keyof ExtensionSettings): string {
  switch (field) {
    case "runningAutoSaveDebounceMs":
      return "자동 저장 간격";
    case "recentCopyLineCount":
      return "최근 복사 줄 수";
    case "keepaliveIntervalMs":
      return "같은 자막 확인 간격";
    case "pollingFallbackIntervalMs":
      return "화면 다시 확인 간격";
    case "maxBufferLength":
      return "중복 확인용 기억 길이";
    case "maxEntriesPerSegment":
      return "한 번에 저장할 최대 문장 수";
    case "maxCharsPerSegment":
      return "한 번에 저장할 최대 글자 수";
    case "maxSegmentDurationMinutes":
      return "한 번에 저장할 최대 시간";
    case "recentDuplicateMinLength":
      return "중복으로 볼 최소 글자 수";
    default:
      return field;
  }
}

function getFieldDescription(field: keyof ExtensionSettings): string {
  switch (field) {
    case "runningAutoSaveDebounceMs":
      return "값이 작을수록 더 자주 저장합니다. 보통은 기본값을 그대로 두면 됩니다.";
    case "recentCopyLineCount":
      return "최근 복사 버튼에 포함할 최신 문장 수입니다.";
    case "keepaliveIntervalMs":
      return "같은 자막이 계속 보일 때 시간을 갱신하는 간격입니다.";
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
      return "짧은 글자는 중복으로 잘못 판단하지 않도록 제외합니다.";
    default:
      return "";
  }
}

function getFieldUnit(field: keyof ExtensionSettings): string {
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

function getFieldMin(field: keyof ExtensionSettings): number {
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

function getCaptureModeSummary(snapshot: StatusSnapshot | null): string {
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

function buildNumberDraftState(settings: ExtensionSettings): NumberDraftState {
  return NUMBER_FIELDS.reduce(
    (drafts, field) => ({
      ...drafts,
      [field]: String(settings[field]),
    }),
    {} as NumberDraftState,
  );
}

function validateNumberDraft(field: NumberField, value: string): string | undefined {
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

function getInitialView(): OptionsView {
  const view = new URLSearchParams(window.location.search).get("view");
  return view === "diagnostics" ? "diagnostics" : "settings";
}

function getInitialDiagnosticsTabId(): number | null {
  const raw = new URLSearchParams(window.location.search).get("tabId");
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function updateUrl(view: OptionsView, tabId: number | null): void {
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

async function resolveDiagnosticsTab(preferredTabId: number | null): Promise<chrome.tabs.Tab | null> {
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

function mergeSnapshot(
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

export default function App() {
  const [settings, setSettings] = useState<ExtensionSettings | null>(null);
  const [numberDrafts, setNumberDrafts] = useState<NumberDraftState | null>(null);
  const [numberFieldErrors, setNumberFieldErrors] = useState<NumberFieldErrorState>({});
  const [filenamePatternError, setFilenamePatternError] = useState<string | undefined>(undefined);
  const [message, setMessage] = useState("설정을 불러오는 중입니다.");
  const [presetDraft, setPresetDraft] = useState(EMPTY_PRESET_DRAFT);
  const [view, setView] = useState<OptionsView>(getInitialView);
  const [diagnosticsTabId] = useState<number | null>(getInitialDiagnosticsTabId);
  const [diagnosticsReloadToken, setDiagnosticsReloadToken] = useState(0);
  const [snapshot, setSnapshot] = useState<StatusSnapshot | null>(null);
  const [persistReplayDiagnostics, setPersistReplayDiagnostics] = useState<PersistReplayDiagnostics>(
    createEmptyPersistReplayDiagnostics(),
  );
  const [diagnosticsMessage, setDiagnosticsMessage] = useState(
    "현재 탭의 수집 상태를 확인하고 있습니다.",
  );
  const [tabReady, setTabReady] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [requiresReload, setRequiresReload] = useState(false);

  const diagnosticsErrorRows = [
    {
      label: "임시 저장 오류",
      value: persistReplayDiagnostics.lastQueueWriteError || "-",
    },
    {
      label: "이전 기록 복구 오류",
      value: persistReplayDiagnostics.lastReplayError || "-",
    },
    {
      label: "이전 수집 정리 오류",
      value: persistReplayDiagnostics.lastCleanupError || "-",
    },
    {
      label: "페이지 종료 저장 오류",
      value: persistReplayDiagnostics.lastPageExitPersistError || "-",
    },
    {
      label: "최근 오류",
      value: persistReplayDiagnostics.lastError || "-",
    },
  ];
  const visibleDiagnosticsErrors = diagnosticsErrorRows.filter((row) => row.value !== "-");

  useEffect(() => {
    void getSettings()
      .then((data) => {
        setSettings(data);
        setNumberDrafts(buildNumberDraftState(data));
        setNumberFieldErrors({});
        setFilenamePatternError(undefined);
        setMessage("필요한 값을 바꾼 뒤 저장하세요.");
      })
      .catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : "설정을 읽지 못했습니다.");
      });
  }, []);

  useEffect(() => {
    if (view !== "diagnostics") {
      return;
    }

    let active = true;
    void readPersistReplayDiagnostics()
      .then((diagnostics) => {
        if (!active) {
          return;
        }
        setPersistReplayDiagnostics(diagnostics);
      })
      .catch(() => {
        if (!active) {
          return;
        }
        setPersistReplayDiagnostics(createEmptyPersistReplayDiagnostics());
      });

    return () => {
      active = false;
    };
  }, [diagnosticsReloadToken, view]);

  useEffect(() => {
    if (view !== "diagnostics") {
      return;
    }

    let active = true;
    let reconnectTimer: number | null = null;
    let reconnectAttempt = 0;
    let connecting = false;
    let currentPort: chrome.runtime.Port | null = null;
    let currentTabIdValue: number | null = null;
    let pendingReconnectMessage: string | null = null;

    const clearReconnectTimer = (): void => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const disconnectCurrentPort = (): void => {
      if (!currentPort) {
        return;
      }

      const portToDisconnect = currentPort;
      currentPort = null;
      portToDisconnect.disconnect();
    };

    const scheduleReconnect = (nextMessage: string, immediate = false): void => {
      if (!active) {
        return;
      }

      setDiagnosticsMessage(nextMessage);
      clearReconnectTimer();
      const delay = immediate ? 0 : Math.min(5000, 500 * 2 ** reconnectAttempt);
      reconnectAttempt = immediate ? 0 : reconnectAttempt + 1;
      reconnectTimer = window.setTimeout(() => {
        void connect();
      }, delay);
    };

    const reconnectDiagnostics = (message: string): void => {
      if (!active) {
        return;
      }

      if (connecting) {
        pendingReconnectMessage = message;
        return;
      }

      disconnectCurrentPort();
      setTabReady(false);
      setRequiresReload(false);
      scheduleReconnect(message, true);
    };

    const connect = async (): Promise<void> => {
      if (!active || connecting || currentPort) {
        return;
      }
      connecting = true;

      try {
        const tab = await resolveDiagnosticsTab(diagnosticsTabId);
        if (!active) {
          return;
        }

        if (!tab?.id || !tab.url) {
          currentTabIdValue = null;
          setSnapshot(null);
          setUnsupported(false);
          setTabReady(false);
          setRequiresReload(false);
          clearReconnectTimer();
          setDiagnosticsMessage("상태를 확인할 국회 의사중계 탭을 찾지 못했습니다. 해당 탭에서 다시 열어주세요.");
          return;
        }

        currentTabIdValue = tab.id;
        setUnsupported(false);

        const ensure = await sendRuntimeMessage({
          type: "ENSURE_CONTENT_SCRIPT",
          tabId: tab.id,
          url: tab.url,
        });
        if (!active) {
          return;
        }

        if (!ensure.ok) {
          setTabReady(false);
          scheduleReconnect(`${ensure.error} 자동으로 다시 연결을 시도합니다.`);
          return;
        }

        setRequiresReload(Boolean(ensure.requiresReload));
        if (!ensure.ready) {
          setTabReady(false);
          scheduleReconnect("현재 탭과 아직 연결되지 않았습니다. 자동으로 다시 연결을 시도합니다.");
          return;
        }

        reconnectAttempt = 0;
        clearReconnectTimer();
        const nextPort = connectToTab(tab.id, 0, POPUP_PORT_NAME);
        currentPort = nextPort;

        const onMessage = (nextMessage: ContentToPopupMessage): void => {
          if (!active) {
            return;
          }

          switch (nextMessage.type) {
            case "ERROR":
              setDiagnosticsMessage(nextMessage.message);
              return;
            case "CAPTURE_STATUS":
            case "PREVIEW_UPDATE":
            case "SESSION_STATS":
              setSnapshot((current) => mergeSnapshot(current, nextMessage));
              if (nextMessage.type === "CAPTURE_STATUS") {
                setTabReady(true);
                setDiagnosticsMessage(
                  nextMessage.payload.connected
                    ? "현재 탭의 상태를 불러왔습니다."
                    : "국회 의사중계 메인 페이지에는 연결됐지만, 현재 탭은 자막 수집용 플레이어가 아닙니다.",
                );
              }
              return;
            case "POPUP_FEEDBACK":
              return;
          }
        };

        const onDisconnect = (): void => {
          if (currentPort !== nextPort) {
            return;
          }
          const disconnectReason = chrome.runtime.lastError?.message;
          if (!active) {
            return;
          }

          currentPort = null;
          setTabReady(false);
          setRequiresReload(true);
          scheduleReconnect(
            disconnectReason?.includes("Receiving end does not exist")
              ? "현재 탭과의 연결이 없습니다. 자동으로 다시 연결을 시도합니다."
              : disconnectReason || "연결이 끊겼습니다. 자동으로 다시 연결을 시도합니다.",
          );
        };

        nextPort.onMessage.addListener(onMessage);
        nextPort.onDisconnect.addListener(onDisconnect);
        nextPort.postMessage({ type: "GET_DIAGNOSTICS_STATUS" } satisfies PopupToContentMessage);
      } catch (error: unknown) {
        if (!active) {
          return;
        }

        const baseMessage =
          error instanceof Error ? error.message : "현재 탭의 상태를 준비하지 못했습니다.";
        scheduleReconnect(`${baseMessage} 자동으로 다시 연결을 시도합니다.`);
      } finally {
        connecting = false;
        if (pendingReconnectMessage) {
          const nextMessage = pendingReconnectMessage;
          pendingReconnectMessage = null;
          reconnectDiagnostics(nextMessage);
        }
      }
    };

    const handleTabActivated = (): void => {
      if (typeof diagnosticsTabId === "number") {
        reconnectDiagnostics("선택한 탭 상태를 다시 확인하고 있습니다.");
        return;
      }

      reconnectDiagnostics("현재 창의 활성 탭 상태를 다시 확인하고 있습니다.");
    };

    const handleTabUpdated = (
      _tabId: number,
      changeInfo: chrome.tabs.TabChangeInfo,
      tab: chrome.tabs.Tab,
    ): void => {
      if (!changeInfo.status && !changeInfo.url) {
        return;
      }

      if (typeof diagnosticsTabId === "number") {
        if (typeof tab.id !== "number" || tab.id !== diagnosticsTabId) {
          return;
        }
        reconnectDiagnostics("지정한 탭 상태가 바뀌어 다시 확인하고 있습니다.");
        return;
      }

      if (!tab.active) {
        return;
      }

      reconnectDiagnostics("현재 창의 활성 탭 상태가 바뀌어 다시 확인하고 있습니다.");
    };

    const handleTabRemoved = (tabId: number): void => {
      if (typeof diagnosticsTabId === "number") {
        if (tabId !== diagnosticsTabId) {
          return;
        }
        reconnectDiagnostics("지정한 탭이 닫혀 다른 국회 의사중계 탭을 찾고 있습니다.");
        return;
      }

      if (tabId !== currentTabIdValue) {
        return;
      }

      reconnectDiagnostics("현재 확인 대상 탭이 닫혀 다른 국회 의사중계 탭을 찾고 있습니다.");
    };

    addTabActivatedListener(handleTabActivated);
    addTabUpdatedListener(handleTabUpdated);
    addTabRemovedListener(handleTabRemoved);
    void connect();

    return () => {
      active = false;
      clearReconnectTimer();
      removeTabActivatedListener(handleTabActivated);
      removeTabUpdatedListener(handleTabUpdated);
      removeTabRemovedListener(handleTabRemoved);
      disconnectCurrentPort();
    };
  }, [diagnosticsReloadToken, diagnosticsTabId, view]);

  const hasNumberFieldErrors = Object.values(numberFieldErrors).some(Boolean);
  const hasFieldErrors = hasNumberFieldErrors || Boolean(filenamePatternError);

  const updateField = <K extends keyof ExtensionSettings>(key: K, value: ExtensionSettings[K]): void => {
    setSettings((current) => (current ? { ...current, [key]: value } : current));
  };

  const handlePresetDraftChange = <K extends keyof typeof EMPTY_PRESET_DRAFT>(
    key: K,
    value: (typeof EMPTY_PRESET_DRAFT)[K],
  ): void => {
    setPresetDraft((current) => ({ ...current, [key]: value }));
  };

  const handleAddPreset = (): void => {
    if (!settings) {
      return;
    }
    const name = presetDraft.name.trim();
    const url = presetDraft.url.trim();
    if (!name || !url || !isSupportedAssemblyUrl(url)) {
      setMessage("프리셋 이름과 지원되는 국회 플레이어 URL을 입력하세요.");
      return;
    }
    if ((settings.presets ?? []).some((preset) => preset.url === url)) {
      setMessage("이미 같은 URL의 프리셋이 있습니다.");
      return;
    }
    updateField("presets", [
      ...(settings.presets ?? []),
      {
        ...presetDraft,
        id: createPrefixedRandomToken("preset"),
        name,
        url,
        committeeName: presetDraft.committeeName.trim(),
      },
    ]);
    setPresetDraft(EMPTY_PRESET_DRAFT);
    setMessage("프리셋을 추가했습니다. 저장을 눌러 확정하세요.");
  };

  const handleUpdatePreset = <K extends keyof AssemblyPreset>(
    presetId: string,
    key: K,
    value: AssemblyPreset[K],
  ): void => {
    if (!settings) {
      return;
    }
    const nextPresets = (settings.presets ?? []).map((preset) =>
      preset.id === presetId ? { ...preset, [key]: value } : preset,
    );
    updateField("presets", nextPresets);
  };

  const handleRemovePreset = (presetId: string): void => {
    if (!settings) {
      return;
    }
    updateField(
      "presets",
      (settings.presets ?? []).filter((preset) => preset.id !== presetId),
    );
  };

  const handleNumberDraftChange = (field: NumberField, value: string): void => {
    setNumberDrafts((current) =>
      current
        ? {
            ...current,
            [field]: value,
          }
        : current,
    );

    const nextError = validateNumberDraft(field, value);
    setNumberFieldErrors((current) => {
      if (!nextError) {
        const nextState = { ...current };
        delete nextState[field];
        return nextState;
      }
      return {
        ...current,
        [field]: nextError,
      };
    });

    if (!nextError) {
      setSettings((current) =>
        current
          ? {
              ...current,
              [field]: Number(value),
              ...(field === "maxEntriesPerSegment" ||
              field === "maxCharsPerSegment" ||
              field === "maxSegmentDurationMinutes"
                ? { segmentPreset: "custom" as SegmentPreset }
                : {}),
            }
          : current,
      );
    }
  };

  const handleSegmentPresetChange = (preset: SegmentPreset): void => {
    if (preset === "custom") {
      updateField("segmentPreset", preset);
      return;
    }

    const thresholds = SESSION_SEGMENT_PRESETS[preset];
    setSettings((current) =>
      current
        ? {
            ...current,
            segmentPreset: preset,
            ...thresholds,
          }
        : current,
    );
    setNumberDrafts((current) =>
      current
        ? {
            ...current,
            maxEntriesPerSegment: String(thresholds.maxEntriesPerSegment),
            maxCharsPerSegment: String(thresholds.maxCharsPerSegment),
            maxSegmentDurationMinutes: String(thresholds.maxSegmentDurationMinutes),
          }
        : current,
    );
    setNumberFieldErrors((current) => {
      const next = { ...current };
      delete next.maxEntriesPerSegment;
      delete next.maxCharsPerSegment;
      delete next.maxSegmentDurationMinutes;
      return next;
    });
  };

  const handleSave = async (): Promise<void> => {
    if (!settings || hasFieldErrors) {
      if (hasFieldErrors) {
        setMessage("잘못된 입력을 먼저 고쳐주세요.");
      }
      return;
    }
    const presetUrls = new Set<string>();
    for (const preset of settings.presets ?? []) {
      const name = preset.name.trim();
      const url = preset.url.trim();
      if (!name || !isSupportedAssemblyUrl(url)) {
        setMessage("프리셋 이름과 지원되는 국회 플레이어 URL을 확인하세요.");
        return;
      }
      if (presetUrls.has(url)) {
        setMessage("중복된 프리셋 URL을 하나만 남겨주세요.");
        return;
      }
      presetUrls.add(url);
    }

    try {
      const next = await saveSettings(settings);
      setSettings(next);
      setNumberDrafts(buildNumberDraftState(next));
      setNumberFieldErrors({});
      setFilenamePatternError(undefined);
      setMessage("설정을 저장했습니다.");
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "설정을 저장하지 못했습니다.");
    }
  };

  const handleReset = async (): Promise<void> => {
    try {
      const next = await resetSettings();
      setSettings(next);
      setNumberDrafts(buildNumberDraftState(next));
      setNumberFieldErrors({});
      setFilenamePatternError(undefined);
      setMessage("기본값으로 되돌렸습니다.");
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "기본값으로 되돌리지 못했습니다.");
    }
  };

  const handleViewChange = (nextView: OptionsView): void => {
    setView(nextView);
    updateUrl(nextView, diagnosticsTabId);
  };

  const handleDiagnosticsRefresh = (): void => {
    setSnapshot(null);
    setTabReady(false);
    setUnsupported(false);
    setRequiresReload(false);
    setDiagnosticsMessage("현재 탭의 수집 상태를 다시 확인하고 있습니다.");
    setDiagnosticsReloadToken((current) => current + 1);
  };

  if (!settings || !numberDrafts) {
    return <main className="options-shell">설정을 불러오는 중입니다.</main>;
  }

  const presets = settings.presets ?? [];

  return (
    <main className="options-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">{view === "diagnostics" ? "상태 확인" : "쉽게 설정"}</p>
          <h1>{view === "diagnostics" ? "자막 도우미 상태 확인" : "자막 도우미 환경 설정"}</h1>
          <p className="hero-message">{view === "diagnostics" ? diagnosticsMessage : message}</p>
        </div>
        <div className="view-toggle" role="tablist" aria-label="환경 설정 메뉴">
          <button
            type="button"
            role="tab"
            aria-selected={view === "settings"}
            className={view === "settings" ? "view-button" : "view-button secondary"}
            onClick={() => handleViewChange("settings")}
          >
            {UI_TEXT.openOptions}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "diagnostics"}
            className={view === "diagnostics" ? "view-button" : "view-button secondary"}
            onClick={() => handleViewChange("diagnostics")}
          >
            {UI_TEXT.openDiagnostics}
          </button>
        </div>
      </header>

      {view === "settings" ? (
        <>
          <section className="settings-grid">
            <p className="settings-section-heading">수집 동작</p>

            <label className="setting-card">
              <div>
                <strong>자동으로 따라가기</strong>
                <span>페이지 패널의 실시간 내용과 수집된 자막을 자동으로 맨 아래로 맞춥니다.</span>
              </div>
              <input
                type="checkbox"
                checked={settings.autoScroll}
                onChange={(event) => updateField("autoScroll", event.target.checked)}
              />
            </label>

            <label className="setting-card">
              <div>
                <strong>수집 중 자동 저장</strong>
                <span>모으는 동안 중간 결과를 자동으로 저장해 둡니다.</span>
              </div>
              <input
                type="checkbox"
                checked={settings.runningAutoSaveEnabled}
                onChange={(event) => updateField("runningAutoSaveEnabled", event.target.checked)}
              />
            </label>

            <label className="setting-card">
              <div>
                <strong>페이지 접속 시 자동 시작</strong>
                <span>국회 의사/생중계 페이지를 열 때 바로 수집을 시작합니다.</span>
              </div>
              <input
                type="checkbox"
                checked={settings.autoStartEnabled}
                onChange={(event) => updateField("autoStartEnabled", event.target.checked)}
              />
            </label>

            <div className="warning-box full-width">
              국회 중계 페이지를 열 때 자동으로 시작됩니다. 직접 시작하고 싶다면 이 옵션을 꺼두세요.
            </div>

            <label className="setting-card">
              <div>
                <strong>바뀌는 중인 자막 제외</strong>
                <span>화면에서 아직 바뀌고 있는 자막은 잠시 기다렸다가 확정된 뒤 저장합니다.</span>
              </div>
              <input
                type="checkbox"
                checked={settings.filterUnconfirmedEnabled}
                onChange={(event) => updateField("filterUnconfirmedEnabled", event.target.checked)}
              />
            </label>

            <p className="settings-section-heading">복사 / 저장</p>
            <p className="settings-section-note">
              최근 복사 줄 수, 텍스트 파일 저장 방식, 자동 저장 간격을 조정합니다.
            </p>

            {BASIC_NUMBER_FIELDS.map((field) => {
              const fieldUnit = getFieldUnit(field);
              return (
                <label
                  className={`setting-card input-card ${numberFieldErrors[field] ? "has-error" : ""}`}
                  key={field}
                >
                  <div>
                    <strong>{getFieldLabel(field)}</strong>
                    <span>{getFieldDescription(field)}</span>
                  </div>
                  <div className="number-input-group">
                    <div className="number-input-row">
                      <input
                        type="number"
                        min={getFieldMin(field)}
                        step={1}
                        aria-label={getFieldLabel(field)}
                        value={numberDrafts[field]}
                        aria-invalid={Boolean(numberFieldErrors[field])}
                        onChange={(event) => handleNumberDraftChange(field, event.target.value)}
                      />
                      {fieldUnit ? <span className="input-suffix">{fieldUnit}</span> : null}
                    </div>
                    {numberFieldErrors[field] ? (
                      <span className="field-error">{numberFieldErrors[field]}</span>
                    ) : null}
                  </div>
                </label>
              );
            })}

            <label
              className={`setting-card input-card full-width ${filenamePatternError ? "has-error" : ""}`}
            >
              <div>
                <strong>저장 파일 이름 규칙</strong>
                <span>{`파일 이름에 날짜, 회의 이름, 시간을 넣을 수 있습니다: {date}, {committee}, {time}`}</span>
              </div>
              <div className="number-input-group">
                <input
                  type="text"
                  aria-label="저장 파일 이름 규칙"
                  aria-invalid={Boolean(filenamePatternError)}
                  value={settings.filenamePattern}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    updateField("filenamePattern", nextValue);
                    setFilenamePatternError(validateFilenamePattern(nextValue));
                  }}
                />
                {filenamePatternError ? (
                  <span className="field-error">{filenamePatternError}</span>
                ) : null}
              </div>
            </label>

            <label className="setting-card full-width">
              <div>
                <strong>텍스트 파일에 시간 함께 저장</strong>
                <span>켜면 각 자막 앞에 시간이 함께 들어갑니다.</span>
              </div>
              <input
                type="checkbox"
                checked={settings.txtExportTimestampsEnabled}
                onChange={(event) =>
                  updateField("txtExportTimestampsEnabled", event.target.checked)
                }
              />
            </label>

            <label className="setting-card">
              <div>
                <strong>텍스트 파일에 발언자 함께 저장</strong>
                <span>발언자 이름을 적어 둔 경우 자막 앞에 함께 넣습니다.</span>
              </div>
              <input
                type="checkbox"
                checked={Boolean(settings.txtExportSpeakerEnabled)}
                onChange={(event) => updateField("txtExportSpeakerEnabled", event.target.checked)}
              />
            </label>

            <label className="setting-card">
              <div>
                <strong>텍스트 파일에 메모 함께 저장</strong>
                <span>중요 표시와 메모를 자막 아래에 함께 넣습니다.</span>
              </div>
              <input
                type="checkbox"
                checked={Boolean(settings.txtExportEntryNotesEnabled)}
                onChange={(event) =>
                  updateField("txtExportEntryNotesEnabled", event.target.checked)
                }
              />
            </label>

            <details className="advanced-card full-width">
              <summary>
                <span className="advanced-summary-title">고급 설정</span>
                <span className="advanced-summary-description">
                  자막 제외 기준과 확인 간격을 바꿉니다. 특별한 이유가 없다면 기본값을 유지하세요.
                </span>
              </summary>
              <div className="advanced-grid">
                <label className="setting-card">
                  <div>
                    <strong>불필요한 자막 자동 제외</strong>
                    <span>
                      자막이 아닌 숫자, 기호, 안내 문구를 자동으로 빼고 저장합니다.
                      필요한 문장이 빠진다면 이 옵션을 끄세요.
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.noiseFilterEnabled}
                    onChange={(event) => updateField("noiseFilterEnabled", event.target.checked)}
                  />
                </label>

                <label className="setting-card">
                  <div>
                    <strong>문제 해결용 자세한 기록</strong>
                    <span>이상 현상을 확인할 때 브라우저 콘솔에 더 자세한 로그를 남깁니다.</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.debugLogging}
                    onChange={(event) => updateField("debugLogging", event.target.checked)}
                  />
                </label>

                <div className="setting-card input-card full-width">
                  <div>
                    <strong>긴 회의 자동 나누기</strong>
                    <span>회의가 길어질 때 파일을 어느 정도 크기로 나눌지 선택합니다.</span>
                  </div>
                  <div className="preset-grid" role="radiogroup" aria-label="긴 회의 자동 나누기">
                    {SEGMENT_PRESET_OPTIONS.map((preset) => (
                      <button
                        type="button"
                        key={preset.value}
                        className={
                          settings.segmentPreset === preset.value
                            ? "preset-option active"
                            : "preset-option"
                        }
                        onClick={() => handleSegmentPresetChange(preset.value)}
                        aria-pressed={settings.segmentPreset === preset.value}
                      >
                        <strong>{preset.label}</strong>
                        <span>{preset.description}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {ADVANCED_NUMBER_FIELDS.map((field) => {
                  const fieldUnit = getFieldUnit(field);
                  return (
                    <label
                      className={`setting-card input-card ${numberFieldErrors[field] ? "has-error" : ""}`}
                      key={field}
                    >
                      <div>
                        <strong>{getFieldLabel(field)}</strong>
                        <span>{getFieldDescription(field)}</span>
                      </div>
                      <div className="number-input-group">
                        <div className="number-input-row">
                          <input
                            type="number"
                            min={getFieldMin(field)}
                            step={1}
                            aria-label={getFieldLabel(field)}
                            value={numberDrafts[field]}
                            aria-invalid={Boolean(numberFieldErrors[field])}
                            onChange={(event) => handleNumberDraftChange(field, event.target.value)}
                          />
                          {fieldUnit ? <span className="input-suffix">{fieldUnit}</span> : null}
                        </div>
                        {numberFieldErrors[field] ? (
                          <span className="field-error">{numberFieldErrors[field]}</span>
                        ) : null}
                      </div>
                    </label>
                  );
                })}
              </div>
            </details>

            <div className="note-card full-width">
              <div className="section-row">
                <strong>회의 프리셋</strong>
                <span>자주 여는 국회 중계 페이지를 확장 팝업에서 바로 열 수 있습니다.</span>
              </div>
              {presets.length ? (
                <div className="meta-grid">
                  {presets.map((preset) => (
                    <div className="meta-row" key={preset.id}>
                      <input
                        type="text"
                        value={preset.name}
                        onChange={(event) =>
                          handleUpdatePreset(preset.id, "name", event.target.value)
                        }
                        aria-label="프리셋 이름"
                      />
                      <input
                        type="url"
                        value={preset.url}
                        onChange={(event) =>
                          handleUpdatePreset(preset.id, "url", event.target.value)
                        }
                        aria-label="프리셋 URL"
                      />
                      <input
                        type="text"
                        value={preset.committeeName}
                        onChange={(event) =>
                          handleUpdatePreset(preset.id, "committeeName", event.target.value)
                        }
                        aria-label="프리셋 위원회명"
                      />
                      <label>
                        자동 시작
                        <input
                          type="checkbox"
                          checked={preset.autoStartEnabled}
                          onChange={(event) =>
                            handleUpdatePreset(
                              preset.id,
                              "autoStartEnabled",
                              event.target.checked,
                            )
                          }
                        />
                      </label>
                      <label>
                        필터
                        <input
                          type="checkbox"
                          checked={preset.noiseFilterEnabled}
                          onChange={(event) =>
                            handleUpdatePreset(
                              preset.id,
                              "noiseFilterEnabled",
                              event.target.checked,
                            )
                          }
                        />
                      </label>
                      <button
                        className="secondary"
                        type="button"
                        onClick={() => handleRemovePreset(preset.id)}
                      >
                        삭제
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="warning-box">저장된 프리셋이 없습니다.</div>
              )}
              <div className="advanced-grid">
                <input
                  type="text"
                  value={presetDraft.name}
                  onChange={(event) => handlePresetDraftChange("name", event.target.value)}
                  placeholder="프리셋 이름"
                />
                <input
                  type="url"
                  value={presetDraft.url}
                  onChange={(event) => handlePresetDraftChange("url", event.target.value)}
                  placeholder="https://assembly.webcast.go.kr/main/player..."
                />
                <input
                  type="text"
                  value={presetDraft.committeeName}
                  onChange={(event) =>
                    handlePresetDraftChange("committeeName", event.target.value)
                  }
                  placeholder="위원회명"
                />
                <label className="setting-card">
                  <div>
                    <strong>자동 시작</strong>
                    <span>이 페이지를 열 때 바로 자막 모으기를 시작합니다.</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={presetDraft.autoStartEnabled}
                    onChange={(event) =>
                      handlePresetDraftChange("autoStartEnabled", event.target.checked)
                    }
                  />
                </label>
                <label className="setting-card">
                  <div>
                    <strong>불필요한 자막 제외</strong>
                    <span>이 페이지에서 숫자, 기호, 안내 문구를 자동으로 뺍니다.</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={presetDraft.noiseFilterEnabled}
                    onChange={(event) =>
                      handlePresetDraftChange("noiseFilterEnabled", event.target.checked)
                    }
                  />
                </label>
                <button type="button" onClick={handleAddPreset}>
                  프리셋 추가
                </button>
              </div>
            </div>
          </section>

          <footer className="actions">
            <button onClick={handleSave} disabled={hasFieldErrors}>
              저장
            </button>
            <button className="secondary" onClick={handleReset}>
              기본값으로 되돌리기
            </button>
          </footer>
        </>
      ) : (
        <section className="diagnostics-panel">
          <div className="diagnostics-header">
            <div>
              <p className="eyebrow">선택한 탭 기준</p>
              <h2>{UI_TEXT.openDiagnostics}</h2>
            </div>
            <span className={`status-badge ${snapshot?.status ?? "idle"}`}>
              {snapshot ? getCaptureStatusLabel(snapshot.status) : "연결 전"}
            </span>
          </div>

          <div className="meta-grid">
            <div className="meta-row">
              <span>작동 상태</span>
              <strong>{unsupported ? "지원되지 않음" : tabReady ? "연결됨" : "대기 중"}</strong>
            </div>
            <div className="meta-row">
              <span>회의 이름</span>
              <strong>{snapshot?.committeeName || snapshot?.title || "-"}</strong>
            </div>
            <div className="meta-row">
              <span>모인 자막</span>
              <strong>{snapshot?.subtitleCount ?? 0}문장</strong>
            </div>
            <div className="meta-row">
              <span>글자 수</span>
              <strong>{snapshot?.charCount ?? 0}자</strong>
            </div>
            <div className="meta-row">
              <span>수집 방식</span>
              <strong>{getCaptureModeSummary(snapshot)}</strong>
            </div>
            <div className="meta-row">
              <span>최근 저장</span>
              <strong>{snapshot?.lastPersistedAt ? new Date(snapshot.lastPersistedAt).toLocaleString("ko-KR") : "-"}</strong>
            </div>
          </div>

          <section className="diagnostics-subsection">
            <div className="subsection-header">
              <h3>최근 저장 복구</h3>
              <p>브라우저가 갑자기 닫힌 뒤 자동으로 복구한 기록입니다.</p>
            </div>
            <div className="meta-grid">
              <div className="meta-row">
                <span>마지막 확인</span>
                <strong>
                  {persistReplayDiagnostics.lastReplayAt
                    ? new Date(persistReplayDiagnostics.lastReplayAt).toLocaleString("ko-KR")
                    : "-"}
                </strong>
              </div>
              <div className="meta-row">
                <span>복구된 기록</span>
                <strong>
                  {persistReplayDiagnostics.lastReplayReplayedCount}건
                </strong>
              </div>
              <div className="meta-row">
                <span>정리된 이전 수집</span>
                <strong>{persistReplayDiagnostics.lastCleanupClosedCount}건</strong>
              </div>
              <div className="meta-row">
                <span>실패한 복구</span>
                <strong>
                  {persistReplayDiagnostics.lastReplayFailedCount + persistReplayDiagnostics.lastCleanupFailedCount}건
                </strong>
              </div>
              <div className="meta-row">
                <span>마지막 종료 전 저장</span>
                <strong>
                  {persistReplayDiagnostics.lastPageExitPersistAttemptAt
                    ? new Date(persistReplayDiagnostics.lastPageExitPersistAttemptAt).toLocaleString("ko-KR")
                    : "-"}
                </strong>
              </div>
              <div className="meta-row">
                <span>종료 전 저장 내용</span>
                <strong>
                  {persistReplayDiagnostics.lastPageExitPersistSessionId ?? "-"} / {persistReplayDiagnostics.lastPageExitPersistEntryCount}
                </strong>
              </div>
              {visibleDiagnosticsErrors.map((row) => (
                <div className="meta-row" key={row.label}>
                  <span>{row.label}</span>
                  <strong>{row.value}</strong>
                </div>
              ))}
            </div>
          </section>

          {requiresReload ? (
            <div className="warning-box">
              확장 설치 전부터 열려 있던 탭이면 새로고침이 필요할 수 있습니다.
            </div>
          ) : null}

          <footer className="actions">
            <button onClick={handleDiagnosticsRefresh}>다시 확인</button>
            <button className="secondary" onClick={() => handleViewChange("settings")}>
              {UI_TEXT.openOptions}
            </button>
          </footer>
        </section>
      )}
    </main>
  );
}
