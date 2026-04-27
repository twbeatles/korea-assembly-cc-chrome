# 기능 구현 안정화 리뷰

업데이트 기준일: `2026-04-27`

이 문서는 `FEATURE_IMPLEMENTATION_REVIEW.md` 에서 도출한 안정화 리스크와 이번 구현 결과를 맞춰 기록한 추적 문서다. 이번 차수는 리스크 수정 항목 1~10을 대상으로 했고, 신규 기능 후보는 다음 차수로 분리했다.

## 1. 이번 차수 구현 완료 범위

- 단일 JSON export 와 backup/import sanitize 경로에서 `lineageId`, `segmentNumber` 보존
- 기존 JSON 에 두 필드가 없어도 import 가능한 backward compatibility 유지
- IndexedDB schema `5` 로 상승 및 `lineageId` index 추가
- 기존 IndexedDB record migration 에서 lineage 기본값 보정
- `listSessionLineageSegments()` 를 대상 lineage record hydrate 중심으로 개선
- fallback record 가 있는 history page listing 에서 metadata 기준 page 계산 후 현재 page record 만 hydrate
- 전체 JSON 백업 다운로드를 history page Blob URL 직접 다운로드 경로로 전환
- 기본 `CAPTURE_STATUS` 에서 export estimate 계산 제거
- options diagnostics 전용 `GET_DIAGNOSTICS_STATUS` 메시지 추가
- background 저장 성공 응답의 `updatedAt` 을 `lastPersistedAt` 에 반영
- `/main` 무슬래시 URL을 manifest match, constants, tests 에 추가
- `pendingPreviews` 를 prepared snapshot 저장/export 경로에서 drop
- offscreen Blob chunk split 을 surrogate pair 안전 방식으로 변경
- 위험 orchestration 경로를 helper 단위 테스트로 회귀 방어

## 2. 구현 파일 요약

### 저장소 / import / export

- `src/core/exporters/json.ts`
  - JSON export payload 에 `lineageId`, `segmentNumber` 를 포함한다.
- `src/storage/session-backup.ts`
  - import sanitize allow-list 에 lineage metadata 를 포함한다.
  - 누락/invalid lineage metadata 는 이후 normalize 기본값 규칙에 맡긴다.
- `src/storage/session-store.ts`
  - `SESSION_DB_SCHEMA_VERSION = 5` 기준으로 `lineageId` index 를 추가한다.
  - migration 에서 기존 record 의 `lineageId`, `segmentNumber`, sort/index key 를 보정한다.
  - lineage 조회와 fallback page listing hydrate 범위를 줄인다.

### runtime / diagnostics

- `src/content/runtime/status-snapshot.ts`
  - `includeExportEstimates` 옵션이 true 일 때만 export estimate 를 계산한다.
- `src/content/content-script.ts`
  - diagnostics port 를 별도로 추적한다.
  - popup/panel 은 lightweight snapshot 을 받고, options diagnostics 는 estimate 포함 snapshot 을 받는다.
  - background persist 성공 시 `response.updatedAt ?? record.updatedAt` 을 `lastPersistedAt` 에 반영한다.
- `src/shared/message-types.ts`
  - `GET_DIAGNOSTICS_STATUS` content message 를 추가한다.
- `src/options/App.tsx`
  - diagnostics tab 연결 시 `GET_DIAGNOSTICS_STATUS` 를 요청한다.

### download / backup

- `src/history/page-blob-download.ts`
  - history page 에서 Blob URL 을 만들고 `chrome.downloads.download` 로 전체 backup 다운로드를 시작한다.
  - 완료/중단 이벤트 또는 timeout 뒤 Blob URL 을 revoke 한다.
- `src/history/App.tsx`
  - 전체 JSON 백업은 `DOWNLOAD_REQUEST` 대신 page Blob helper 를 호출한다.
  - 단일 세션 / lineage export 의 background 조립 경로는 유지한다.
- `src/background/export-content.ts`
  - surrogate pair 를 깨지 않는 code point 안전 chunk splitter 를 제공한다.
- `src/background/service-worker.ts`
  - offscreen Blob part 생성에 새 splitter 를 사용한다.

### URL / lifecycle

- `manifest.json`, `src/shared/constants.ts`
  - `https://assembly.webcast.go.kr/main`, `https://webcast.assembly.go.kr/main` 무슬래시 URL을 지원한다.
- `src/content/session-lifecycle.ts`
  - prepared snapshot 에서 `pendingPreviews` 를 entry 로 flush 하지 않고 drop 한다.

## 3. 테스트 보강

- `tests/exporters-json.test.ts`
  - JSON export 에서 lineage metadata 보존 확인
- `tests/session-backup.test.ts`
  - 단일 JSON / bundle import 에서 lineage metadata 보존 확인
- `tests/session-store.test.ts`
  - lineage 조회가 unrelated session body hydrate 문제에 영향받지 않는지 확인
- `tests/history-app.test.tsx`
  - 전체 JSON 백업이 runtime `DOWNLOAD_REQUEST` 대신 page Blob helper 를 호출하는지 확인
- `tests/content-runtime.test.ts`, `tests/options-app.test.tsx`
  - export estimate 가 diagnostics opt-in 경로에서만 계산되는지 확인
- `tests/constants.test.ts`
  - `/main` 과 `/main/` URL 지원 확인
- `tests/session-lifecycle.test.ts`
  - `pendingPreviews` 가 prepared record entries 로 저장되지 않는지 확인
- `tests/export-content.test.ts`
  - emoji/surrogate pair 포함 content chunk 가 깨지지 않는지 확인
- `tests/page-blob-download.test.ts`
  - page Blob 다운로드와 URL revoke 동작 확인

## 4. 검증 결과

최종 확인 명령:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

결과:

- `npm run lint` 통과
- `npm run typecheck` 통과
- `npm run test` 통과: 52 files, 271 tests
- `npm run build` 통과

테스트 중 일부 stderr 는 IndexedDB 실패/Blob metadata 실패를 의도적으로 유발하는 회귀 테스트 로그이며 실패가 아니다.

## 5. 다음 차수로 남긴 항목

- history list-level lineage grouping polish
- lineage-level 메모/즐겨찾기 정책
- threshold preset 또는 운영 프로파일
- DOM selector profile
- browser E2E smoke test
- 초대형 export 의 stream/offscreen 추가 보강

위 항목은 이번 안정화 차수의 리스크 수정 범위에서 제외했다.
