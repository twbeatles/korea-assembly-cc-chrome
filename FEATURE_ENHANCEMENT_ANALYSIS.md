# 기능 고도화 및 추가 기능 분석

작성 기준일: 2026-05-10  
대상 버전: `1.0.9`
검토 범위: `README.md`, `CLAUDE.md`, `GEMINI.md`, `DEPLOYMENT.md`, `CODEBASE_AUDIT.md`, `POTENTIAL_ISSUES.md`, `CHROME_WEB_STORE_PERMISSION_JUSTIFICATIONS.md`, `PRIVACY_POLICY_DRAFT_KO.md`, `manifest.json`, `src/`, `tests/`

## 요약

현재 확장프로그램은 단순 MVP라기보다 이미 `수집 안정성`, `저장 복구`, `history 관리`, `부분 export`, `JSON 백업/가져오기`, `수집 진단`, `Chrome Web Store 제출 문서`까지 갖춘 1차 배포 후보에 가깝습니다. 따라서 다음 고도화의 초점은 자막을 "더 많이 잡는 것"만이 아니라, 저장된 자막을 "찾고, 정리하고, 신뢰도를 판단하고, 회의 기록으로 편집하는 것"에 두는 편이 효과적입니다.

권장 방향은 다음 4가지입니다.

1. `저장된 기록`을 지식 보관함처럼 쓰게 만드는 검색/분류 기능
2. 수집 중 문제를 사용자가 바로 이해하게 만드는 품질/진단 UX
3. 발언자, 중요 표시, 메모, 선택 export를 연결한 회의록 편집 흐름
4. DOM 변화와 긴 회의에 견디는 테스트/운영 체계

## 구현 상태 업데이트 (2026-05-10)

이 문서의 제안 중 외부 AI 요약, 외부 전송, 영상 캡처, 넓은 host permission, `xcode -> xcgcd` 자동 보완을 제외한 로컬 기능은 P0/P1 구현 묶음으로 반영되었습니다.

- `SESSION_RECORD_VERSION`은 `4`이며, v3 기록은 읽을 때 기본값으로 보정합니다.
- `searchSessions({ query, starredOnly, tag, category, page, pageSize })`와 `updateSessionContent(sessionId, patch)`가 추가되었습니다.
- history는 전체 기록 통합 검색, 태그/카테고리 필터, 중요 표시만 보기, 중요 표시만 export, 시간 범위 export를 지원합니다.
- entry 텍스트, 발언자 override, 중요 표시, entry note, labels는 history에서 inline으로 편집합니다.
- entry 병합은 화면 순서상 연속된 항목에만 허용하며, 분할은 기존 시간 범위 안에서 줄 단위로 새 entry를 만듭니다.
- export 형식은 `TXT / SRT / VTT / JSON / Markdown / CSV`입니다. TXT의 발언자/entry 메타데이터 포함은 설정으로 제어하며 기본값은 꺼져 있습니다.
- in-page panel은 최신 확정 entry 빠른 중요 표시와 `중간 저장 후 새 세션 시작`을 제공합니다. preview-only 텍스트는 저장/export/중요 표시 대상이 아닙니다.
- options는 preset 추가/수정/삭제, 중복 URL 차단, TXT export 세부 옵션을 제공합니다. popup은 preset 바로 열기를 제공합니다.
- `tests/fixtures/` DOM fixture와 `npm run verify:e2e` Playwright smoke 검증이 추가되었습니다.
- 실험형 Chrome side panel은 기존 in-page panel을 대체하지 않는 보조 UI로 추가되었습니다.

## 현재 제품 상태

### 이미 강한 부분

- `MutationObserver` 우선, polling fallback, frame forwarding nonce, top-frame fallback 등 수집 복원력이 높습니다.
- preview-only 텍스트를 저장/export 대상으로 승격하지 않는 정책이 명확합니다.
- `TXT / SRT / VTT / JSON / Markdown / CSV` export, history 부분 export, 중요 표시만 export, 시간 범위 export, 전체 JSON 백업/가져오기가 구현되어 있습니다.
- `IndexedDB` 우선 저장, `chrome.storage.local` fallback, page-exit replay queue, startup cleanup이 있어 종료/재시작 복구 정책이 탄탄합니다.
- popup, in-page panel, options diagnostics, history가 역할별로 분리되어 있습니다.
- 권한 범위가 국회 의사중계 도메인 2개로 제한되어 있고, 개인정보처리방침도 로컬 처리 원칙과 맞아 있습니다.
- 테스트가 수집 파이프라인, 저장소, popup/options/history, export, diagnostics를 넓게 덮고 있습니다.

