# Project Audit

**대상:** `korea-assembly-cc-chrome` (국회 AI 자막 추출 Chrome Extension)  
**감사 일자:** 2026-08-10 (4차 · **발언자 색 표시 · 내보내기/복사 화자 옵션** 중심)  
**배포 버전 기준:** 감사 시점 `1.0.12` / 후속 반영·스토어 준비 `1.0.13`  
**방법:** `README.md` / `CLAUDE.md` 정독 → CodeGraph MCP 호출 관계·소스 대조 → 보조적으로 설정·export·패널 경로 교차 확인  

> **4차 초점**  
> 1. `panelSpeakerHighlightEnabled` — 우측 패널 발언자 색/뱃지  
> 2. `txtExportSpeakerEnabled` 의미 확장 — TXT·SRT·VTT·복사 화자 접두  
> 3. `export-payload` strip 정책 변경 (JSON 발언자 메타 유지)  
> 4. History 내보내기/복사 옵션 전달  
> 5. 문서·옵션 문구·포맷별 동작 정합  
>
> **1–3차에서 이미 다룬 축 (재고발하지 않음, 전제만 유지):**  
> lifecycle lock · session write 큐 · IDB TTL · CSV BOM · DOWNLOAD_REQUEST 한도 ·  
> messaging permanent/transient · 롤오버 큐 · timeRange · fallback memory · shadow closed ·  
> unconfirmed 샘플링 · page Blob revoke · multi-tab soft ownership  

**주의:** 본 문서는 **코드 수정 없이** 감사만 수행한 결과다. High-Risk는 실제 코드 근거가 있는 항목만 싣고, 추정은 §4에 분리한다.

---

## 1. Executive Summary

이 제품은 국회 의사중계 AI 자막을 수집·로컬 저장·다형식 내보내기하는 Manifest V3 확장이다. 4차는 최근 추가된 **발언자 UI/출력 옵션**의 데이터 흐름·포맷 정합·문서 드리프트·테스트 공백을 본다.

**전체 위험도: Low–Medium**

| 등급 | 개수(4차 범위) | 요약 |
|------|----------------|------|
| Critical | 0 | 전손·보안 즉시 사고 경로는 확인되지 않음 |
| High | 0 | 확정 High 없음 |
| Medium | 3 | (1) 옵션 라벨 vs MD/CSV·JSON 실제 동작 불일치 (2) TXT vs 복사/SRT·VTT 발언자 표기 형식 불일치 (3) History export 크기 추정이 발언자 옵션을 반영하지 않음 |
| Low | 다수 | multi-span 화자 한계, `speakerChanged` 미기록, 문서 미반영, export-payload 전용 테스트 약함, CSS color 인라인 신뢰 |

**강점 (사실):**

- 수집 경로에 이미 `speakerColor` / `speakerChannel` 이 있으며 pipeline merge 가 channel/color 변경 시 entry 를 분리한다 (`commit.ts`).  
- 패널은 `textContent` + closed Shadow DOM 으로 뱃지/본문을 쓰며, channel 값은 타입·import sanitize 범위(`primary`/`secondary`/`unknown`)로 제한된다.  
- 설정 sanitize 가 신규 키 `panelSpeakerHighlightEnabled` 기본값(`true`)을 채운다.  
- storage `onChanged` → `sanitizeSettings` → `syncUserInterfaces()` 로 패널 하이라이트 옵션이 런타임에 반영된다.  
- History 내보내기에 `txtExportSpeakerEnabled` 전달이 연결되어 패널/History 경로가 옵션을 공유한다.  
- JSON export 는 발언자 메타를 strip 하지 않도록 바뀌어 세션 복원 관점에서 일관성이 개선됐다.

