import { validateFilenamePattern } from "../../shared/filename-pattern";
import type { AssemblyPreset, ExtensionSettings, SegmentPreset } from "../../storage/types";
import { ADVANCED_NUMBER_FIELDS, BASIC_NUMBER_FIELDS } from "../settings-fields";
import { SettingInputCard } from "./SettingInputCard";
import { SettingToggleCard } from "./SettingToggleCard";
import { SettingsSection } from "./SettingsSection";
import {
  EMPTY_PRESET_DRAFT,
  SEGMENT_PRESET_OPTIONS,
  getFieldDescription,
  getFieldLabel,
  getFieldMin,
  getFieldUnit,
  getToggleCopy,
  type NumberDraftState,
  type NumberField,
  type NumberFieldErrorState,
} from "./settings-helpers";

export function SettingsView(props: {
  settings: ExtensionSettings;
  numberDrafts: NumberDraftState;
  numberFieldErrors: NumberFieldErrorState;
  filenamePatternError?: string;
  presetDraft: typeof EMPTY_PRESET_DRAFT;
  hasFieldErrors: boolean;
  updateField: <K extends keyof ExtensionSettings>(
    key: K,
    value: ExtensionSettings[K],
  ) => void;
  handleNumberDraftChange: (field: NumberField, value: string) => void;
  handleSegmentPresetChange: (preset: SegmentPreset) => void;
  setFilenamePatternError: (error: string | undefined) => void;
  handlePresetDraftChange: <K extends keyof typeof EMPTY_PRESET_DRAFT>(
    key: K,
    value: (typeof EMPTY_PRESET_DRAFT)[K],
  ) => void;
  handleAddPreset: () => void;
  handleUpdatePreset: <K extends keyof AssemblyPreset>(
    presetId: string,
    key: K,
    value: AssemblyPreset[K],
  ) => void;
  handleRemovePreset: (presetId: string) => void;
  handleSave: () => void;
  handleReset: () => void;
}) {
  const {
    settings,
    numberDrafts,
    numberFieldErrors,
    filenamePatternError,
    presetDraft,
    hasFieldErrors,
    updateField,
    handleNumberDraftChange,
    handleSegmentPresetChange,
    setFilenamePatternError,
    handlePresetDraftChange,
    handleAddPreset,
    handleUpdatePreset,
    handleRemovePreset,
    handleSave,
    handleReset,
  } = props;

  const presets = settings.presets ?? [];
  const autoStartCopy = getToggleCopy("autoStartEnabled");
  const autoSaveCopy = getToggleCopy("runningAutoSaveEnabled");
  const autoScrollCopy = getToggleCopy("autoScroll");
  const unconfirmedCopy = getToggleCopy("filterUnconfirmedEnabled");
  const speakerPanelCopy = getToggleCopy("panelSpeakerHighlightEnabled");
  const exportTimeCopy = getToggleCopy("txtExportTimestampsEnabled");
  const exportSpeakerCopy = getToggleCopy("txtExportSpeakerEnabled");
  const exportNotesCopy = getToggleCopy("txtExportEntryNotesEnabled");
  const noiseCopy = getToggleCopy("noiseFilterEnabled");
  const debugCopy = getToggleCopy("debugLogging");

  const renderNumberField = (field: NumberField, fullWidth = false) => {
    const fieldUnit = getFieldUnit(field);
    return (
      <SettingInputCard
        key={field}
        title={getFieldLabel(field)}
        description={getFieldDescription(field)}
        error={numberFieldErrors[field]}
        fullWidth={fullWidth}
      >
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
      </SettingInputCard>
    );
  };

  return (
    <>
      <div className="settings-stack">
        <SettingsSection title="수집" lead="중계 플레이어에서 자막을 모을 때">
          <SettingToggleCard
            title={autoStartCopy.title}
            description={autoStartCopy.description}
            caution={autoStartCopy.caution}
            checked={settings.autoStartEnabled}
            onChange={(checked) => updateField("autoStartEnabled", checked)}
          />
          <SettingToggleCard
            title={autoSaveCopy.title}
            description={autoSaveCopy.description}
            checked={settings.runningAutoSaveEnabled}
            onChange={(checked) => updateField("runningAutoSaveEnabled", checked)}
          />
          <SettingToggleCard
            title={autoScrollCopy.title}
            description={autoScrollCopy.description}
            checked={settings.autoScroll}
            onChange={(checked) => updateField("autoScroll", checked)}
          />
          <SettingToggleCard
            title={unconfirmedCopy.title}
            description={unconfirmedCopy.description}
            checked={settings.filterUnconfirmedEnabled}
            onChange={(checked) => updateField("filterUnconfirmedEnabled", checked)}
          />
        </SettingsSection>

        <SettingsSection
          title="화면 · 발언자"
          lead="패널·기록 화면에 보이는 방식"
        >
          <SettingToggleCard
            title={speakerPanelCopy.title}
            description={speakerPanelCopy.description}
            checked={Boolean(settings.panelSpeakerHighlightEnabled)}
            onChange={(checked) => updateField("panelSpeakerHighlightEnabled", checked)}
            fullWidth
          />
          <p className="settings-section-note full-width">
            중계 페이지 패널의 「발언자 보기」와 같은 설정입니다.
          </p>
        </SettingsSection>

        <SettingsSection title="복사 · 파일 이름" lead="복사 버튼과 저장 파일 이름">
          {BASIC_NUMBER_FIELDS.map((field) => renderNumberField(field))}
          <SettingInputCard
            title={getFieldLabel("filenamePattern")}
            description={getFieldDescription("filenamePattern")}
            error={filenamePatternError}
            fullWidth
          >
            <input
              type="text"
              aria-label={getFieldLabel("filenamePattern")}
              aria-invalid={Boolean(filenamePatternError)}
              value={settings.filenamePattern}
              onChange={(event) => {
                const nextValue = event.target.value;
                updateField("filenamePattern", nextValue);
                setFilenamePatternError(validateFilenamePattern(nextValue));
              }}
            />
          </SettingInputCard>
        </SettingsSection>

        <SettingsSection
          title="내보내기 내용"
          lead="파일·복사본에 넣을 정보 (기본은 자막 본문만)"
        >
          <SettingToggleCard
            title={exportTimeCopy.title}
            description={exportTimeCopy.description}
            checked={settings.txtExportTimestampsEnabled}
            onChange={(checked) => updateField("txtExportTimestampsEnabled", checked)}
          />
          <SettingToggleCard
            title={exportSpeakerCopy.title}
            description={exportSpeakerCopy.description}
            checked={Boolean(settings.txtExportSpeakerEnabled)}
            onChange={(checked) => updateField("txtExportSpeakerEnabled", checked)}
          />
          <SettingToggleCard
            title={exportNotesCopy.title}
            description={exportNotesCopy.description}
            checked={Boolean(settings.txtExportEntryNotesEnabled)}
            onChange={(checked) => updateField("txtExportEntryNotesEnabled", checked)}
          />
          <p className="settings-section-note full-width">
            기록 백업(JSON)에는 발언자 정보가 복원용으로 항상 들어갑니다. 중계 페이지 패널의
            「내보내기·복사」 토글과 같은 설정입니다.
          </p>
        </SettingsSection>

        <section className="settings-section">
          <details className="advanced-card">
            <summary>
              <span className="advanced-summary-title">고급</span>
              <span className="advanced-summary-description">
                대부분 기본값으로 충분합니다. 자막 제외·로그·긴 회의 나누기를 조정합니다.
              </span>
            </summary>
            <div className="advanced-grid">
              <SettingToggleCard
                title={noiseCopy.title}
                description={noiseCopy.description}
                checked={settings.noiseFilterEnabled}
                onChange={(checked) => updateField("noiseFilterEnabled", checked)}
              />
              <SettingToggleCard
                title={debugCopy.title}
                description={debugCopy.description}
                checked={settings.debugLogging}
                onChange={(checked) => updateField("debugLogging", checked)}
              />
              <div className="setting-card input-card full-width">
                <div>
                  <strong>긴 회의 나누기</strong>
                  <span>회의가 길면 파일을 나누어 저장합니다.</span>
                </div>
                <div className="preset-grid" role="radiogroup" aria-label="긴 회의 나누기">
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
              {ADVANCED_NUMBER_FIELDS.map((field) => renderNumberField(field))}
              <p className="settings-section-note full-width">
                숫자를 직접 바꾸면 「직접 설정」으로 전환됩니다.
              </p>
            </div>
          </details>
        </section>

        <SettingsSection
          title="자주 쓰는 회의 프리셋"
          lead="자주 보는 회의를 저장해 두면 팝업에서 바로 열 수 있습니다"
        >
          <div className="note-card full-width">
            {presets.length ? (
              <div className="meta-grid">
                {presets.map((preset) => (
                  <div className="meta-row preset-edit-row" key={preset.id}>
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
                    <label className="preset-mini-toggle">
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
                    <label className="preset-mini-toggle">
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
            <div className="advanced-grid preset-draft-grid">
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
              <SettingToggleCard
                title="자동 시작"
                description="이 페이지를 열 때 바로 자막 모으기를 시작합니다."
                checked={presetDraft.autoStartEnabled}
                onChange={(checked) => handlePresetDraftChange("autoStartEnabled", checked)}
              />
              <SettingToggleCard
                title="잡음 줄 제외"
                description="이 페이지에서 숫자·기호·안내 문구를 자동으로 뺍니다."
                checked={presetDraft.noiseFilterEnabled}
                onChange={(checked) => handlePresetDraftChange("noiseFilterEnabled", checked)}
              />
              <button type="button" onClick={handleAddPreset}>
                프리셋 추가
              </button>
            </div>
          </div>
        </SettingsSection>
      </div>

      <footer className="actions settings-actions">
        <button type="button" onClick={handleSave} disabled={hasFieldErrors}>
          저장
        </button>
        <button className="secondary" type="button" onClick={handleReset}>
          기본값으로 되돌리기
        </button>
      </footer>
    </>
  );
}