### 구현 전 분석에서 보였던 빈자리

아래 항목은 이 문서 작성 당시의 gap 분석입니다. 현재 P1 구현 후에는 전체 기록 검색, 발언자 표시/편집, 수집 건강도, 태그/카테고리, 장시간 세션 크기 경고, fixture/E2E smoke 검증이 코드와 테스트에 반영되었습니다. 남은 후보는 selector profile 관리, foreign-language noise filter 정밀화, side panel 실험 기능의 실제 Chrome 버전별 사용성 검증입니다.

## 우선순위 로드맵

### P0. 다음 마이너 릴리스에 넣기 좋은 기능

#### 1. 전체 기록 통합 검색

문제: 저장된 회의가 많아지면 특정 발언이나 키워드를 찾기 위해 세션을 하나씩 열어야 합니다.  
가치: 이 확장을 "일회성 자막 저장 도구"에서 "국회 회의 자막 아카이브"로 올립니다.

권장 구현:

- `history` 상단에 전체 검색 입력을 추가합니다.
- 검색 범위는 `제목`, `위원회명`, `메모`, `entry.text`로 나눕니다.
- 1차 구현은 `IndexedDB` 전체 preload 대신 페이지 단위/청크 단위 검색으로 시작합니다.
- 검색 결과는 세션 카드에 매칭 건수와 첫 매칭 preview를 표시하고, 상세 진입 시 해당 entry로 스크롤합니다.
- 검색어가 있을 때 `즐겨찾기만 보기`와 조합되도록 합니다.

관련 파일:

- `src/history/App.tsx`
- `src/storage/session-store.ts`
- `src/shared/copy-utils.ts`
- `src/history/history-view-state.ts`

검증:

- 전체 검색어가 제목/메모/entry에 각각 매칭되는지 테스트
- 즐겨찾기 필터와 검색어 조합 테스트
- 검색 결과에서 선택 export/copy가 기존 의미론을 유지하는지 테스트

#### 2. 수집 품질 점수와 세션 건강도 요약

문제: 현재 diagnostics는 디버깅에는 좋지만 일반 사용자가 세션 품질을 판단하기에는 정보가 분산되어 있습니다.  
가치: 사용자가 "이 기록을 믿고 저장해도 되는지", "중간에 끊긴 구간이 있는지"를 빠르게 판단합니다.

권장 구현:

- running 중 panel/options에 `좋음 / 주의 / 불안정` 같은 건강도 배지를 추가합니다.
- 저장된 history 상세에 세션 건강도 요약을 저장 또는 계산 표시합니다.
- 지표 후보:
  - structured/fallback/polling 비율
  - observer 미수신 streak
  - preview-only 지속 시간
  - reset 횟수
  - page-exit persist 실패 여부
  - 마지막 저장 시각
  - entry gap이 큰 구간 수
  - export 경고 크기 도달 여부
- 1차는 진단 상태를 저장하지 않고 live snapshot 기반으로 보여 주고, 2차에서 세션 record에 요약 필드를 추가합니다.

관련 파일:

- `src/shared/capture-diagnostics.ts`
- `src/shared/message-types.ts`
- `src/content/content-script.ts`
- `src/content/inpage-panel.ts`
- `src/options/App.tsx`
- `src/history/App.tsx`

검증:

- `persistabilityState`별 건강도 라벨 테스트
- fallback-only, duplicate-only, filtered-only 상태의 사용자 문구 테스트
- 저장 복구 오류가 건강도에 반영되는지 테스트

#### 3. "보이는데 저장되지 않는 이유" 안내 강화

문제: `실시간 내용`에는 보이지만 `수집된 자막`으로 확정되지 않은 경우, 사용자는 저장/복사가 막히는 이유를 직관적으로 알기 어렵습니다.  
가치: preview-only, unstable-only, filtered, duplicate 상태를 사용자 언어로 설명해 문의와 오해를 줄입니다.

권장 구현:

