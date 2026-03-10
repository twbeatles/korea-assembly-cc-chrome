import { useEffect, useState } from "react";

import { getSettings, resetSettings, saveSettings } from "../storage/settings-store";
import type { ExtensionSettings } from "../storage/types";

const numericFields: Array<keyof ExtensionSettings> = [
  "keepaliveIntervalMs",
  "pollingFallbackIntervalMs",
  "maxBufferLength",
  "noiseMinLength",
];

export default function App() {
  const [settings, setSettings] = useState<ExtensionSettings | null>(null);
  const [message, setMessage] = useState("설정을 불러오는 중입니다.");

  useEffect(() => {
    void getSettings()
      .then((data) => {
        setSettings(data);
        setMessage("설정을 수정한 뒤 저장하세요.");
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
    setMessage("기본 설정으로 되돌렸습니다.");
  };

  if (!settings) {
    return <main className="options-shell">설정을 불러오는 중입니다.</main>;
  }

  return (
    <main className="options-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Options</p>
          <h1>국회 자막 추출 설정</h1>
        </div>
        <p>{message}</p>
      </header>

      <section className="settings-grid">
        <label className="setting-card">
          <div>
            <strong>자동 스크롤</strong>
            <span>popup preview 영역을 최신 항목에 맞춰 유지합니다.</span>
          </div>
          <input
            type="checkbox"
            checked={settings.autoScroll}
            onChange={(event) => updateField("autoScroll", event.target.checked)}
          />
        </label>

        <label className="setting-card">
          <div>
            <strong>디버그 로깅</strong>
            <span>content script 콘솔 로그를 상세하게 남깁니다.</span>
          </div>
          <input
            type="checkbox"
            checked={settings.debugLogging}
            onChange={(event) => updateField("debugLogging", event.target.checked)}
          />
        </label>

        <label className="setting-card">
          <div>
            <strong>노이즈 필터 활성화</strong>
            <span>숫자-only / 기호-only 자막을 필터링합니다.</span>
          </div>
          <input
            type="checkbox"
            checked={settings.noiseFilterEnabled}
            onChange={(event) => updateField("noiseFilterEnabled", event.target.checked)}
          />
        </label>

        {numericFields.map((field) => (
          <label className="setting-card input-card" key={field}>
            <div>
              <strong>{field}</strong>
              <span>
                {field === "keepaliveIntervalMs" && "동일 raw 유지 시 endTime 갱신 간격"}
                {field === "pollingFallbackIntervalMs" && "observer 불안정 시 polling 간격"}
                {field === "maxBufferLength" && "compact history 메모리 상한"}
                {field === "noiseMinLength" && "후단 정제용 최소 길이 기준"}
              </span>
            </div>
            <input
              type="number"
              min={field === "maxBufferLength" ? 1000 : 1}
              value={settings[field]}
              onChange={(event) =>
                updateField(field, Number(event.target.value) as ExtensionSettings[typeof field])
              }
            />
          </label>
        ))}

        <label className="setting-card input-card full-width">
          <div>
            <strong>파일명 패턴</strong>
            <span>{`지원 토큰: {date}, {committee}, {time}`}</span>
          </div>
          <input
            type="text"
            value={settings.filenamePattern}
            onChange={(event) => updateField("filenamePattern", event.target.value)}
          />
        </label>
      </section>

      <footer className="actions">
        <button onClick={handleSave}>저장</button>
        <button className="secondary" onClick={handleReset}>
          기본값 복원
        </button>
      </footer>
    </main>
  );
}
