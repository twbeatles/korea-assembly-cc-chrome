# Feature Expansion Analysis 2026-03-12

## 목적

이 문서는 현재 `korea-assembly-cc-chrome` 코드베이스를 기준으로, 앞으로 추가해 볼 만한 기능을 구조적으로 정리한 제안서입니다.

분석 기준:

- `README.md`
- `CLAUDE.md`
- `GEMINI.md`
- `DEPLOYMENT.md`
- `manifest.json`
- `src/` 및 `tests/` 구조

핵심 전제:

- 현재 활성 구현은 `Chrome Extension (Manifest V3) + TypeScript + React + Vite`
- `legacy/`는 아카이브이며 확장 기능 설계의 직접 수정 대상이 아님
- 최우선 안정성 축은 여전히 `자막 수집 정합성`, `저장 안정성`, `우측 패널 UX`, `history 활용성`

## 2026-03-12 구현 반영 메모

이 문서의 `A. 빠르게 넣기 좋은 기능` 항목 중 아래는 현재 코드베이스에 이미 반영되었습니다.

- 세션 즐겨찾기
- 세션 메모
- 부분 선택 복사 / 부분 export
- JSON 백업/복원
- 캡처 진단 정보 표시
  - 현재 구현은 popup/패널 상시 노출이 아니라 options 페이지의 `수집 진단` 탭으로 분리됨

따라서 이 문서는 이제 `A` 항목의 회고 + `B/C` 항목 우선순위 재검토 문서로 읽는 것이 맞습니다.

## 현재 구조 분석

## 1. 런타임 엔트리와 책임 분리

### 1.1 `src/content/`

현재 제품의 핵심입니다.

- `content-script.ts`
  - 세션 상태 소유
  - 자막 수집 시작/중지/저장/내보내기 제어
  - in-page 패널 상태 업데이트
  - popup과의 메시지 연결
- `injected-observer.ts`
  - page world에서 `MutationObserver` 실행
- `dom-probe.ts`, `frame-probe.ts`, `local-polling.ts`
  - selector/fallback/frame 탐색 로직
- `inpage-panel.ts`
  - 실제 우측 패널 UI 렌더링
- `autosave.ts`, `failed-stopped-session.ts`, `capture-notice.ts`
  - 저장 정책, 실패 guard, 상태 안내문 같은 정책성 로직 분리

해석:

- 새로운 실시간 기능은 대부분 `content/`에서 시작됩니다.
- 페이지 안에서 즉시 보이는 기능은 `inpage-panel.ts`와 `content-script.ts`를 같이 건드리게 됩니다.
- capture 품질/진단/상태 관련 기능은 현재 구조에 가장 자연스럽게 추가할 수 있습니다.

### 1.2 `src/core/`

순수 로직 계층입니다.

- `subtitle-pipeline.ts`
  - 증분 추출, carry-over 정리, keepalive, finalize, flush
- `live-capture.ts`
  - live row ledger와 structured/fallback capture 상태
- `subtitle-models.ts`
  - `SessionRecord`, `SubtitleEntry`, `SessionState`
- `exporters/*`
  - `txt`, `srt`, `vtt`, `json`

해석:

- 기능 확장 시 재사용성이 높은 계층입니다.
- 사용자 기능이라도 핵심 의미론이 있으면 먼저 `core/`에 pure helper로 넣는 편이 테스트 비용이 낮습니다.
- transcript 정리, 발언자 처리, 부분 export, 분석 통계 같은 기능은 이 계층이 중심이 됩니다.

### 1.3 `src/storage/`

- `session-store.ts`
  - `IndexedDB` 우선, `chrome.storage.local` fallback, 메모리 fallback
  - 세션 CRUD, running cleanup, export payload 준비
- `settings-store.ts`
  - 환경 설정 저장/검증
- `types.ts`
  - 설정 타입과 store API

해석:

- 새로운 사용자 데이터가 생기면 가장 먼저 schema 설계를 고민해야 하는 계층입니다.
- 현재 `SessionRecord`는 자막 본문 저장에는 충분하지만, 사용자 메타데이터 확장 공간은 거의 없습니다.
- 태그/즐겨찾기/메모/보관 상태 같은 기능은 storage schema 확장이 선행되어야 합니다.

### 1.4 `src/history/`