- panel notice에 `persistabilityHint`를 더 직접적으로 노출합니다.
- 저장/복사/export 버튼이 비활성화된 상태에서 tooltip 또는 보조 문구를 제공합니다.
- "현재 자막은 인식 중이라 확정 전입니다", "중복으로 판단되어 저장하지 않았습니다", "필터에 걸린 내용입니다"처럼 상태별 문구를 통일합니다.

관련 파일:

- `src/content/inpage-panel.ts`
- `src/content/content-script.ts`
- `src/shared/capture-diagnostics.ts`
- `src/shared/ui-labels.ts`
- `tests/inpage-panel.test.ts`

검증:

- 각 `persistabilityState`가 panel에 기대 문구로 표시되는지 테스트
- 비활성화 버튼 상태와 안내 문구가 같은 기준을 쓰는지 테스트

#### 4. 저장된 기록 태그/카테고리

문제: 즐겨찾기와 메모만으로는 회의 기록이 많아졌을 때 분류가 부족합니다.  
가치: 사용자가 정책 분야, 위원회, 이슈, 프로젝트별로 자막 기록을 정리할 수 있습니다.

권장 구현:

- `SessionRecord`에 `tags: string[]` 또는 `category: string` 메타데이터를 추가합니다.
- history 상세에서 태그를 추가/삭제합니다.
- 목록 필터에 태그 필터를 추가합니다.
- JSON 백업/가져오기 sanitize에 태그 필드를 포함합니다.
- 첫 구현은 자유 입력 태그로 충분하며, 자동 추천은 나중으로 미룹니다.

관련 파일:

- `src/core/subtitle-models.ts`
- `src/storage/session-store.ts`
- `src/storage/session-backup.ts`
- `src/history/App.tsx`
- `tests/session-backup.test.ts`
- `tests/history-app.test.tsx`

검증:

- 태그 저장/수정 시 entries를 덮어쓰지 않는지 테스트
- JSON import/export에서 태그 유지 테스트
- 태그 필터와 pagination 조합 테스트

### P1. 제품 완성도를 크게 높이는 기능

#### 5. 발언자 표시와 수동 발언자 편집

문제: 모델에는 `speakerColor`, `speakerChannel`, `speakerChanged`가 있지만 현재 UI와 export에서는 적극적으로 쓰지 않습니다.  
가치: 회의록으로 활용할 때 발언자 전환을 구분할 수 있어 기록 가치가 커집니다.

권장 구현:

- history entry에 `primary / secondary / unknown` 발언자 채널 표시를 추가합니다.
- 색상만 노출하지 말고 "발언자 A/B" 같은 중립 라벨을 우선 사용합니다.
- 사용자가 entry 묶음에 발언자 이름을 붙일 수 있게 합니다.
- TXT/Markdown export에서 발언자 라벨을 선택적으로 포함합니다.
- JSON에는 기존 메타를 유지하고, 새 사용자 라벨 필드를 추가합니다.

주의:

- 현재 색상 기반 분류는 실제 인물 식별이 아니라 화면 스타일 신호입니다. UI 문구에서 이를 과장하지 않아야 합니다.
- 개인정보처리방침에는 사용자가 직접 입력한 발언자 라벨이 로컬 저장된다는 내용을 추가해야 할 수 있습니다.

관련 파일:

- `src/content/subtitle-rows.ts`
- `src/core/live-capture.ts`
- `src/core/subtitle-models.ts`
- `src/history/App.tsx`
- `src/core/exporters/*`
- `src/core/output-normalizer.ts`

#### 6. 중요 표시, 북마크, 하이라이트

문제: 메모는 세션 단위이고, 특정 문장 단위로 중요한 대목을 표시하는 기능은 없습니다.  
가치: 회의록 검토, 보도자료 작성, 질의응답 발췌 작업이 쉬워집니다.

권장 구현:

- entry 단위 `highlighted`, `entryNote`, `labels`를 추가합니다.
- history에서 중요한 항목만 보기, 중요한 항목만 export를 제공합니다.
- in-page panel에서도 최신 문장에 빠른 중요 표시 버튼을 제공할 수 있습니다.
- export 옵션에 "중요 표시만"을 추가합니다.

관련 파일:

- `src/core/subtitle-models.ts`
- `src/history/App.tsx`
- `src/storage/session-backup.ts`
- `src/content/inpage-panel.ts`