**한 줄 결론:** 기능 골격은 안전하고 동작 가능하나, **“내보내기 옵션”의 포맷별 의미와 표기 형식을 통일하지 않으면 사용자 혼란과 추정 크기/문서 드리프트가 남는다.** Critical 수정은 불필요하며, 1단계는 정합·문서·추정 보정, 2단계는 정확도(화자 분리), 3단계는 스키마/테스트 정리다.

---

## 2. Project Understanding

### 2.1 목적 (README / CLAUDE)

| 항목 | 내용 |
|------|------|
| 제품 | 국회 의사중계 AI 자막 실시간 수집 · 저장 · History · export |
| 호스트 | `assembly.webcast.go.kr`, `webcast.assembly.go.kr` |
| 수집 범위 | 플레이어(`main/player*`, `pressplayer*`); 홈(`/main`)은 패널·진단만 |
| 스택 | MV3 · TypeScript · React · Vite · Vitest · IndexedDB(+fallback) |
| 저장 원칙 | 확정(committed) 자막만 persist/export; preview-only 승격 금지 |
| 검증 | `lint` / `typecheck` / `test` / `build` / `verify:e2e` |

### 2.2 엔트리·모듈 (CodeGraph + CLAUDE 구조)

```text
content-script (멱등 bootstrap)
  └─ orchestrator / runtime-core
       ├─ injected-observer (page world) + local polling + frame probe
       ├─ live-capture + subtitle-pipeline (commit/merge/speaker boundary)
       ├─ settings (getSettings / storage.onChanged)
       ├─ updateInPagePanel → showSpeakerHighlight
       ├─ exportCurrentSession → DOWNLOAD_SESSION_EXPORT + txtExport*
       └─ copyRecentSessionLines → buildCopyText(includeSpeaker)

background SW
  └─ service-worker-commands
       └─ exportSessionData / exportSessionLineageData
            └─ createSessionExportPayload (strip + per-format exporter)

history (React)
  ├─ selectHistoryViewSettings (txtExportSpeakerEnabled live-sync)
  ├─ handleExport → DOWNLOAD_* + txtExportSpeakerEnabled
  └─ SessionDetailPanel 복사 → buildCopyText(includeSpeaker, session)

options
  └─ panelSpeakerHighlightEnabled · txtExportSpeakerEnabled 토글
```

### 2.3 발언자 기능 데이터 흐름 (CodeGraph 기준)

```text
DOM .smi_word
  → readSpeakerColor / classifySpeakerChannel (subtitle-rows / injected-observer)
  → ObservedSubtitleRow.speakerColor|Channel
  → live-capture row · SubtitleEntry
  → panel LivePanelRow
       → createLiveRowCard / applyLiveRowSpeakerPresentation
            (borderLeftColor, class speaker-*, badge A|B|?)
  → export / copy
       → resolveSpeakerLabelForOutput
            (entry.speakerLabel → session.speakerLabels → 발언자 A/B)
```

**설정 키**

| 키 | 기본 | 역할 |
|----|------|------|
| `panelSpeakerHighlightEnabled` | `true` | 패널 색 띠·뱃지 |
| `txtExportSpeakerEnabled` | `false` | TXT·SRT·VTT·복사 화자 포함 (키 이름 유지, 의미 확장) |

**export-payload strip 정책 (현재 코드)**

| format | stripSpeakerMetadata | 화자 본문 반영 |
|--------|----------------------|----------------|
| json | 항상 false (메타 유지) | JSON 필드 보존 |
| md / csv | false | 표/열에 발언자 **항상** (옵션 off여도 열 유지) |
| txt / srt / vtt | `!txtExportSpeakerEnabled` | 옵션 on 일 때만 접두/라벨 |

### 2.4 주요 파일 앵커