- 저장된 기록의 실사용 허브입니다.
- 현재 이미 검색, 복사, export, 재열기, 선택 삭제, 전체 삭제가 있음

해석:

- 앞으로 많은 기능은 `history`가 중심이 되는 편이 맞습니다.
- 기록 관리, 정리, 비교, 태깅, 부분 export, 통계, 복구/백업 기능은 이 화면에서 확장하는 것이 가장 자연스럽습니다.

### 1.5 `src/options/`

- 현재는 전역 설정과 `수집 진단` 탭을 함께 관리
- 수집 정책과 UI 동작 관련 값, 활성 탭 진단 정보를 다룸

해석:

- 사용자 정의 preset, 고급 필터, export 템플릿, 기본 동작 프로파일을 넣기 좋은 자리입니다.
- 다만 현재 구조는 단일 설정 객체 중심이라, 그룹화된 preset 관리에는 별도 schema가 필요합니다.

### 1.6 `src/popup/`

- 현재는 “빠른 열기 + 상태 확인” 중심
- full control UI가 아니라 launcher 역할

해석:

- popup은 기능을 많이 담기보다 “현재 상태 요약”, “최근 세션 바로가기”, “빠른 토글” 쪽으로만 확장하는 것이 맞습니다.

### 1.7 `src/background/` / `src/offscreen/`

- 다운로드, offscreen Blob URL, content script 준비, history/options 열기

해석:

- 로컬 파일 입출력, 백업/복원, 대용량 export, 향후 import 기능은 background/offscreen과 엮일 가능성이 높습니다.

## 2. 현재 데이터 모델의 장점과 한계

현재 `SessionRecord`는 아래에 최적화돼 있습니다.

- 회의 메타
- 자막 배열
- 시간 정보
- 저장 상태
- 사용자 메타(`starred`, `pinnedAt`, `note`)

장점:

- export 친화적
- pure transformation 테스트가 쉬움
- fallback 저장소와도 동기화하기 쉬움
- 즐겨찾기/메모/JSON 백업 복원까지 같은 레코드 구조로 유지 가능

한계:

- 태그/카테고리 필드 없음
- entry 수준 중요 표시/annotation 없음
- 세션 수준 품질 메타데이터 없음
- speaker 관련 메타는 entry에 남아 있지만 UI에서 적극 활용하지 않음

결론:

기능을 더 늘리려면 `SessionRecord.version`을 활용한 점진적 schema 확장이 계속 필요하지만, 다음 확장축은 기본 메모/북마크가 아니라 `태그`, `entry annotation`, `품질 메타` 쪽이 됩니다.

## 3. 테스트 구조 분석

현재 테스트는 pure logic 위주로 잘 깔려 있습니다.

- pipeline
- live capture
- panel DOM
- session store
- settings
- autosave
- probe/observer

강한 부분:

- 핵심 파이프라인 회귀 방지
- 저장소 fallback 회귀 방지
- 패널 DOM 안정성 일부 검증

상대적으로 약한 부분:

- `history/App.tsx` 레벨의 사용자 시나리오 테스트
- popup/options/history를 묶는 UI integration test
- 실제 브라우저 기반 E2E

결론:

- 신규 기능은 가능하면 pure helper를 먼저 만들고 unit test를 붙이는 방식이 현재 저장소에 가장 잘 맞습니다.
- 큰 UI 기능은 App-level test 또는 향후 Playwright E2E를 보강해야 합니다.

## 기능 확장 제안

아래는 현재 구조에 맞는 기능 후보들입니다.

## A. 빠르게 넣기 좋은 기능

상태 메모:

- A1 ~ A5는 2026-03-12 기준 구현 완료
- 아래 항목 설명은 왜 이 기능이 구조적으로 잘 맞았는지에 대한 설계 기록으로 유지

### A1. 세션 즐겨찾기 / 북마크

사용자 가치:

- 중요한 회의 기록을 빠르게 다시 찾을 수 있음

구현 포인트:

- `src/core/subtitle-models.ts`
  - `SessionRecord`에 `starred`, `pinnedAt` 같은 필드 추가
- `src/storage/session-store.ts`
  - schema 확장 및 normalize 대응
- `src/history/App.tsx`
  - 즐겨찾기 필터, 정렬

왜 잘 맞는가:

- 현재 history 화면이 이미 기록 관리 허브이기 때문

난이도:

- 낮음~중간

### A2. 세션 메모 / 회의 노트

사용자 가치:

- “이 구간은 예산안 질의”, “이 기록은 기사 작성용” 같은 사용자 메모 저장 가능

구현 포인트:

- `SessionRecord`에 `note`, `labels` 추가
- history detail 우측 또는 상단에 note editor 추가
- JSON export에 메모 포함 여부 결정

주의:

- 저장소 migration 필요

난이도:

- 중간

### A3. 부분 선택 복사 / 부분 export

사용자 가치:

- 전체 회의가 아니라 필요한 문장만 TXT/SRT/JSON으로 뽑을 수 있음

구현 포인트:

- `src/history/App.tsx`
  - entry checkbox 또는 range selection
- `src/shared/copy-utils.ts`
  - entry subset 기반 copy helper
- `src/core/exporters/*`
  - 세션 전체가 아니라 선택 entry subset export 지원 helper 추가

왜 잘 맞는가:

- 현재 history가 이미 검색/복사를 지원하므로 UX 확장선이 자연스러움

난이도:

- 중간

### A4. JSON 백업/복원

사용자 가치:

- 브라우저 재설치나 다른 PC 이전에 로컬 백업 가능

구현 포인트:

- export는 이미 존재하므로 import 추가가 핵심
- `src/history/App.tsx`
  - `JSON 가져오기` 버튼
- `src/storage/session-store.ts`
  - imported session upsert 정책 정의
- 필요 시 `background/service-worker.ts` 보조 사용

주의:

- id 충돌, version 호환, 중복 merge 정책 필요

난이도:

- 중간

### A5. 캡처 진단 정보 표시

사용자 가치:

- 지금이 structured capture인지 fallback capture인지, observer가 붙어 있는지 사용자와 개발자가 바로 알 수 있음

구현 포인트:

- `src/shared/message-types.ts`
  - quality/diagnostic payload 확장
- `src/content/content-script.ts`
  - capture source, selector, frame path, fallback 여부 계산
- `src/popup/App.tsx`
  - `수집 진단` 화면 진입 버튼
- `src/content/inpage-panel.ts`
  - `수집 진단` 화면 진입 버튼
- `src/options/App.tsx`
  - 상세 진단 탭과 최근 저장 시각 표시

왜 잘 맞는가:

- 현재도 `observerActive`, `currentSelector`, `framePath`, notice가 이미 존재함

난이도:

- 낮음

## B. 구조적으로 잘 맞는 중간 규모 기능

### B1. 발언자 색상/채널 활용 UI

사용자 가치:

- 현재 데이터에 이미 남아 있는 `speakerColor`, `speakerChannel`을 실제 UI에서 활용 가능
- 발언자 전환 파악이 쉬워짐

구현 포인트:

- `src/core/subtitle-models.ts`
  - 기존 메타는 이미 있음
- `src/history/App.tsx`
  - entry 카드에 speaker 배지 표시
- `src/content/inpage-panel.ts`
  - live rows에 speaker 표시 강화
- `src/core/exporters/normalize-session.ts`
  - export 노출 정책 옵션화 가능

왜 잘 맞는가:

- 현재 데이터 모델을 새 permission 없이 활용하는 확장

난이도:

- 중간

### B2. 고급 검색: 전체 기록 가로지르는 통합 검색

사용자 가치:

- 특정 키워드가 어느 회의에서 나왔는지 한 번에 찾을 수 있음

구현 포인트:

- `src/history/App.tsx`
  - 현재는 단일 session 내부 검색만 있음
- `src/storage/session-store.ts`
  - 전체 세션 조회 후 검색 helper 또는 검색용 요약 인덱스
- 별도 `history-search.ts` 같은 pure helper 추가 권장

주의:

- 저장량이 커지면 naive full scan이 느려질 수 있음

난이도:

- 중간

### B3. 사용자 태그 / 카테고리

사용자 가치:

- 위원회별, 이슈별, 기사 작성용, 검토 필요 등으로 기록 정리 가능

구현 포인트:

- `SessionRecord`에 `tags: string[]`
- history 목록 필터/정렬 UI
- options에서 기본 태그 preset 관리 가능

난이도:

- 중간

### B4. 회의별 preset

