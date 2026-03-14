# 기능 구현 리스크 리뷰 클로저 (2026-03-14)

이번 라운드에서 `IMPLEMENTATION_RISK_REVIEW_2026-03-14.md`의 수정 제안을 모두 코드와 테스트에 반영했다.

검증 결과:

- `npm run typecheck`: 통과
- `npm run test`: 통과

## 처리 완료

### 1. 빈 `running` 세션 orphan 저장

완료 상태: 수정 완료

- `startCapture()`는 더 이상 빈 세션을 즉시 `running`으로 저장하지 않는다.
- `stopCapture()` 경유 최종 저장에서 실제 저장할 자막이 없으면 기존 `sessionId`의 persisted record를 명시적으로 정리한다.
- reset 전 보존 경로도 빈 세션이면 delete 경로로 정리한다.

관련 파일:

- `src/content/content-script.ts`

### 2. autosave / final save가 note / favorite를 덮어쓰는 문제

완료 상태: 수정 완료

- `saveSession()`과 `updateRunningSession()` 저장 직전에 기존 레코드를 읽어 `starred`, `pinnedAt`, `note`를 merge한다.
- history에서 의도적으로 덮어써야 하는 편집 경로는 `upsertSessionRecord()` 그대로 유지한다.

관련 파일:

- `src/storage/session-store.ts`
- `tests/session-store.test.ts`

### 3. page-exit queue 와 background persist race

완료 상태: 수정 완료

- page-exit 저장 순서를 helper로 분리했다.
- queue write가 끝난 뒤 background persist를 보내도록 순서를 고정했다.
- queue 실패 시에도 background persist는 계속 시도한다.

관련 파일:

- `src/content/page-exit-persist.ts`
- `src/content/content-script.ts`
- `tests/page-exit-persist.test.ts`

### 4. import만 fallback 정책이 달랐던 문제

완료 상태: 수정 완료

- `importSessionRecords()`도 일반 저장과 동일하게 transient IndexedDB failure 시 fallback 저장을 허용한다.
- `failedCount`는 두 저장 경로가 모두 실패한 경우에만 증가한다.

관련 파일:

- `src/storage/session-store.ts`
- `tests/session-store.test.ts`

### 5. history 전체 preload / 1000건 제한 / live refresh 부재

완료 상태: 수정 완료

- 저장소에 `listSessionsPage({ page, pageSize, starredOnly })`를 추가했다.
- history는 page API만 사용하도록 전환했다.
- `SESSION_LIBRARY_REVISION_STORAGE_KEY` 기반 변경 신호를 구독해 현재 페이지와 선택 세션을 다시 읽는다.
- 페이지를 넘겨도 `checkedIds`는 id 기준으로 유지하고, bulk delete 확인 대상은 `loadSessionsByIds()`로 다시 읽는다.
- 현재 페이지에 없는 선택 세션은 `loadSession()`으로 별도 로드한다.
- 동일 `selectedId` refresh 시 dirty `noteDraft`는 유지한다.

관련 파일:

- `src/storage/types.ts`
- `src/shared/constants.ts`
- `src/storage/session-store.ts`
- `src/history/App.tsx`
- `tests/history-app.test.tsx`
- `tests/session-store.test.ts`

### 6. popup / options 초기 스냅샷 정합성

완료 상태: 수정 완료

- `CaptureStatusPayload`에 `subtitleCount`, `charCount`, `previewText`, `recentEntries`를 포함했다.
- `createPopupMessages()`의 `CAPTURE_STATUS`가 초기 hydrate에 필요한 전체 스냅샷을 담는다.
- popup / options는 `CAPTURE_STATUS`만 받아도 초기 통계와 진단 상태를 정확히 표시한다.

관련 파일:

- `src/shared/message-types.ts`
- `src/content/popup-bridge.ts`
- `src/popup/App.tsx`
- `src/options/App.tsx`
- `tests/popup-app.test.tsx`
- `tests/options-app.test.tsx`

## 잔여 리스크

- content-script 전체 E2E 수준에서 `start -> stop` 빈 세션 경로를 브라우저 실환경으로 재현하는 테스트는 아직 없다.
- 하지만 저장 정책, page-exit 순서, history refresh, popup/options hydrate의 핵심 회귀 포인트는 단위/컴포넌트 테스트로 고정했다.

## 이번 라운드의 최종 상태

- 설계상 지적한 High / Medium 항목은 모두 코드 반영 완료
- 문서 sync 필요 항목은 `README.md`, `CLAUDE.md`에 반영 완료
- 다음 우선순위는 실제 브라우저 E2E 시나리오 추가 여부 판단이다