| 영역 | 경로 |
|------|------|
| 설정 타입·기본값 | `src/storage/types.ts`, `src/shared/constants.ts`, `settings-store.ts` |
| 공통 라벨 | `src/core/exporters/speaker-label.ts` |
| 패널 | `inpage-panel/dom/builders.ts`, `controller/render.ts`, `styles.ts`, `state.ts` |
| runtime | `orchestrator/runtime-core.ts` (`updateInPagePanel`, `copyRecentSessionLines`) |
| export | `session-store/export-payload.ts`, `exporters/{txt,srt,vtt,csv,markdown}.ts` |
| 복사 | `src/shared/copy-utils.ts` |
| History | `history/app/App.tsx`, `sections/SessionDetailPanel.tsx` |
| Options UI | `options/app/App.tsx`, `settings-fields.ts` |

---

## 3. High-Risk Issues

4차 범위에서 **Critical / High 는 없음.** 아래는 근거 있는 Medium·Low 이다.

---

### M1. 옵션 문구 “내보내기·복사에 발언자 포함” vs MD/CSV·JSON 실제 동작

* **위치:** `src/options/app/App.tsx` (토글 문구), `src/storage/session-store/export-payload.ts` (`stripSpeakerMetadata` / format 분기)
* **문제:** 옵션 제목은 내보내기 전반에 발언자가 토글되는 것처럼 읽히나, **MD/CSV는 옵션 off여도 발언자 열을 유지**하고, **JSON은 항상 speaker 메타를 남긴다.** 도움말 문장에 MD/CSV 유지는 적혀 있으나 제목과 체감이 어긋날 수 있다.
* **영향:** 사용자가 “발언자 끄기”로 기대한 후 MD/CSV/JSON 에서 화자가 남아 프라이버시·공유 범위 오해 가능. 기능 버그라기보다 **제품 계약 불명확**.
* **근거:** `export-payload.ts` 에서 `format === "md" \|\| csv` 는 strip false 고정; `json` strip false 고정; 옵션은 txt/srt/vtt 에만 실질 영향.
* **권장 수정 방향:** (A) 옵션 제목을 「TXT·SRT·VTT·복사에 발언자 포함」으로 좁히거나 (B) MD/CSV 도 옵션 off 시 열 비우기/제거를 명시적으로 지원. JSON 은 “복원용 항상 포함”을 UI에 한 줄로 고지.
* **우선순위:** Medium

---

### M2. 발언자 표기 형식이 출력 경로마다 다름

* **위치:**  
  - TXT: `src/core/exporters/txt.ts` — 접두 없이 `발언자 A` 를 공백 join  
  - 복사: `src/shared/copy-utils.ts` — `formatSpeakerPrefix` → `[발언자 A] `  
  - SRT/VTT: `exportSrt` / `exportVtt` — `[발언자 A] ` 접두  
  - MD/CSV: 열 값만 (대괄호 없음)
* **문제:** 동일 옵션·동일 세션인데 경로마다 문자열이 달라 후처리 스크립트·사용자 복붙 일관성이 깨진다.
* **영향:** 자동화/정규식 파싱 실패, “복사한 내용과 TXT 가 다름” 문의.
* **근거:**  
  - TXT: `prefix = [timestamp?, resolveSpeakerLabelForOutput(...)]` 후 `join(" ")`  
  - 복사/SRT/VTT: `formatSpeakerPrefix` → `[label] `
* **권장 수정 방향:** `formatSpeakerPrefix` 를 TXT 에도 사용하거나, 공통 `formatSpeakerInline(label, style: "bracket" \| "plain")` 로 통일. 회귀 테스트에 세 경로 동일 스냅샷.
* **우선순위:** Medium

---

### M3. History export 바이트 추정이 발언자 옵션을 무시

* **위치:** `src/history/app/helpers.ts` — `estimateSessionExportBytes`  
  호출: `src/history/app/App.tsx` (`txtExportTimestampsEnabled` 만 전달)