#### 7. 자막 편집: 수정, 병합, 분할, 삭제

문제: AI 자막은 오탈자와 잘못 끊긴 문장이 생길 수 있습니다. 현재는 저장 후 원문을 그대로 보관하는 성격이 강합니다.  
가치: 사용자가 바로 회의록 초안으로 다듬을 수 있습니다.

권장 구현:

- history 상세에서 entry text 수정 기능을 추가합니다.
- 선택한 연속 entry 병합, 한 entry 분할, 선택 삭제를 제공합니다.
- 원본 보존을 위해 `originalText` 또는 edit history를 둘지 결정합니다.
- export는 수정된 text를 기본으로 쓰고, JSON에는 원본/수정본을 함께 보존하는 방식을 검토합니다.

주의:

- 수정 기능은 storage schema와 import/export 호환성에 영향을 줍니다.
- 먼저 "복사/export 전용 임시 편집"으로 시작하면 schema 위험을 줄일 수 있습니다.

#### 8. 회의/위원회 preset 관리

문제: 작성 당시 README에서는 `고급 preset / xcode -> xcgcd 자동 보완 UX`가 제외 범위로 남아 있었습니다. 현재는 preset CRUD와 popup 바로 열기가 구현되었고, `xcode -> xcgcd` 자동 보완 UX만 제외 범위로 남깁니다. 사용자가 반복적으로 같은 위원회/본회의를 보게 되면 URL 파라미터와 페이지 유형 처리 UX가 중요해집니다.  
가치: 자주 보는 회의 페이지 진입과 자동 시작 흐름을 줄여 줍니다.

권장 구현:

- options에 preset 목록을 추가합니다.
- preset에는 표시 이름, URL 패턴, 위원회명 기본값, 자동 시작 여부, noise filter 기본값을 저장합니다.
- `xcode -> xcgcd` 자동 보완은 2차 기능으로 두고, 1차는 "자주 여는 회의 링크" 정도로 시작합니다.
- popup에서 preset 바로 열기를 제공합니다.

관련 파일:

- `src/options/App.tsx`
- `src/popup/App.tsx`
- `src/storage/settings-store.ts`
- `src/shared/constants.ts`

#### 9. Export 확장: Markdown, CSV, 회의록 템플릿

문제: TXT/SRT/VTT/JSON은 자막 저장에는 충분하지만 문서 작업이나 스프레드시트 후처리에는 아쉬울 수 있습니다.  
가치: 발췌/보고/분석 워크플로우에 바로 붙습니다.

권장 구현:

- Markdown export: 제목, 일시, URL, 메모, 자막 목록, 중요 표시를 구조화합니다.
- CSV export: startTime, endTime, speaker, text, highlighted, note 컬럼을 제공합니다.
- TXT export 옵션을 확장해 타임스탬프/발언자/메모 포함 여부를 선택합니다.
- README의 export 정합성 섹션에 새 포맷을 추가합니다.

관련 파일:

- `src/core/exporters/*`
- `src/storage/session-store.ts`
- `src/shared/ui-labels.ts`
- `tests/exporters-*.test.ts`

#### 10. 긴 회의용 세션 크기 경고와 분할 저장

문제: 전체 라이브러리 백업은 25 MiB 제한이 있고, 단일 세션 export도 크기 경고가 있습니다. 사용자는 문제가 export 시점에야 보일 수 있습니다.  
가치: 장시간 회의에서 데이터 손실 우려와 export 실패를 미리 줄입니다.

권장 구현:

- running 중 `entryCount`, `charCount`, 추정 byte size를 panel/options에 표시합니다.
- 임계값을 넘으면 "세션이 커지고 있습니다. 중간 저장 또는 분할 저장을 권장합니다" 안내를 띄웁니다.
- `중간 저장 후 새 세션 시작` 액션을 제공합니다.
- history에서 큰 세션을 선택 범위나 시간 범위로 분할 export합니다.

관련 파일:

- `src/content/content-script.ts`
- `src/content/inpage-panel.ts`
- `src/shared/byte-size.ts`
- `src/history/App.tsx`

### P2. 차별화와 운영 안정성을 위한 장기 후보

#### 11. DOM selector profile과 fixture 기반 회귀 테스트

