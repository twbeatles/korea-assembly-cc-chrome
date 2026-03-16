# 기능 구현 점검 리포트 (2026-03-16)

검토 기준 문서:

- `README.md`
- `CLAUDE.md`
- `manifest.json`
- `src/`, `tests/`

## 검증 결과

- `npm run typecheck`: 통과
- `npm run build`: 통과
- `npm run test`: 실패
  - `tests/options-app.test.tsx` 2건 실패
  - 원인: 옵션 숫자 필드의 텍스트 구조가 바뀌었는데 테스트가 이전 문자열(`자동 저장 간격(ms)`)에 고정돼 있음

## 우선 대응이 필요한 구현 리스크

### 1. 히스토리 페이징이 실제로는 전체 라이브러리를 매번 읽는 구조

- 근거
  - `src/storage/session-store.ts:958`의 `listAllSessions()`가 전체 세션을 모두 읽음
  - `src/storage/session-store.ts:1044`의 `listSessionsPage()`가 내부에서 다시 `listAllSessions()`를 호출함
  - `src/history/App.tsx:222`에서 페이지 이동/새로고침마다 `listSessionsPage()`를 호출함
- 영향
  - 저장 기록이 많아질수록 history 진입, 페이지 이동, 즐겨찾기 필터, 새로고침이 함께 느려짐
  - "페이지네이션"이 UI에만 있고 실제 I/O 비용은 전체 조회와 같음
  - 전체 백업/삭제 확인 같은 보조 기능도 같은 병목을 공유할 가능성이 큼
- 권장
  - IndexedDB cursor/index 기반 실제 페이지네이션으로 전환
  - 총 개수 조회와 페이지 데이터 조회를 분리
  - fallback 저장소도 index 기반으로 page-aware 처리

### 2. 전체 삭제가 IndexedDB 오류 시 fallback 저장소 정리를 시도하지 않음

- 근거
  - `src/storage/session-store.ts:1087`의 `deleteAllSessions()`는 IndexedDB `clear()`가 실패하면 바로 예외를 던짐
  - 같은 함수에서 `clearFallbackRecords("전체 세션 삭제")`는 IndexedDB 성공 또는 "IndexedDB 미사용" 경로에서만 실행됨
- 영향
  - 일부 환경에서 "전체 삭제" 버튼이 실패하면 `chrome.storage.local` fallback 기록이 그대로 남을 수 있음
  - 사용자 기준으로는 "전체 삭제"가 부분 실패인지 완전 실패인지 알기 어려움
- 권장
  - IndexedDB와 fallback 정리를 독립적으로 시도
  - 저장소별 성공/실패 요약을 반환해서 UI에 부분 실패를 명시

### 3. `filenamePattern`에 대한 저장 전 검증이 부족함

- 근거
  - `src/options/App.tsx:635`에서 파일명 패턴을 자유 입력으로 받음
  - `src/storage/settings-store.ts:57`는 공백 제거 외 별도 검증을 하지 않음
  - `src/core/timeline.ts:77`는 `{committee}` 값만 sanitize 하고, 패턴 문자열 전체는 sanitize 하지 않음