* **문제:** 추정은 `normalizeSessionForExport(session)` 기본값으로 **speaker 메타 strip** 후, TXT 에 `includeSpeaker` 없이·SRT/VTT 도 speaker 없이 계산한다. 사용자가 발언자 옵션을 켠 실제 다운로드 크기와 어긋난다.
* **영향:** 대형 세션에서 “예상 크기” 과소 표시, 분할 export 판단 오류 가능 (치명적이진 않음).
* **근거:**  
  ```ts
  normalizeSessionForExport(session); // stripSpeakerMetadata default true
  exportTxt(normalized, { includeTimestamps }); // no includeSpeaker
  exportSrt(normalized); exportVtt(normalized);
  ```
* **권장 수정 방향:** `estimateSessionExportBytes(session, { timestamps, speaker })` 로 옵션 반영; History state 의 `txtExportSpeakerEnabled` 전달.
* **우선순위:** Medium

---

### L1. 한 `.smi_word` 다중 span 화자 → 첫 span 색만 반영

* **위치:** `src/content/subtitle-rows.ts` — `readSpeakerColor` (`querySelector("span")` 첫 매치)
* **문제:** 사이트 AI 자막은 한 segment 에 여러 span·색을 둘 수 있다. 확장은 노드 단위 1 channel 만 기록한다.
* **영향:** 한 줄 안 화자 전환이 A/B 로 안 갈리고, 패널 색·export 라벨이 부정확할 수 있음. (사이트 계약 한계, 신규 옵션 이전부터 존재)
* **근거:** `readSpeakerColor` 가 첫 span 의 computed color 만 사용; multi-span split 없음.
* **권장 수정 방향:** span 단위 분할 commit (별 기능). 단기: unknown 비율 진단 지표.
* **우선순위:** Low (정확도)

---

### L2. `speakerChanged` 필드는 스키마에만 존재하고 수집 경로에서 미설정

* **위치:** `SubtitleEntry.speakerChanged` (`subtitle-models.ts`); 수집/commit 에는 대입 없음; import sanitize 만 보존 (`session-backup.ts`)
* **문제:** dead field. merge 는 channel/color 비교로 분리하지만 플래그는 남지 않음.
* **영향:** 향후 “화자 전환 지점” UI/검색을 기대하면 빈 값. 현재 사용자 기능 파괴는 없음.
* **근거:** 저장소 내 `speakerChanged =` 설정 코드 없음 (테스트 fixture·import sanitize 제외).
* **권장 수정 방향:** commit 시 channel 변경이면 `speakerChanged: true` 설정, 또는 필드 deprecate 문서화.
* **우선순위:** Low

---

### L3. 패널 accent 에 저장/관측된 `speakerColor` 문자열을 그대로 `style.borderLeftColor` 에 사용

* **위치:** `applyLiveRowSpeakerPresentation` — `article.style.borderLeftColor = accent`
* **문제:** 정상 경로는 `getComputedStyle` 의 `rgb(...)` 이다. import 된 비정상 문자열은 브라우저가 무시하는 수준이나, 검증 없이 인라인 스타일에 넣는다.
* **영향:** XSS 로 보기 어렵고(속성 텍스트 아님, CSS color 파서), 깨진 색·과한 문자열 정도. 보안 위험은 낮음.
* **근거:** `resolveSpeakerAccentColor` 가 non-empty string 이면 그대로 반환.
* **권장 수정 방향:** `/^rgb\(/` 또는 hex 화이트리스트; 실패 시 channel 기본색.
* **우선순위:** Low

---

### L4. README / CLAUDE 와 신규 옵션 설명 불일치

* **위치:** `README.md` (TXT “타임스탬프·발언자 옵션” 수준), `CLAUDE.md` (신규 키·패널 표시 미기재)
* **문제:** 패널 발언자 색 토글, SRT/VTT/복사 확장, JSON 메타 유지 정책이 루트 문서에 없다.
* **영향:** 다음 에이전트·기여자 회귀 및 스토어 설명 누락.
* **근거:** README 발언자 언급은 TXT 한 줄; CLAUDE 에 `panelSpeakerHighlightEnabled` 없음.
* **권장 수정 방향:** README 옵션 표·CLAUDE Sync Delta 한 블록 추가.
* **우선순위:** Low (문서)