사용자 가치:

- 특정 위원회에서는 `filterUnconfirmedEnabled`를 끄고, 어떤 페이지에서는 polling을 더 느리게 하는 식의 튜닝 가능

구현 포인트:

- `src/storage/types.ts`
  - 전역 설정 외에 preset 구조 추가
- `src/storage/settings-store.ts`
  - preset 저장/검증
- `src/options/App.tsx`
  - preset CRUD UI
- `src/content/content-script.ts`
  - 현재 페이지 title/committeeName 기준 preset 적용

왜 잘 맞는가:

- README의 향후 계획에 이미 “페이지/위원회 preset 관리”가 있음

난이도:

- 중간~높음

### B5. 세션 품질 점수 / 수집 건강도

사용자 가치:

- “이 세션은 fallback 비중이 높아서 품질이 낮다” 같은 판단 가능

구현 포인트:

- session 수준 메타:
  - fallback event count
  - reset count
  - observer disconnect count
  - preview-only flush count
- `content-script.ts`에서 런타임 누적
- `SessionRecord`에 요약 메타 저장
- history/popup에 품질 badge 표시

난이도:

- 중간

### B6. 저장된 기록 비교 / 병합

사용자 가치:

- 같은 회의의 중복 세션을 비교해 하나로 정리 가능

구현 포인트:

- history에서 multi-select 후 merge action
- `core/`에 session merge helper 추가
- time overlap/duplicate 제거 정책 필요

주의:

- 잘못 병합하면 복구가 어려우므로 preview 단계 필요

난이도:

- 높음

## C. 큰 가치가 있지만 설계가 먼저 필요한 기능

### C1. 하이라이트 / 중요 구간 표시

사용자 가치:

- 기사 작성, 검토, 회의록 추출에 매우 유용

구현 포인트:

- entry 수준 사용자 메타 추가:
  - `highlighted`
  - `highlightColor`
  - `annotation`
- history detail에서 entry action UI 추가
- partial export와 결합 시 큰 시너지

주의:

- entry 수가 많아질 수 있으므로 저장 용량과 UI 성능 고려 필요

난이도:

- 높음

### C2. 시간축 기반 내비게이션

사용자 가치:

- 긴 회의 기록에서 특정 시각대로 빠르게 이동 가능

구현 포인트:

- `src/core/timeline.ts` 재사용
- history detail에 timeline scrubber 추가
- search와 결합하면 “09:45 발언 구간으로 이동” 같은 UX 가능

난이도:

- 중간~높음

### C3. 로컬 분석 기능

예시:

- 회의별 발언량
- 시간대별 자막 밀도
- 주요 키워드 빈도
- 특정 발언자 채널 비율

구현 포인트:

- `src/core/analytics.ts` 같은 순수 모듈 추가 권장
- history detail 또는 별도 analytics 뷰 추가

왜 의미가 있는가:

- 현재 세션 데이터가 이미 시간축과 텍스트를 갖고 있기 때문

난이도:

- 중간

### C4. 다중 세션 워크스페이스

사용자 가치:

- 여러 기록을 묶어 하나의 “작업 세트”로 관리 가능

예시:

- 특정 청문회 묶음
- 같은 주제의 위원회 기록 묶음

필요한 변화:

- `SessionRecord` 외에 `Collection` 또는 `Workspace` 개념 도입
- 새 storage object store 또는 별도 key set 필요

난이도:

- 높음

### C5. 외부 서비스 연동

예시:

- Notion용 Markdown export
- 로컬 파일 구조화 export
- 추후 서버 백업/동기화

주의:

- 현재 manifest 권한과 제품 철학은 “로컬 우선”입니다.
- 원격 API 연동은 권한, 개인정보 처리, 심사 부담을 크게 늘립니다.

권장 판단:

- 먼저 `Markdown`, `CSV`, `clean JSON` 같은 로컬 export를 늘리고
- 서버 동기화는 별도 단계로 분리하는 편이 안전합니다.

## 우선순위 제안

## Phase 1: 낮은 리스크, 체감 가치 높음

상태: 구현 완료

1. 세션 즐겨찾기
2. 세션 메모
3. 부분 선택 복사 / 부분 export
4. JSON 백업/복원
5. 캡처 진단 정보 표시

이유:

- 현재 구조를 거의 유지하면서 UX 가치를 크게 올릴 수 있음
- 새 permission 없이 진행 가능
- history 중심으로 기능을 확장할 수 있음

## Phase 2: 데이터 모델 확장형 기능

1. 사용자 태그 / 카테고리
2. 통합 검색
3. 발언자 메타 활용 UI
4. 회의별 preset
5. 세션 품질 점수

이유:

- storage schema와 UI를 같이 확장해야 하지만 현재 구조와 잘 맞음

## Phase 3: 제품 성격이 바뀌는 기능

1. 하이라이트 / 중요 구간 표시
2. 세션 병합/비교
3. 시간축 내비게이션
4. 분석 대시보드
5. 워크스페이스 / 외부 서비스 연동

이유:

- 기능 가치가 크지만 설계 비용과 데이터 migration 비용도 큼

## 구현 시 권장 원칙

### 1. `SessionRecord` 확장은 점진적으로

- 한 번에 많은 필드를 넣지 말 것
- 기능 단위로 필드를 추가할 것
- `version`과 normalize/migration 전략을 명시할 것

### 2. UI보다 pure helper 먼저

예:

- 검색/통계/병합/부분 export는 먼저 `core/`나 `history/` helper로 구현
- 그 뒤 `App.tsx`에 연결

### 3. message protocol은 최소 확장

- popup/content/background 사이 메시지는 현재 매우 명시적
- 필요한 액션만 추가하고, 과도한 generic bus로 바꾸지 않는 편이 안전

### 4. permission 증가 기능은 마지막으로

현재 강점:

- 단일 host
- 로컬 저장
- Chrome Web Store 심사 설명이 단순함

따라서:

- network sync, 서버 전송, 새 host 접근은 후순위가 맞음

### 5. 테스트는 모듈 우선, UI는 핵심 경로만

권장:

- pure helper 테스트
- store regression 테스트
- panel/history 핵심 UI 흐름 테스트
- 추후 Playwright E2E 도입

## 기능별 추천 파일 접점 요약

### 기록 관리 기능

- `src/history/App.tsx`
- `src/history/history-view-state.ts`
- `src/storage/session-store.ts`
- `src/core/subtitle-models.ts`

### 수집/진단 기능

- `src/content/content-script.ts`
- `src/content/inpage-panel.ts`
- `src/content/capture-notice.ts`
- `src/shared/message-types.ts`
- `src/popup/App.tsx`

### transcript 후처리 기능

- `src/core/subtitle-pipeline.ts`
- `src/core/live-capture.ts`
- `src/core/exporters/*`
- `src/shared/copy-utils.ts`

### 설정/preset 기능

- `src/storage/settings-store.ts`
- `src/storage/types.ts`
- `src/options/App.tsx`
- `src/shared/constants.ts`

## 가장 추천하는 다음 단계

지금 시점에서 가장 효율적인 다음 묶음은 아래입니다.

1. 전체 기록 통합 검색
2. 사용자 태그 / 카테고리
3. 세션 품질 점수 / 수집 건강도

이 3개 조합이 좋은 이유:

- 이미 확장된 history 작업 허브를 바로 더 강하게 만들 수 있음
- 현재 추가된 즐겨찾기/메모/부분 export와 자연스럽게 이어짐
- storage schema 확장은 계속 작게 유지하면서도 사용자 체감 가치를 올릴 수 있음
- 이후 highlight, 발언자 UI, preset으로 연결하기 좋음

## 결론

이 프로젝트는 이미 “수집기” 단계를 넘어 “로컬 transcript 작업 도구”로 확장할 수 있는 구조를 갖고 있습니다.

가장 자연스러운 확장 방향은 다음 두 축입니다.

- `history`를 단순 보기 화면에서 작업 허브로 키우는 것
- `content/popup`에 capture 품질과 진행 상태를 더 정직하게 드러내는 것

반대로 지금 당장 서두를 필요가 없는 축은 아래입니다.

- 새 권한이 필요한 외부 서비스 연동
- 멀티 도메인 확장
- 서버 동기화 중심 구조 변경

즉, 현재 코드베이스의 강점을 살리려면 당분간은 `로컬 우선`, `기록 관리 강화`, `통합 검색`, `태깅`, `품질 진단 심화` 순서로 가는 것이 가장 합리적입니다.