- 영향
  - `/`, `\`, `:` 같은 문자가 포함되면 다운로드 실패 또는 의도치 않은 하위 경로 생성 가능성이 있음
  - 설정 저장은 성공했는데 실제 export 시점에만 오류가 나는 UX가 발생할 수 있음
- 권장
  - 패턴 전체에 allow-list 기반 검증 추가
  - options에서 inline 에러와 미리보기 파일명 제공
  - 저장 시점과 export 시점 둘 다 방어

### 4. 페이지 패널의 `최근 N줄 복사`가 실제 세션 기준 최근 N줄과 다르게 동작함

- 근거
  - `src/content/content-script.ts:1128`의 `copyRecentSessionLines()`는 `liveRows`가 1개라도 있으면 누적 `prepared.entries`를 무시함
  - 복사용 엔트리의 시간도 실제 세션 start/end가 아니라 `row.updatedAt`으로 재구성함
  - `src/shared/copy-utils.ts:42`는 전달받은 배열에서만 `limit`을 적용함
- 영향
  - 세션에는 자막이 많이 쌓여 있어도 현재 보이는 live row가 1~2개면 그 1~2줄만 복사될 수 있음
  - history의 `최근 N줄 복사`와 의미가 달라 사용자 기대와 어긋남
  - 복사 시간값이 실제 자막 시작 시각이 아니라 마지막 갱신 시각에 가까워질 수 있음
- 권장
  - live row만 따로 복사할지, 세션 최근 N줄을 backfill할지 의미를 명확히 결정
  - 현재 동작을 유지할 거면 버튼 라벨을 `현재 화면 자막 복사`처럼 분리
  - 가능하면 committed entry 시각을 함께 보존해서 복사 포맷을 history와 맞춤

## 중간 우선순위 리스크

### 5. 옵션 화면 회귀 테스트가 현재 UI와 어긋나 있어 설정 변경 검증 신뢰도가 떨어짐

- 근거
  - `tests/options-app.test.tsx:81`, `tests/options-app.test.tsx:99`는 `자동 저장 간격(ms)`라는 단일 텍스트를 찾음
  - 실제 UI는 `src/options/App.tsx:613`의 라벨 텍스트와 `src/options/App.tsx:625`의 단위 텍스트가 분리돼 있음
- 영향
  - 옵션 화면을 변경해도 테스트가 실제 사용 흐름을 안정적으로 검증하지 못함
  - 현재 `npm run test`가 실패 상태라 배포 전 기본 검증 루틴이 깨져 있음
- 권장
  - 접근성 이름(`label`/`aria-label`) 또는 명시적 테스트 훅 기준으로 셀렉터 재정리
  - 숫자 필드 공통 렌더러를 쓰고 테스트도 동일 규약으로 접근

## 추가 구현 권장 사항

### 1. 대용량 기록 처리 UX 보강

- 전체 백업, 대량 가져오기, 대량 삭제에 진행 상태와 작업 잠금 표시가 있으면 좋음
- 현재는 버튼 연타나 중복 실행에 대한 명시적 busy state가 약함

### 2. 실제 국회 페이지 기반 E2E 회귀검증 추가

- 현재 단위 테스트는 충분히 많지만, 실제 DOM 변화와 권한/메시징 흐름은 브라우저 통합 테스트가 더 적합함
- 최소 범위는 `패널 삽입`, `자동 시작`, `export`, `history 반영`, `pagehide 저장 복구` 정도가 적절함

### 3. 저장소 상태/용량 진단 추가

- fallback 저장소 사용 여부, 최근 저장소 오류, 대략적인 저장량을 options 진단에 노출하면 운영성이 좋아짐
- 특히 `chrome.storage.local` quota 근처에서 조기 경고가 있으면 좋음

## 요약

현재 프로젝트는 핵심 기능의 구현 밀도는 높고 `typecheck`/`build`도 통과합니다. 다만 운영 규모가 커질 때 가장 먼저 문제가 될 부분은 `history`의 전체 조회 기반 구조, export 파일명 검증 부재, 패널의 최근 복사 의미 불일치입니다. 여기에 더해 2026-03-16 기준 `npm run test`가 실패 상태이므로, 다음 작업 순서는 `options` 테스트 복구 -> history 실제 페이지네이션 -> filename pattern 검증 추가 순서를 권장합니다.

## 구현 반영 업데이트 (2026-03-16)

아래 항목은 이후 라운드에서 실제 구현 완료되었습니다.

- `history` store-level 페이지네이션
  - fallback 레코드가 없을 때 IndexedDB index 기반 paging/count 경로를 사용합니다
  - fallback 레코드가 있을 때만 correctness-first merged paging 으로 내려갑니다
- `deleteAllSessions()` 독립 정리
  - IndexedDB 와 fallback 저장소를 서로 독립적으로 정리하고, 부분 실패 detail 을 에러 메시지에 포함합니다
- `filenamePattern` 엄격 검증
  - `{date}`, `{committee}`, `{time}` 외 placeholder 를 거부합니다
  - 금지 문자 입력 시 options 에서 inline error 를 표시하고 저장을 막습니다
  - export 직전에도 최종 파일명을 한 번 더 안전하게 sanitize 합니다
- 페이지 패널 `최근 N줄 복사`
  - 현재 화면 row 임시값이 아니라 prepared session snapshot 기준의 누적 세션 최근 `N`줄을 복사하도록 정리했습니다
- `history` 대용량 작업 UX
  - 백업 / 가져오기 / 삭제 / 내보내기 / 즐겨찾기 / 메모 저장 / 재열기 등 장시간 작업 중 관련 버튼을 잠가 중복 실행을 막습니다
- 회귀 테스트
  - options 접근성 셀렉터 기반 테스트로 갱신
  - filename pattern 검증, delete-all 부분 실패, busy state, copy helper, timeline filename sanitize 테스트 추가

구현 이후 검증 상태:

- `npm run test`: 통과
- `npm run typecheck`: 통과
- `npm run build`: 통과
