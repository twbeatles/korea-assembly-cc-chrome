import { useEffect, useState } from "react";

import { getSettings, resetSettings, saveSettings } from "../storage/settings-store";
import type { ExtensionSettings } from "../storage/types";

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
    case "maxBufferLength":
      return 1000;
    case "runningAutoSaveDebounceMs":
      return 250;
    default:
      return 1;
  }
}

export default function App() {
  const [settings, setSettings] = useState<ExtensionSettings | null>(null);
  const [message, setMessage] = useState("설정을 불러오는 중입니다.");

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

  const updateField = <K extends keyof ExtensionSettings>(
    key: K,
    value: ExtensionSettings[K],
  ): void => {
    setSettings((current) => (current ? { ...current, [key]: value } : current));
  };

  const handleSave = async (): Promise<void> => {
    if (!settings) {
      return;
    }
    const next = await saveSettings(settings);
    setSettings(next);
    setMessage("설정을 저장했습니다.");
  };

  const handleReset = async (): Promise<void> => {
    const next = await resetSettings();
    setSettings(next);
    setMessage("기본값으로 되돌렸습니다.");
  };

  if (!settings) {
    return <main className="options-shell">설정을 불러오는 중입니다.</main>;
  }

  return (
    <main className="options-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">쉽게 설정</p>
          <h1>자막 도우미 환경 설정</h1>
        </div>
        <p>{message}</p>
      </header>

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
            <span>숫자만 있거나 기호만 있는 자막을 자동으로 제외합니다. 끄면 원문을 최대한 남깁니다.</span>
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
    </main>
  );
}
