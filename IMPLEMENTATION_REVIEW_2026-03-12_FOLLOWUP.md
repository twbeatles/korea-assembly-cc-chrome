# Implementation Review Follow-up 2026-03-12

## Scope

- Reference docs reviewed: `README.md`, `CLAUDE.md`
- Active implementation reviewed:
  - `src/content/content-script.ts`
  - `src/history/App.tsx`
  - `src/history/history-view-state.ts`
  - `src/storage/session-store.ts`
- Current working tree changes were included in this review

## Findings

### 1. [Medium] `전체 삭제`는 실제로는 history 화면에 로드된 최대 1000건만 삭제합니다

- Evidence
  - history 목록은 `HISTORY_PAGE_SESSION_LIMIT = 1000`으로 제한됩니다. `src/history/App.tsx:20`
  - `refresh()`는 항상 `listSessions({ limit: HISTORY_PAGE_SESSION_LIMIT })`만 읽습니다. `src/history/App.tsx:83-89`
  - `handleDeleteAll()`은 현재 메모리에 올라온 `sessions` 배열만 순회해 삭제한 뒤 "모두 삭제" 메시지를 표시합니다. `src/history/App.tsx:174-188`
- Impact
  - 저장된 기록이 1000건을 넘는 환경에서는 오래된 레코드가 storage에 그대로 남을 수 있습니다.
  - UI는 "저장된 기록 N건을 모두 삭제했습니다."라고 안내하지만, 실제로는 로드된 일부만 삭제될 수 있습니다.
- Recommendation
  - storage 계층에 `deleteAllSessions()` 같은 전용 API를 추가해 backend 전체를 비우도록 바꾸는 편이 안전합니다.
  - 최소한 현재 동작을 유지한다면 버튼 문구/확인 문구를 "현재 불러온 기록 삭제"로 바꿔야 합니다.

### 2. [Medium] 선택 삭제/전체 삭제는 중간 실패를 부분 성공으로 복구하지 못합니다

- Evidence
  - bulk delete는 `deleteSessionIds()`에서 순차적으로 `await deleteSession(id)`를 호출하다가 첫 예외에서 중단됩니다. `src/history/App.tsx:153-157`
  - `handleDeleteChecked()`와 `handleDeleteAll()`은 성공 경로에서만 `refresh()`와 선택 상태 정리를 수행합니다. `src/history/App.tsx:159-188`
- Impact
  - 일부 레코드는 이미 삭제됐는데 다음 레코드에서 실패하면, 화면은 삭제 전 선택 상태를 계속 들고 있을 수 있습니다.
  - 사용자는 어떤 레코드가 실제로 삭제됐는지 알기 어렵고, 재시도 시 혼란이 생깁니다.
- Recommendation
  - `Promise.allSettled()` 또는 per-id 결과 수집 방식으로 바꾸고, 실패가 있더라도 마지막에 `refresh()`를 실행해 실제 storage 상태로 화면을 동기화해야 합니다.
  - 메시지는 "성공 X건 / 실패 Y건" 형태로 요약하는 편이 낫습니다.

### 3. [Low] history 액션 성공 메시지가 `refresh()`에 의해 바로 덮어써집니다

- Evidence
  - 단건 삭제는 `"선택한 기록을 삭제했습니다."`를 설정한 직후 `refresh()`를 호출합니다. `src/history/App.tsx:140-150`
  - 선택 삭제와 전체 삭제도 각각 성공 메시지를 설정한 뒤 `refresh()`를 호출합니다. `src/history/App.tsx:168-188`
  - 그러나 `refresh()`는 항상 `"최신 기록부터 보여주고 있습니다."` 또는 `"저장된 기록이 없습니다."`로 메시지를 다시 씁니다. `src/history/App.tsx:83-89`
- Impact
  - 실제 사용자에게는 삭제 성공/실패 맥락보다 generic refresh 메시지만 보일 가능성이 높습니다.
  - bulk delete처럼 파괴적인 작업에서 피드백 품질이 떨어집니다.
- Recommendation
  - `refresh()`가 메시지를 직접 세팅하지 않도록 분리하거나, caller가 후속 메시지를 유지할 수 있는 옵션을 추가하는 편이 좋습니다.

### 4. [Low] `정상 수집 중` notice가 fallback-only 경로에도 동일하게 표시됩니다

- Evidence
  - non-empty capture event를 받으면 분기 전에 곧바로 `setPanelNotice(ACTIVE_CAPTURE_NOTICE)`를 실행합니다. `src/content/content-script.ts:767-778`
  - 이후 stable structured row가 아닌 fallback path로 내려가도 같은 notice를 유지합니다. `src/content/content-script.ts:807-837`
- Impact
  - 실제로는 observer row를 안정적으로 잡지 못하고 fallback preview만 따라가는 상황에서도 UI는 "자막을 정상적으로 수집 중입니다."라고 표시합니다.
  - `README.md`/`CLAUDE.md`에서 설명하는 observer-first + fallback semantics와 사용자가 보는 상태 메시지가 어긋날 수 있습니다.
- Recommendation
  - notice를 최소 3단계로 분리하는 편이 낫습니다.
  - 예: `structured stable capture`, `fallback capture`, `reset/recovering`
  - `captureMode`와 `observerActive`를 함께 써서 상태를 더 정직하게 표현하는 것이 좋습니다.

## Additional Recommended Work

### A. History App 수준의 UI 테스트가 아직 약합니다

- 현재 테스트는 selection helper 위주입니다. `tests/history-view-state.test.ts`
- 아래 경로는 여전히 App-level regression test가 없는 상태입니다.
  - 선택 삭제 후 부분 실패 처리
  - 전체 삭제 후 실제 메시지 유지
  - 1000건 초과 데이터셋에서의 동작

### B. Notice 상태 전이도 전용 테스트가 있으면 좋습니다

- 현재 in-page panel 렌더링 테스트는 존재하지만, content-script의 `reset -> active -> fallback` notice 전이 자체를 검증하는 테스트는 없습니다.
- `handleTopFrameEvent()`를 감싼 focused test를 추가하면 이번 notice 조정이 다시 흔들릴 가능성을 줄일 수 있습니다.

## Verification Notes

- This review was based on source inspection of the current working tree.
- Recent local validation for the current tree had already passed:
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test`
  - `npm run build`
