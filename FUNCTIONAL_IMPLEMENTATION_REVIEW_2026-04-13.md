# 기능 구현 리뷰 (2026-04-13)

## 2026-04-13 구현 반영 메모

- 이 문서의 우선순위 항목은 같은 날짜 배치에서 모두 반영되었습니다.
- 현재 구현 기준:
  - mixed structured snapshot에서는 stable row만 commit되고 unstable row는 preview-only로 남습니다
  - JSON import는 incoming `running` 레코드를 모두 `saved`로 정규화합니다
  - export filename sanitize는 금지 문자를 전역 제거합니다
  - options / storage 숫자 설정은 정수만 허용합니다
  - `lint` / `test:coverage` 재현성 문제는 정리되었고 threshold 기반 회귀 검증이 활성화되었습니다
- 아래 본문은 원래 발견 근거를 보존하는 기록이며, 현재 상태 판단은 `README.md`, `CLAUDE.md`, `GEMINI.md`, `DEPLOYMENT.md`를 우선합니다.

## 범위

- 참조 문서: `CLAUDE.md`, `README.md`
- 확인 범위: `src/`, `tests/`, `scripts/`, 설정 파일
- 목적: 현재 구현 기준으로 기능적 잠재 이슈와 추가 보완 필요 항목을 정리

## 검증 결과

- 최초 점검 시점:
  - `npm run typecheck`: 통과
  - `npm run test`: 통과 (`38`개 파일, `176`개 테스트)
  - `npm run build`: 통과
  - `npm run lint`: 실패
    - `scripts/resize-marquee.js`의 `console` 전역 처리 누락으로 실패
  - `npm run test:coverage`: 실행 성공
    - 전체 커버리지 `39.95%`
    - `src/content/content-script.ts` `0%`
    - `src/background/service-worker.ts` `0%`
- 구현 반영 후 재검증:
  - `npm run lint`: 통과
  - `npm run typecheck`: 통과
  - `npm run test`: 통과 (`39`개 파일, `188`개 테스트)
  - `npm run build`: 통과
  - `npm run test:coverage`: 통과
    - 전체 커버리지 `75.22%`
    - 디렉터리 threshold 통과

## 핵심 판단

- 자막 수집/저장/내보내기 핵심 경로는 문서와 대체로 맞습니다.
- 다만, 최초 점검 시점에는 실제 런타임에서 오작동할 수 있는 경계 조건이 몇 군데 남아 있었습니다.
- 특히 `혼합 stable/unstable row 처리`, `running JSON import 의미론`, `파일명 sanitize`, `설정값 정수 검증`, `검증 체계 재현성`을 우선순위로 보았고, 현재는 모두 반영된 상태입니다.

## 주요 이슈

### 1. mixed stable/unstable row가 섞이면 전체 structured event가 preview-only로 강등됩니다

- 근거:
  - `src/content/subtitle-event-handler.ts:7-15`
  - `src/content/content-script.ts:892-957`
  - `tests/subtitle-event-handler.test.ts:5-43`
- 최초 점검 당시 `shouldCommitCaptureEvent()`는 `rows.every((row) => !row.unstableKey)`일 때만 commit 경로로 보냈습니다.
- 그런데 observer가 보내는 `rows`는 현재 화면에 보이는 row 스냅샷 전체이므로, 하나의 `unstableKey` row가 섞이면 안정적인 row까지 모두 commit 경로에서 빠질 수 있었습니다.
- 현재 구현은 `stable row만 commit`, `unstable row는 preview 유지`로 분리되었습니다.

### 2. 수집 중 JSON export를 다시 import하면 실제로는 종료된 세션이 `running` 상태로 저장될 수 있습니다

- 근거:
  - `src/content/content-script.ts:1233-1244`
  - `src/core/exporters/json.ts:22-38`
  - `src/storage/session-store.ts:1375-1380`
- 최초 점검 당시 수집 중 JSON export를 다시 가져오면 실제로는 종료된 세션이 `수집 중`으로 보일 수 있었습니다.
- 현재 구현은 import 경계에서 `running -> saved`를 강제 정규화합니다.

### 3. 파일명 sanitize가 금지 문자를 한 번만 제거해서 일부 다운로드 파일명이 여전히 깨질 수 있습니다

- 근거:
  - `src/shared/filename-pattern.ts:3-40`
  - `src/core/timeline.ts:71-94`
  - `tests/timeline.test.ts:25-35`
- 최초 점검 당시 `sanitizeFilenameBasename()`가 첫 번째 금지 문자만 제거했습니다.
- 현재 구현은 전역 정규식으로 금지 문자를 모두 제거합니다.

### 4. 숫자 설정이 정수여야 하는데 소수 입력도 그대로 저장됩니다

- 근거:
  - `src/options/App.tsx:109-124`
  - `src/storage/settings-store.ts:21-24`
  - `src/history/App.tsx:1323-1329`
- 최초 점검 당시 `recentCopyLineCount = 2.5` 같은 값도 저장 가능했습니다.
- 현재 구현은 UI draft 검증, `step=1`, storage sanitize를 함께 맞춰 정수만 허용합니다.

### 5. 현재 lint 결과가 로컬 임시 스크립트 때문에 깨져서 검증 재현성이 떨어집니다

- 근거:
  - `eslint.config.js:7-18`
  - `scripts/resize-marquee.js:1-29`
- 최초 점검 당시 `eslint .`가 로컬 전용 스크립트까지 검사해 실패했습니다.
- 현재 구현은 `scripts/resize-marquee.js`를 ignore하고, coverage include/exclude 및 디렉터리 threshold도 정리했습니다.

## 추가 보완이 필요한 부분

### 1. 런타임 핵심 경로에 대한 더 넓은 통합 검증은 계속 가치가 있습니다

- 현재는 `content-script.ts`, `service-worker.ts` 자체를 억지 통합 부팅 테스트로 감싸기보다 helper 분리 + Vitest smoke 검증으로 coverage를 확보했습니다.
- 그래도 실제 브라우저 레벨에서 아래 시나리오는 장기적으로 E2E가 있으면 더 안전합니다.
  - popup -> content 연결 실패 후 자동 재연결
  - `ENSURE_CONTENT_SCRIPT` 재주입 후 정상 응답
  - pagehide/beforeunload 시 queue + background persist
  - offscreen Blob 실패 시 data URL fallback

### 2. 커버리지 지표는 정리됐지만, 경계 흐름은 계속 누적 관리가 필요합니다

- 현재 커버리지는 `src/**/*.{ts,tsx}` 기준으로 정리됐고, bootstrap/type-only 파일은 제외했습니다.
- `content`, `background`, `storage` 디렉터리 threshold도 적용됐습니다.
- 이후 기능이 늘어나면 helper 분리와 threshold 재조정이 계속 필요합니다.

## 우선순위 제안

1. 현재 문서의 최초 이슈는 모두 반영 완료 상태로 본다
2. 다음 단계는 브라우저 레벨 E2E 또는 smoke 범위를 점진적으로 넓힌다
3. 문서 기준 판단은 항상 `README.md`, `CLAUDE.md`, `GEMINI.md`, `DEPLOYMENT.md` 최신 내용을 우선한다

## 메모

- 이번 점검에서는 이미 문서상 해결된 과거 감사 항목은 제외했습니다.
- 현재 구현의 큰 방향은 맞고, 최초 발견된 우선순위 이슈는 모두 반영되었습니다.