문제: 국회 사이트 DOM 구조 변경은 README의 가장 큰 알려진 한계입니다.  
가치: 사이트 변경 대응 속도가 빨라지고 배포 전 회귀를 자동 검출할 수 있습니다.

권장 구현:

- 대표 페이지 DOM fixture를 `tests/fixtures/`에 저장합니다.
- 본회의, 위원회, iframe, fallback-only, unstable row 케이스를 분리합니다.
- selector 후보별 성공률과 capture mode를 테스트합니다.
- 사이트 구조가 바뀌면 새 profile을 추가하고 기존 profile과 비교합니다.

관련 파일:

- `src/shared/constants.ts`
- `src/content/dom-probe.ts`
- `src/content/subtitle-rows.ts`
- `src/content/local-polling.ts`
- `tests/*`

#### 12. 브라우저 E2E 테스트와 릴리스 smoke test

문제: 단위 테스트가 넓지만 실제 Chrome extension 로드, content script 주입, popup/history/options 연결은 브라우저에서만 드러나는 실패가 있습니다.  
가치: Web Store 제출 전 수동 확인 비용을 줄입니다.

권장 구현:

- `dist/`를 로드한 Playwright/Chrome extension smoke test를 추가합니다.
- 테스트 페이지 fixture에서 content script가 panel을 붙이고, start/stop/save/export 명령이 연결되는지 확인합니다.
- `npm run verify:e2e`를 별도로 두고, 평소 `npm run verify`에는 포함하지 않아도 됩니다.
- `DEPLOYMENT.md` 릴리스 체크리스트에 E2E 여부를 추가합니다.

#### 13. 네이티브 side panel 또는 보조 보기 검토

문제: 현재 in-page panel은 실제 방송 페이지 위에 고정 삽입됩니다. 일부 사용자는 영상 영역과 겹침, 작은 화면 공간 부족, 사이트 CSS 충돌을 겪을 수 있습니다.  
가치: 브라우저 UI 영역에 독립 패널을 제공하면 화면 침범이 줄고 접근성이 좋아질 수 있습니다.

권장 구현:

- 현재 in-page panel은 유지합니다.
- 별도 실험 옵션으로 브라우저 side panel 또는 독립 history-like live view를 검토합니다.
- Chrome API/Manifest 요구사항과 Web Store 권한 설명 변경 필요 여부를 먼저 확인합니다.
- 구현 시 popup에서 "페이지 패널 / 브라우저 패널" 선택을 제공합니다.

주의:

- 이 항목은 Chrome API 지원 범위와 배포 대상 브라우저 버전 확인이 필요합니다.
- 현재 커스텀 panel이 content script 상태와 밀접하게 결합되어 있어, 상태 동기화 설계를 먼저 해야 합니다.

#### 14. 선택형 로컬/사용자 동의 기반 요약 기능

문제: 사용자는 긴 회의 자막에서 핵심 쟁점, 발언 요약, 키워드를 원할 수 있습니다.  
가치: 단순 기록 저장을 넘어 회의 검토 시간을 줄입니다.

권장 구현:

- 기본값은 외부 전송 없음 정책을 유지합니다.
- 1차는 로컬 규칙 기반 키워드/빈도/발언량 통계로 시작합니다.
- 외부 AI 요약은 별도 opt-in, 사용자 API 키, 명확한 개인정보처리방침 개정 후에만 검토합니다.
- 요약 결과는 원문과 분리해 `analysis` 메타데이터로 저장합니다.

주의:

- 현재 개인정보처리방침은 "외부 서버 전송 없음"을 명시합니다. 외부 AI 기능을 넣으면 정책/스토어 문안/동의 UX를 모두 바꿔야 합니다.
- 기본 기능으로 넣기보다 선택형 고급 기능으로 분리하는 편이 안전합니다.

## 기능 후보 점수표

