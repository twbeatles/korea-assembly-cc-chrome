import { useEffect, useState } from "react";

import { ASSEMBLY_HOST, POPUP_PORT_NAME } from "../shared/constants";
import { formatCaptureDiagnosticsFramePath } from "../shared/capture-diagnostics";
import { connectToTab, getTab, queryTabs, sendRuntimeMessage } from "../shared/chrome-api";
import type {
  ContentToPopupMessage,
  PopupToContentMessage,
  StatusSnapshot,
} from "../shared/message-types";
import { getCaptureStatusLabel, UI_TEXT } from "../shared/ui-labels";
import { getSettings, resetSettings, saveSettings } from "../storage/settings-store";
import type { ExtensionSettings } from "../storage/types";

type OptionsView = "settings" | "diagnostics";

const BASIC_NUMBER_FIELDS: Array<keyof ExtensionSettings> = [
  "runningAutoSaveDebounceMs",
  "recentCopyLineCount",
];

const ADVANCED_NUMBER_FIELDS: Array<keyof ExtensionSettings> = [
  "keepaliveIntervalMs",
  "pollingFallbackIntervalMs",
  "maxBufferLength",
  "recentDuplicateMinLength",
];

function getFieldLabel(field: keyof ExtensionSettings): string {
  switch (field) {
    case "runningAutoSaveDebounceMs":
      return "자동 저장 간격(ms)";
    case "recentCopyLineCount":
      return "방금 복사 줄 수";
    case "keepaliveIntervalMs":
      return "같은 자막 유지 확인 간격(ms)";
    case "pollingFallbackIntervalMs":
      return "보조 확인 간격(ms)";
    case "maxBufferLength":
      return "최대 기억 길이";
    case "recentDuplicateMinLength":
      return "중복 차단 최소 길이";
    default:
      return field;
  }
}

function getFieldDescription(field: keyof ExtensionSettings): string {
  switch (field) {
    case "runningAutoSaveDebounceMs":
      return "수집 중 저장을 너무 자주 하지 않도록 간격을 둡니다.";
    case "recentCopyLineCount":
      return "최근 내용 복사 버튼에 포함할 문장 수입니다.";
    case "keepaliveIntervalMs":
      return "같은 자막이 이어질 때 종료 시각을 얼마나 자주 늘릴지 정합니다.";
    case "pollingFallbackIntervalMs":
      return "자동 감시가 약할 때 페이지를 다시 읽는 간격입니다.";
    case "maxBufferLength":
      return "중복 확인에 쓰는 내부 기억 길이입니다.";
    case "recentDuplicateMinLength":
      return "최근 자막 tail과 비교해 중복으로 무시할 최소 compact 길이입니다.";
    default:
      return "";
  }
}

function getFieldMin(field: keyof ExtensionSettings): number {
  switch (field) {
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
    (tab) => typeof tab.id === "number" && typeof tab.url === "string" && tab.url.startsWith(ASSEMBLY_HOST),
  );
  candidates.sort((left, right) => (right.lastAccessed ?? 0) - (left.lastAccessed ?? 0));
  return candidates[0] ?? null;
}

function mergeSnapshot(
  current: StatusSnapshot | null,
  message: Exclude<ContentToPopupMessage, { type: "ERROR" }>,
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
        subtitleCount: current?.subtitleCount ?? 0,
        charCount: current?.charCount ?? 0,
        previewText: current?.previewText ?? "",
        recentEntries: current?.recentEntries ?? [],
        startedAt: message.payload.startedAt,
        endedAt: message.payload.endedAt,
        updatedAt: message.payload.updatedAt,
        lastPersistedAt: message.payload.lastPersistedAt,
        observerActive: message.payload.observerActive,
        currentSelector: message.payload.currentSelector,
        currentFramePath: message.payload.currentFramePath,
        diagnostics: message.payload.diagnostics,
      };
    case "PREVIEW_UPDATE":
      return current
        ? {
            ...current,
            previewText: message.payload.previewText,
            recentEntries: message.payload.recentEntries,
          }
        : current;
    case "SESSION_STATS":
      return current
        ? {
            ...current,
            subtitleCount: message.payload.subtitleCount,
            charCount: message.payload.charCount,
          }
        : current;
  }
}