---

### L5. `createSessionExportPayload` 전용 단위 테스트 공백 (CodeGraph blast)

* **위치:** `src/storage/session-store/export-payload.ts`
* **문제:** CodeGraph 기준 이 심볼에 **직접 covering test 가 약함** (session-store 통합 테스트는 있으나 format×speaker 매트릭스 부재).
* **영향:** strip/include 분기 회귀 시 늦게 발견 (JSON 메타 유지 변경이 기존 테스트 1건을 깨뜨린 사례가 이미 있었음).
* **근거:** CodeGraph “⚠️ no covering tests found” for `createSessionExportPayload`; 최근 session-store 테스트 기대값 수정 이력.
* **권장 수정 방향:** format × `txtExportSpeakerEnabled` 표 스냅샷 테스트 추가.
* **우선순위:** Low–Medium (테스트 부채)

---

## 4. Potential Functional Gaps

확실하지 않은 항목은 **추정**으로 표시한다.

| 항목 | 상태 | 설명 |
|------|------|------|
| History 목록/entry 행 색 칩 | 의도적 1차 제외 (추정 아님) | 패널만 하이라이트. History 는 텍스트 라벨만. 제품이 “전 UI 통일”을 원하면 갭. |
| MD/CSV 옵션 off 시 열 제거 | 의도적 회귀 방지 | 완전 토글 UX 를 원하면 갭. |
| 패널 실시간 수집 중 session `speakerLabels` 맵 | 없음 (사실) | 런타임 복사/표시는 entry channel·label 만. History 에서 지정한 A/B 커스텀 이름은 **저장 세션**에만 적용. 실시간 복사에는 커스텀 이름 미반영. |
| WebVTT `<v Speaker>` / SRT 음성 트랙 | 미구현 | cue 텍스트 접두만. 플레이어 호환 “표준 화자”는 아님. |
| multi-span 분할 | 미구현 | L1 과 동일. |
| `mhwa0`/`mhwa1` class 보조 | 미구현 | 색 실패 시 추정 보강 여지. |
| 옵션 키 이름 `txtExportSpeakerEnabled` | 레거시 | 의미가 복사/SRT/VTT 로 확장돼 이름 오해 **추정** 가능. 마이그레이션 비용 대비 rename 은 선택. |
| 진단 UI 에 화자 옵션·unknown 비율 | 없음 | 추정: 수집 품질 디버그에 유용. |
| e2e 실사이트 화자 색 | 미검증 (중계 오프라인 시) | 픽스처 기반 단위 테스트만 존재. **추정:** 라이브 색/span 구조 변화 시 L1 악화. |
| Preset 에 발언자 옵션 포함 | 없음 | 프리셋은 autoStart/noise 중심. 추정: 위원회별 기본 화자 옵션 수요는 낮음. |

---

## 5. Recommended Fix Plan

### 1단계 — 즉시(정합·혼란 제거, 코드 소량)

1. **옵션 문구 정확화** (M1): 제목을 실제 적용 범위에 맞게 수정하거나 MD/CSV 동작을 옵션에 맞출지 제품 확정 후 한쪽으로 통일.  
2. **발언자 인라인 형식 통일** (M2): TXT 도 `[발언자 A]` 접두(또는 전 경로 plain) — `formatSpeakerPrefix` 재사용.  
3. **`estimateSessionExportBytes` 에 speaker 옵션 반영** (M3).  
4. **README / CLAUDE Sync Delta** (L4): 두 설정 키, 포맷별 표, JSON 메타 유지.

### 2단계 — 안정성·정확도

1. export-payload **표 기반 단위 테스트** (L5): 6 format × speaker on/off.  
2. `speakerColor` 화이트리스트 (L3).  
3. 복사·export 공통 스냅샷 테스트 (타임스탬프×발언자 조합).  
4. (선택) commit 시 `speakerChanged` 설정 (L2).