| 후보                | 사용자 가치 | 구현 난이도 | 정책/권한 위험 | 추천             |
| ------------------- | ----------- | ----------- | -------------- | ---------------- |
| 전체 기록 통합 검색 | 높음        | 중간        | 낮음           | 최우선           |
| 수집 품질 점수      | 높음        | 중간        | 낮음           | 최우선           |
| 저장 불가 이유 안내 | 중간        | 낮음        | 낮음           | 최우선           |
| 태그/카테고리       | 높음        | 중간        | 낮음           | 빠른 도입        |
| 발언자 표시/편집    | 높음        | 높음        | 중간           | 단계 도입        |
| 중요 표시/북마크    | 높음        | 중간        | 낮음           | 빠른 도입        |
| 자막 수정/병합/분할 | 높음        | 높음        | 낮음           | schema 설계 후   |
| preset 관리         | 중간        | 중간        | 낮음           | 반복 사용자용    |
| Markdown/CSV export | 중간        | 낮음        | 낮음           | 빠른 도입        |
| 세션 크기 경고/분할 | 중간        | 중간        | 낮음           | 장시간 회의 대응 |
| DOM fixture/E2E     | 높음        | 중간        | 낮음           | 운영 안정화      |
| 네이티브 side panel | 중간        | 중간~높음   | 중간           | 실험 옵션        |
| AI 요약             | 높음        | 높음        | 높음           | opt-in 장기 후보 |

## 추천 릴리스 묶음

### v1.1: 검색과 진단

- 전체 기록 통합 검색
- 저장 불가 이유 안내 강화
- 수집 품질 점수 1차
- 세션 크기 경고 1차
- 관련 unit test 보강

목표: 기존 데이터를 더 잘 찾고, 수집 상태를 더 쉽게 이해하게 만드는 릴리스입니다.

### v1.2: 기록 정리

- 태그/카테고리
- 중요 표시/북마크
- Markdown/CSV export
- 태그/중요 표시 JSON 백업/가져오기 호환

목표: history를 회의 기록 관리 화면으로 발전시키는 릴리스입니다.

### v1.3: 회의록 편집

- 발언자 표시 1차
- 수동 발언자 라벨
- entry 수정/병합/분할/삭제
- 선택 범위 export UX 개선

목표: 저장된 자막을 회의록 초안으로 다듬을 수 있게 만드는 릴리스입니다.

### v1.4: 운영 안정화

- DOM fixture suite
- Chrome extension E2E smoke test
- selector profile 관리
- 릴리스 검증 자동화 강화

목표: 국회 사이트 DOM 변화와 Chrome extension 환경 변화에 더 빨리 대응하는 릴리스입니다.

## 구현 시 지켜야 할 원칙

1. preview-only 텍스트는 지금처럼 저장/export 대상으로 승격하지 않습니다.
2. `sourceUrl` 허용 범위와 host permission은 현재 두 국회 도메인 중심으로 유지합니다.
3. 새 메타데이터는 JSON backup/import sanitize와 schema version 전략을 함께 설계합니다.
4. 사용자 입력 메타데이터가 늘어나면 개인정보처리방침 문구도 같이 갱신합니다.
5. 큰 기능은 history/store/export/panel을 한 번에 바꾸기보다, record schema -> store -> history UI -> export -> tests 순서로 작게 나눕니다.
6. 수집 파이프라인의 안정성 개선과 편집 기능을 섞지 않습니다. 편집은 저장된 record 위에서 먼저 구현하는 편이 안전합니다.
7. Web Store 권한 설명에 새 권한이 필요한 기능은 별도 검토 문서를 먼저 만듭니다.

## 당장 하지 않는 편이 좋은 기능

- 기본 동작으로 외부 서버에 자막을 업로드하는 기능
- 전체 웹사이트 권한이나 넓은 host permission을 요구하는 기능
- 영상 캡처/녹화 기능
- Web Store 정책 문서와 개인정보처리방침을 바꾸지 않은 AI 요약 기능
- schema 설계 없이 entry 원문을 직접 덮어쓰는 편집 기능
- 현재 안정화된 수집 파이프라인을 대규모로 다시 쓰는 리팩터링

## 다음 액션 제안

1. selector profile 관리와 실제 국회 DOM 변화 대응 절차를 릴리스 운영 문서에 더 구체화합니다.
2. foreign-language noise filter 정밀도 개선은 별도 실험으로 분리합니다.
3. side panel은 Chrome 114+에서 실제 UX를 수동 검증한 뒤 기본 노출 수준을 다시 결정합니다.
4. release candidate마다 README/CLAUDE/GEMINI/DEPLOYMENT/권한/개인정보 문서의 기능 범위 문구를 함께 점검합니다.
5. 구현 검증 기준은 아래 명령을 유지합니다.

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run verify:e2e
```