export default function App() {
  const [settings, setSettings] = useState<ExtensionSettings | null>(null);
  const [message, setMessage] = useState("설정을 불러오는 중입니다.");
  const [view, setView] = useState<OptionsView>(getInitialView);
  const [diagnosticsTabId] = useState<number | null>(getInitialDiagnosticsTabId);
  const [diagnosticsReloadToken, setDiagnosticsReloadToken] = useState(0);
  const [snapshot, setSnapshot] = useState<StatusSnapshot | null>(null);
  const [diagnosticsMessage, setDiagnosticsMessage] = useState(
    "현재 탭의 수집 상태를 확인하고 있습니다.",
  );
  const [tabReady, setTabReady] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [requiresReload, setRequiresReload] = useState(false);

  useEffect(() => {
    void getSettings()
      .then((data) => {
        setSettings(data);
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

        if (!tab.url.startsWith(ASSEMBLY_HOST)) {
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

  const updateField = <K extends keyof ExtensionSettings>(key: K, value: ExtensionSettings[K]): void => {
    setSettings((current) => (current ? { ...current, [key]: value } : current));
  };

  const handleSave = async (): Promise<void> => {
    if (!settings) {
      return;
    }

    try {
      const next = await saveSettings(settings);
      setSettings(next);
      setMessage("설정을 저장했습니다.");
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "설정을 저장하지 못했습니다.");
    }
  };

  const handleReset = async (): Promise<void> => {
    try {
      const next = await resetSettings();
      setSettings(next);
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

  if (!settings) {
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
            <label className="setting-card">
              <div>
                <strong>자동으로 따라가기</strong>
                <span>페이지 패널의 실시간 내용과 화면 자막을 자동으로 맨 아래로 맞춥니다.</span>
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

            {BASIC_NUMBER_FIELDS.map((field) => (
              <label className="setting-card input-card" key={field}>
                <div>
                  <strong>{getFieldLabel(field)}</strong>
                  <span>{getFieldDescription(field)}</span>
                </div>
                <input
                  type="number"
                  min={getFieldMin(field)}
                  value={String(settings[field])}
                  onChange={(event) =>
                    updateField(field, Number(event.target.value) as ExtensionSettings[typeof field])
                  }
                />
              </label>
            ))}

            <label className="setting-card input-card full-width">
              <div>
                <strong>파일 이름 규칙</strong>
                <span>{`쓸 수 있는 값: {date}, {committee}, {time}`}</span>
              </div>
              <input
                type="text"
                value={settings.filenamePattern}
                onChange={(event) => updateField("filenamePattern", event.target.value)}
              />
            </label>

            <details className="advanced-card full-width">
              <summary>고급 설정 보기</summary>
              <div className="advanced-grid">
                <label className="setting-card">
                  <div>
                    <strong>불필요한 자막 걸러내기</strong>
                    <span>
                      숫자만 있거나 기호만 있는 자막을 자동으로 제외합니다. 끄면 원문을 최대한 남깁니다.
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
                    <strong>개발용 자세한 기록</strong>
                    <span>문제가 있을 때 브라우저 콘솔에 더 많은 정보를 남깁니다.</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.debugLogging}
                    onChange={(event) => updateField("debugLogging", event.target.checked)}
                  />
                </label>

                {ADVANCED_NUMBER_FIELDS.map((field) => (
                  <label className="setting-card input-card" key={field}>
                    <div>
                      <strong>{getFieldLabel(field)}</strong>
                      <span>{getFieldDescription(field)}</span>
                    </div>
                    <input
                      type="number"
                      min={getFieldMin(field)}
                      value={String(settings[field])}
                      onChange={(event) =>
                        updateField(
                          field,
                          Number(event.target.value) as ExtensionSettings[typeof field],
                        )
                      }
                    />
                  </label>
                ))}
              </div>
            </details>
          </section>

          <footer className="actions">
            <button onClick={handleSave}>저장</button>
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
