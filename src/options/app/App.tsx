import { useEffect, useState } from "react";

import {
  POPUP_PORT_NAME,
  SESSION_SEGMENT_PRESETS,
  isSupportedAssemblyUrl,
} from "../../shared/constants";
import {
  addTabActivatedListener,
  addTabRemovedListener,
  addTabUpdatedListener,
  connectToTab,
  removeTabActivatedListener,
  removeTabRemovedListener,
  removeTabUpdatedListener,
  sendRuntimeMessage,
} from "../../shared/chrome-api";
import type {
  ContentToPopupMessage,
  PopupToContentMessage,
  StatusSnapshot,
} from "../../shared/message-types";
import { getCaptureStatusLabel } from "../../shared/ui-labels";
import {
  createEmptyPersistReplayDiagnostics,
  readPersistReplayDiagnostics,
} from "../../storage/persist-recovery";
import { getSettings, resetSettings, saveSettings } from "../../storage/settings-store";
import type {
  AssemblyPreset,
  ExtensionSettings,
  PersistReplayDiagnostics,
  SegmentPreset,
} from "../../storage/types";
import { createPrefixedRandomToken } from "../../shared/random-token";
import {
  EMPTY_PRESET_DRAFT,
  SETTINGS_DEFAULT_MESSAGE,
  buildNumberDraftState,
  getCaptureModeSummary,
  getInitialDiagnosticsTabId,
  getInitialView,
  mergeSnapshot,
  resolveDiagnosticsTab,
  updateUrl,
  validateNumberDraft,
  type NumberDraftState,
  type NumberField,
  type NumberFieldErrorState,
  type OptionsView,
} from "./settings-helpers";
import { SettingsView } from "./SettingsView";

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
        setMessage(SETTINGS_DEFAULT_MESSAGE);
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

  return (
    <main className="options-shell">
      <header className="hero">
        <div>
          <h1>{view === "diagnostics" ? "수집 진단" : "환경 설정"}</h1>
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
            설정
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "diagnostics"}
            className={view === "diagnostics" ? "view-button" : "view-button secondary"}
            onClick={() => handleViewChange("diagnostics")}
          >
            수집 진단
          </button>
        </div>
      </header>

      {view === "settings" ? (
        <SettingsView
          settings={settings}
          numberDrafts={numberDrafts}
          numberFieldErrors={numberFieldErrors}
          filenamePatternError={filenamePatternError}
          presetDraft={presetDraft}
          hasFieldErrors={hasFieldErrors}
          updateField={updateField}
          handleNumberDraftChange={handleNumberDraftChange}
          handleSegmentPresetChange={handleSegmentPresetChange}
          setFilenamePatternError={setFilenamePatternError}
          handlePresetDraftChange={handlePresetDraftChange}
          handleAddPreset={handleAddPreset}
          handleUpdatePreset={handleUpdatePreset}
          handleRemovePreset={handleRemovePreset}
          handleSave={() => {
            void handleSave();
          }}
          handleReset={() => {
            void handleReset();
          }}
        />
      ) : (
        <section className="diagnostics-panel">
          <div className="diagnostics-header">
            <div>
              <p className="eyebrow">선택한 탭 기준</p>
              <h2>수집 진단</h2>
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
              설정으로
            </button>
          </footer>
        </section>
      )}
    </main>
  );
}
