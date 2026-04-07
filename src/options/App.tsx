import { useEffect, useState } from "react";

import { POPUP_PORT_NAME, isSupportedAssemblyUrl } from "../shared/constants";
import { formatCaptureDiagnosticsFramePath } from "../shared/capture-diagnostics";
import { validateFilenamePattern } from "../shared/filename-pattern";
import { connectToTab, getTab, queryTabs, sendRuntimeMessage } from "../shared/chrome-api";
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
import type { ExtensionSettings, PersistReplayDiagnostics } from "../storage/types";
import { ADVANCED_NUMBER_FIELDS, BASIC_NUMBER_FIELDS } from "./settings-fields";

type OptionsView = "settings" | "diagnostics";
type NumberField = (typeof BASIC_NUMBER_FIELDS)[number] | (typeof ADVANCED_NUMBER_FIELDS)[number];
type NumberDraftState = Record<NumberField, string>;
type NumberFieldErrorState = Partial<Record<NumberField, string>>;

const NUMBER_FIELDS: NumberField[] = [...BASIC_NUMBER_FIELDS, ...ADVANCED_NUMBER_FIELDS];

function getFieldLabel(field: keyof ExtensionSettings): string {
  switch (field) {
    case "runningAutoSaveDebounceMs":
      return "자동 저장 간격";
    case "recentCopyLineCount":
      return "최근 복사 줄 수";
    case "keepaliveIntervalMs":
      return "자막 유지 확인 주기";
    case "pollingFallbackIntervalMs":
      return "대체 확인 주기";
    case "maxBufferLength":
      return "중복 비교 버퍼 길이";
    case "recentDuplicateMinLength":
      return "중복 판정 최소 글자 수";
    default:
      return field;
  }
}

function getFieldDescription(field: keyof ExtensionSettings): string {
  switch (field) {
    case "runningAutoSaveDebounceMs":
      return "수집 중 자동 저장을 몇 ms 간격으로 묶어서 실행할지 정합니다.";
    case "recentCopyLineCount":
      return "최근 복사 버튼에 포함할 최신 문장 수입니다.";
    case "keepaliveIntervalMs":
      return "같은 자막이 계속 보일 때 종료 시각을 갱신하는 간격입니다.";
    case "pollingFallbackIntervalMs":
      return "자동 감시가 놓칠 때 화면을 다시 확인하는 주기입니다.";
    case "maxBufferLength":
      return "중복 비교를 위해 잠시 기억해 둘 텍스트 길이입니다.";
    case "recentDuplicateMinLength":
      return "최근 자막과 비교할 때 중복으로 판단할 최소 글자 수입니다.";
    default:
      return "";
  }
}