### 3단계 — 구조 개선

1. multi-span 화자 분할 설계 (L1) — pipeline 의미론 변경, 별 설계 문서 권장.  
2. 설정 키 rename (`exportSpeakerEnabled`) + sanitize alias — 브레이킹 최소화.  
3. History UI 색 칩을 `panelSpeakerHighlightEnabled` 와 공유할지 제품 결정.  
4. 진단: unknown channel 비율 / structured 화자 분포.

---

## 6. Test Recommendations

### 이미 있는 것 (유지)

- `tests/speaker-label.test.ts` — 라벨/뱃지/accent  
- `tests/inpage-panel.test.ts` — highlight on/off 클래스·뱃지  
- `tests/copy-utils.test.ts` — includeSpeaker 접두  
- `tests/exporters-srt.test.ts` / `exporters-vtt.test.ts` — includeSpeaker  
- `tests/options-app.test.tsx` — 두 토글 저장  
- `tests/settings-store.test.ts` / `settings-fields.test.ts` — sanitize·필드 레지스트리  
- session-store JSON: 발언자 메타 유지 + carry-over dedupe  

### 추가 권장

| 테스트 | 목적 |
|--------|------|
| `export-payload` 매트릭스 | txt/srt/vtt/md/csv/json × speaker true/false — strip·본문 접두·MD 열 존재 단언 |
| TXT 스냅샷 | timestamps×speaker 조합; 복사 문자열과 형식 정책 일치 여부 |
| History `estimateSessionExportBytes` | speaker on 시 바이트 ≥ off; timestamps 와 독립 증가 |
| History export 메시지 | `DOWNLOAD_SESSION_EXPORT` 에 `txtExportSpeakerEnabled` 전달 (mock) |
| runtime settings onChanged | `panelSpeakerHighlightEnabled` 토글 후 패널 signature/class 변경 (content 테스트 가능 범위) |
| import 악성 `speakerColor` | 비정상 문자열이 border 에 들어가도 크래시 없음 / 화이트리스트 후 |
| (통합) fixture multi-span | 현재 1 channel 동작 문서화 회귀; 분할 구현 시 교체 |

### 수동 / e2e

- 생중계 중: 패널 A/B 색, 옵션 off 시 뱃지 제거, TXT/SRT/복사 on 결과 육안 비교.  
- History 커스텀 speakerLabels 후 export/복사에 이름 반영 여부.  
- `npm run verify` / `verify:e2e` 는 기존 게이트 유지.

---

## Appendix A. 이전 감사와의 관계

| 회차 | 초점 | 본 4차와의 관계 |
|------|------|----------------|
| 1–2차 | 동시성·저장·메시징 | 전제로 유지, 재고발 없음 |
| 3차 (2026-07-28) | pipeline·bridge·Blob·schema | 전제로 유지; 발언자 UI 옵션은 당시 범위 밖 |
| **4차 (2026-08-10)** | 발언자 표시·export/copy 옵션 | 본 문서 |

## Appendix B. 문서·구현 체크리스트 (4차 전용)

| 항목 | 구현 | 문서 |
|------|------|------|
| 패널 발언자 색 옵션 | 있음 | README/CLAUDE 부족 |
| 내보내기 발언자 (TXT) | 있음 | README 부분 언급 |
| SRT/VTT 발언자 접두 | 있음 | 문서 부족 |
| 복사 발언자 | 있음 | 문서 부족 |
| MD/CSV 토글 | 항상 포함 | 옵션 도움말에만 언급 |
| JSON 화자 메타 | 유지 | 문서 부족 |
| History 크기 추정 + speaker | 미반영 | — |

---

**감사 종료.** 코드 변경은 수행하지 않았다. 1단계 정합 수정부터 적용할지 결정하면 된다.