function getFieldUnit(field: keyof ExtensionSettings): string {
  switch (field) {
    case "runningAutoSaveDebounceMs":
    case "keepaliveIntervalMs":
    case "pollingFallbackIntervalMs":
      return "ms";
    case "recentCopyLineCount":
      return "줄";
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
    case "maxBufferLength":
      return 1000;
    case "runningAutoSaveDebounceMs":
      return 250;
    default:
      return 1;
  }
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
      return await getTab(preferredTabId);
    } catch {
      // Fall back to another matching assembly tab in the current window.
    }
  }

  const tabs = await queryTabs({ currentWindow: true });
  const candidates = tabs.filter(
    (tab) => typeof tab.id === "number" && typeof tab.url === "string" && isSupportedAssemblyUrl(tab.url),
  );
  candidates.sort((left, right) => (right.lastAccessed ?? 0) - (left.lastAccessed ?? 0));
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
      label: "queue 쓰기 오류",
      value: persistReplayDiagnostics.lastQueueWriteError || "-",
    },
    {
      label: "replay 오류",
      value: persistReplayDiagnostics.lastReplayError || "-",
    },
    {
      label: "cleanup 오류",
      value: persistReplayDiagnostics.lastCleanupError || "-",
    },
    {
      label: "오류 요약",
      value: persistReplayDiagnostics.lastError || "-",
    },
  ];

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

    const clearReconnectTimer = (): void => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const scheduleReconnect = (nextMessage: string): void => {
      if (!active) {
        return;
      }

      setDiagnosticsMessage(nextMessage);
      clearReconnectTimer();
      const delay = Math.min(5000, 500 * 2 ** reconnectAttempt);
      reconnectAttempt += 1;
      reconnectTimer = window.setTimeout(() => {
        void connect();
      }, delay);
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
          setSnapshot(null);
          setUnsupported(false);
          setTabReady(false);
          setRequiresReload(false);
          clearReconnectTimer();
          setDiagnosticsMessage("진단할 국회 의사중계 탭을 찾지 못했습니다. 해당 탭에서 다시 열어주세요.");
          return;
        }

        if (!isSupportedAssemblyUrl(tab.url)) {
          setSnapshot(null);
          setUnsupported(true);
          setTabReady(false);
          setRequiresReload(false);
          clearReconnectTimer();
          setDiagnosticsMessage("국회 의사중계 페이지에서만 수집 진단을 볼 수 있습니다.");
          return;
        }

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
                setDiagnosticsMessage("현재 탭의 수집 진단 정보를 불러왔습니다.");
              }
              return;
            case "POPUP_FEEDBACK":
              return;
          }
        };

        const onDisconnect = (): void => {
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
        nextPort.postMessage({ type: "GET_STATUS" } satisfies PopupToContentMessage);
      } catch (error: unknown) {
        if (!active) {
          return;
        }

        const baseMessage =
          error instanceof Error ? error.message : "수집 진단 정보를 준비하지 못했습니다.";
        scheduleReconnect(`${baseMessage} 자동으로 다시 연결을 시도합니다.`);
      } finally {
        connecting = false;
      }
    };

    void connect();

    return () => {
      active = false;
      clearReconnectTimer();
      currentPort?.disconnect();
      currentPort = null;
    };
  }, [diagnosticsReloadToken, diagnosticsTabId, view]);

  const hasNumberFieldErrors = Object.values(numberFieldErrors).some(Boolean);
  const hasFieldErrors = hasNumberFieldErrors || Boolean(filenamePatternError);

  const updateField = <K extends keyof ExtensionSettings>(key: K, value: ExtensionSettings[K]): void => {
    setSettings((current) => (current ? { ...current, [key]: value } : current));
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
      updateField(field, Number(value) as ExtensionSettings[typeof field]);
    }
  };

  const handleSave = async (): Promise<void> => {
    if (!settings || hasFieldErrors) {
      if (hasFieldErrors) {
        setMessage("잘못된 입력을 먼저 고쳐주세요.");
      }
      return;
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

  return (
    <main className="options-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">{view === "diagnostics" ? "문제 확인" : "쉽게 설정"}</p>
          <h1>{view === "diagnostics" ? "자막 도우미 수집 진단" : "자막 도우미 환경 설정"}</h1>
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
              기본값은 켜짐입니다. 국회 중계 페이지를 열면 바로 수집을 시작하므로, 원하지 않으면 이 옵션을 꺼두세요.
            </div>

            <label className="setting-card">
              <div>
                <strong>미확정(인식 중) 자막 수집 안 함</strong>
                <span>하늘색 등 뒷배경이 아직 사라지지 않은 인식 중 자막을 확정 전까지 제외합니다.</span>
              </div>
              <input
                type="checkbox"
                checked={settings.filterUnconfirmedEnabled}
                onChange={(event) => updateField("filterUnconfirmedEnabled", event.target.checked)}
              />
            </label>

            <p className="settings-section-heading">복사 / 저장</p>
            <p className="settings-section-note">
              최근 복사 버튼, TXT 저장 형식, 수집 중 자동 저장 타이밍을 여기에서 조정할 수 있습니다.
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
                <span>{`사용 가능한 값: {date}, {committee}, {time}`}</span>
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
                <strong>TXT 저장에 타임스탬프 포함</strong>
                <span>끄면 자막 본문만 줄 단위로 저장합니다. 기본값은 꺼짐입니다.</span>
              </div>
              <input
                type="checkbox"
                checked={settings.txtExportTimestampsEnabled}
                onChange={(event) =>
                  updateField("txtExportTimestampsEnabled", event.target.checked)
                }
              />
            </label>

            <details className="advanced-card full-width">
              <summary>
                <span className="advanced-summary-title">고급 설정</span>
                <span className="advanced-summary-description">
                  필터와 내부 확인 주기를 세밀하게 조정합니다. 외국어 판정 범위는 이번 배치에서 넓히지 않았으니 특별한 이유가 없다면 기본값을 유지하세요.
                </span>
              </summary>
              <div className="advanced-grid">
                <label className="setting-card">
                  <div>
                    <strong>불필요한 자막 자동 제외</strong>
                    <span>
                      기본 noise filter는 한글/영문 중심 텍스트를 기준으로 숫자, 기호,
                      placeholder를 제외합니다. 외국어 원문을 최대한 남기려면 이 옵션을 끄세요.
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
              <span>수집 방식</span>
              <strong>{snapshot?.diagnostics.sourceLabel || "-"}</strong>
            </div>
            <div className="meta-row">
              <span>Observer</span>
              <strong>{snapshot?.diagnostics.observerActive ? "켜짐" : snapshot ? "꺼짐" : "-"}</strong>
            </div>
            <div className="meta-row">
              <span>Selector</span>
              <strong>{snapshot?.diagnostics.currentSelector || "-"}</strong>
            </div>
            <div className="meta-row">
              <span>Frame</span>
              <strong>
                {snapshot ? formatCaptureDiagnosticsFramePath(snapshot.diagnostics.currentFramePath) : "-"}
              </strong>
            </div>
            <div className="meta-row">
              <span>최근 저장</span>
              <strong>{snapshot?.lastPersistedAt ? new Date(snapshot.lastPersistedAt).toLocaleString("ko-KR") : "-"}</strong>
            </div>
          </div>

          <section className="diagnostics-subsection">
            <div className="subsection-header">
              <h3>저장 복구 상태</h3>
              <p>브라우저 시작 시 종료 직전 저장 replay와 stale running cleanup 결과입니다.</p>
            </div>
            <div className="meta-grid">
              <div className="meta-row">
                <span>마지막 replay</span>
                <strong>
                  {persistReplayDiagnostics.lastReplayAt
                    ? new Date(persistReplayDiagnostics.lastReplayAt).toLocaleString("ko-KR")
                    : "-"}
                </strong>
              </div>
              <div className="meta-row">
                <span>replay 성공/실패</span>
                <strong>
                  {persistReplayDiagnostics.lastReplayReplayedCount} / {persistReplayDiagnostics.lastReplayFailedCount}
                </strong>
              </div>
              <div className="meta-row">
                <span>replay 건너뜀</span>
                <strong>{persistReplayDiagnostics.lastReplaySkippedCount}</strong>
              </div>
              <div className="meta-row">
                <span>startup cleanup 성공/실패</span>
                <strong>
                  {persistReplayDiagnostics.lastCleanupClosedCount} / {persistReplayDiagnostics.lastCleanupFailedCount}
                </strong>
              </div>
              <div className="meta-row">
                <span>startup cleanup 감지</span>
                <strong>{persistReplayDiagnostics.lastCleanupDetectedCount}</strong>
              </div>
              {diagnosticsErrorRows.map((row) => (
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
