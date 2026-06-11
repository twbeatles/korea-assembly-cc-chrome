# 자막 수집 보존 범위와 장시간 세션 안정성

업데이트 기준일: `2026-06-11`

이 문서는 현재 구현이 `무엇을 얼마나 오래 들고 있는지`, `어디까지 저장/내보내기 되는지`, `몇 시간 단위 세션에서 어떤 병목을 줄였는지`를 정리한 운영 문서다. 기준 구현은 manifest-facing bootstrap 인 `src/content/content-script.ts`, content runtime 공개 facade 인 `src/content/app/runtime.ts`, 실제 content 런타임 조립부인 `src/content/app/runtime/implementation.ts`, 런타임 경계 타입인 `src/content/app/context.ts`, `src/content/session-lifecycle.ts`, `src/core/subtitle-pipeline.ts`, storage 공개 facade 인 `src/storage/session-store.ts`, 실제 storage 구현인 `src/storage/session-store/implementation.ts`, `src/storage/session-backup.ts`, `src/history/page-blob-download.ts`, `src/background/export-content.ts`, `src/shared/constants.ts` 이다.

## 1. 요약

- 화면의 `실시간 내용(preview)` 은 안정 관측 전에는 메모리/UI 전용이다.
- 자동 저장, 중지 저장, pagehide / beforeunload snapshot, 파일 export 는 모두 `state.entries` 에 들어간 확정 자막만 사용한다.
- fallback preview 는 같은 normalized raw 가 2회 이상 또는 400ms 이상 안정적으로 관측된 뒤 `sourceCaptureMode: "fallback"` entry 로 커밋된다.
- `pendingPreviews` 와 안정 관측 전 fallback 후보는 prepared snapshot 생성 시 버려지며, 저장 record entry 로 승격하지 않는다.
- 확장 UI 패널은 지원 사이트의 `main` / `main/` 홈에서도 즉시 뜨지만, 실제 자막 수집 시작은 `main/player*` 플레이어 페이지에서만 허용된다.
- 실행 중 세션은 현재 segment preset/threshold 를 넘기면 같은 `lineageId` 의 다음 `segmentNumber` 로 자동 roll-over 한다. 기본 `balanced` preset 은 `2000문장` / `120000자` / `90분` 이며, `stability`, `capacity`, `custom` preset 도 제공된다.
- 저장소는 IndexedDB schema `5` 기준으로 `lineageId` index 를 가지며, 기존 record 는 migration 에서 `lineageId = id`, `segmentNumber = 1` 기본값을 채운다.
- 단일 세션 / lineage export 는 background 가 저장소에서 본문을 읽어 조립한다. history 는 lineage 예상 export 크기가 `8 MiB` 를 넘으면 segment별 분할 저장 액션을 제공한다.
- 전체 라이브러리 JSON 백업은 history page 에서 Blob URL 다운로드를 직접 시작하며, 대형 `content` 문자열을 `DOWNLOAD_REQUEST` 로 service worker 에 보내지 않는다.
- 전체 라이브러리 `JSON 백업` / `JSON 가져오기` 는 `25 MiB` 하드 제한이 있다.

## 2. 미리보기와 UI 보존 범위

### 실시간 preview

- fallback/container 내부 원문은 비본회의 URL 에서 tail `4096자` 까지만 유지한다. 본회의(`xcode=10` 또는 `xcgcd=DCM000010...`) URL 은 증분 비교/복원용 raw 를 전체 보존한다.
- fallback preview 표시는 URL 과 무관하게 최대 `400자` / 최근 `3줄` tail 의미론으로 줄여서 보여 준다.
- structured row snapshot 안에 stable/unstable row 가 함께 있어도 stable row 만 commit 되고, unstable row 는 preview-only 로 남는다.
- structured row commit 은 `sourceCaptureMode: "structured"`, 안정 관측을 통과한 fallback commit 은 `sourceCaptureMode: "fallback"` 으로 기록된다.
- 하늘색 등 highlight 가 남아 있는 `인식 중` 자막은 확정 전까지 commit / 저장 / export 대상에서 제외한다.

### 패널/팝업 표시용 확정 자막

- 페이지 패널의 `수집된 자막` 렌더는 최신 `300건`만 그린다.
- live ledger 도 최신 `300행` 기준으로 prune 된다.
- popup/status payload 의 `recentEntries` 는 최근 `20건`만 전달한다.

중요: 위 제한은 전부 `표시/진단용`이다. 세션 전체 저장본이나 export 범위를 자르지 않는다.

## 3. 실제 저장 범위

### 저장되는 것

- autosave
- `지금 저장`
- `멈추기`
- `visibilitychange(hidden)`
- `pagehide`
- `beforeunload`

위 경로들은 모두 최종적으로 `SessionRecord.entries` 기준으로 저장한다.

### 저장 방식

- IndexedDB 메인 store 에는 세션 메타데이터와 chunk digest/개수만 저장한다.
- 실제 자막 본문 `entries` 는 기본 `250개` 단위 chunk 로 별도 store(`session-entry-chunks`)에 저장한다.
- 세션을 다시 저장할 때는 digest 가 바뀐 chunk 만 갱신하고, 줄어든 경우 초과 chunk 만 삭제한다.
- 전체 세션을 읽는 경로(`loadSession`, 단일 export, lineage export, 전체 backup)는 필요한 시점에 chunk 를 hydrate 한다.
- `listSessionLineageSegments()` 는 `lineageId` index 로 대상 lineage record 만 조회한 뒤 hydrate 한다.
- `listSessionsPage()` 와 `listSessionLineagesPage()` 는 metadata-only record 로 page 를 계산한다. page 결과의 `entries` 는 항상 빈 배열이며, 상세 화면 / export / backup 처럼 본문이 필요한 경로만 `loadSession()` 또는 `loadSessionsByIds()` 로 hydrate 한다.
- fallback storage 는 full record 와 별도로 entryless metadata snapshot/index 를 유지한다. 기존 fallback record 만 있는 설치는 migration/backfill 때 1회 full read 로 metadata snapshot 을 만든 뒤 이후 listing 에서는 metadata 를 우선 사용한다.

### 저장되지 않는 것

- 안정 관측 전 preview-only 텍스트
- `pendingPreviews`
- unstable row
- duplicate 로 판정된 텍스트
- noise filter 에 걸린 텍스트
- 패널 notice 문구

즉, 화면에 보였다고 해서 바로 영구 저장되지는 않는다. structured stable row 또는 보수 fallback 안정 관측 정책을 통과해 `확정 자막`으로 commit 된 뒤에만 저장 대상이 된다.

## 4. export / backup 범위와 한계

### TXT / SRT / VTT / JSON / MD / CSV

- export 는 현재 세션 또는 lineage 의 `확정 자막 전체`를 사용한다.
- 패널이 최신 `300건`만 보여도 export 는 세션 전체 `entries` 를 대상으로 한다.
- JSON 단일 export 와 backup/import sanitize 경로는 `lineageId`, `segmentNumber` 를 보존한다.
- 기존 JSON 에 두 필드가 없어도 import 가능하며, 누락 시 `lineageId = id`, `segmentNumber = 1` 기본값을 적용한다.
- JSON 가져오기는 session `id` 를 trim 한 뒤 빈 값이면 invalid record 로 거부한다.
- CSV export 는 스프레드시트 formula injection 을 막기 위해 trim 기준 `=`, `+`, `-`, `@`, tab, CR prefix 를 apostrophe prefix 로 neutralize 한다.
- Markdown export 는 table/metadata cell 에서 `|`, `<`, `>`, CR/LF 가 table 구조나 HTML-like 렌더링을 깨지 않도록 escape 한다.
- export 직전에는 `normalizeSessionForExport()` 가 마지막 안전망으로 중복/이어붙기 흔적을 한 번 더 정리한다.

### 단일 세션 / lineage export

- 코드상 하드 byte cap 은 없다.
- content script/history 는 `sessionId` 또는 `lineageId` 와 export 옵션만 background 에 보낸다.
- service worker 가 저장소에서 세션을 읽어 payload 를 조립한다.
- 큰 payload 는 offscreen Blob URL 을 chunked part 기준으로 만들고, chunk split 은 surrogate pair 를 깨지 않는 code point 안전 방식이다.
- Blob 다운로드가 실패하면 bounded payload 에 한해 data URL fallback 을 시도한다.
- payload 가 비현실적으로 크면 명시적 large-export 오류로 중단한다.
- lineage export 예상 용량이 `8 MiB` 를 넘으면 history UI 에서 `segment-001` 같은 suffix 를 붙인 segment별 파일 저장을 제공한다.

### 전체 라이브러리 JSON backup/import

- 전체 JSON 백업은 page-wise metadata listing 으로 session id 를 순회하고, 각 page id 는 중복 제거 후 `loadSessionsByIds()` 로 한 번만 full hydrate 하며, incremental packaging 으로 진행률을 갱신한다.
- 생성된 전체 backup payload 는 history extension page 에서 Blob URL 로 직접 다운로드한다.
- Blob URL 은 다운로드 완료/중단 이벤트 또는 timeout 뒤 revoke 한다.
- 전체 backup 은 더 이상 `DOWNLOAD_REQUEST` 메시지에 대형 `content` 문자열을 실어 service worker 로 보내지 않는다.
- `JSON 백업` / `JSON 가져오기` 는 둘 다 `25 MiB` 이하만 지원한다.

## 5. diagnostics 비용 관리

- popup 과 in-page panel 의 기본 `CAPTURE_STATUS` 는 lightweight snapshot 이다.
- 기본 snapshot 에는 TXT/SRT/VTT/JSON 예상 export 크기를 넣지 않는다.
- options 의 `수집 진단` 탭은 `GET_DIAGNOSTICS_STATUS` 로 연결하고, 해당 port 에만 export estimate 계산 결과를 포함한다.
- segment threshold 사용량, stable/unstable row count, unconfirmed 필터 차단 수, row key source, fallback commit state 는 diagnostics 에 포함되며, 예상 export 크기는 options diagnostics 에서만 확인한다.

## 6. 메모리와 장시간 세션 안정성

- 가장 큰 메모리 사용처는 현재 탭의 `state.entries` 이며, 자동 segmentation 으로 현재 segment 범위 안에서 제한된다.
- `confirmedCompact` 는 최대 `50000자`, recent history compact 는 `5000자`, 비본회의 fallback raw 는 `4096자` 로 cap 이 있다. 본회의 fallback raw 는 장시간 비교/복원 정합성을 위해 내부 raw 를 전체 보존하므로 segment threshold 와 fallback 안정 커밋 정책으로 현재 segment 범위를 관리한다.
- autosave 는 확정 자막 commit 중심으로만 스케줄하며, preview-only 변경만으로 빈 running record 를 만들지 않는다.
- keepalive 로 마지막 줄 `endTime` 만 연장되는 상황은 최소 `30초` 간격으로만 저장한다.
- pipeline 의 keepalive/row update/finalize 경로는 필요한 entry 중심으로 갱신한다.
- 저장소 write path 는 세션 전체 자막 배열을 한 레코드로 다시 쓰지 않고, 바뀐 chunk 만 갱신한다.

## 7. 현재 한계와 후속 후보

- history 기본 목록은 lineage summary 단위로 전환됐고, lineage 수준 즐겨찾기/메모/삭제/export 는 각 segment record 에 동일 patch 를 적용하는 v1 정책이다.
- 단일 세션 / lineage export 는 background 조립과 offscreen Blob chunk 경로, lineage 분할 저장으로 개선됐지만, 최종 다운로드 단계는 여전히 브라우저 download/Blob 정책의 영향을 받는다.
- DOM selector profile 은 계속 실제 사이트 변화에 맞춰 보정이 필요할 수 있다.
- browser E2E smoke 는 `npm run test:e2e:extension` 로 제공하지만, 실제 국회 사이트 운영 DOM 과 완전히 같은 보장은 아니므로 fixture 보강 여지는 남아 있다.

## 8. 운영 권장안

- 회의가 매우 길어도 수집 자체는 계속해도 된다. 다만 export 안전성까지 보려면 휴회/정회/안건 전환 지점에서 수동 저장 상태를 확인하는 편이 낫다.
- 장시간 녹화 중 중요한 구간이 끝날 때마다 `지금 저장`을 눌러 recovery 지점을 촘촘하게 만든다.
- 여러 세그먼트가 쌓인 회의는 history 의 lineage summary 목록에서 회의 단위로 확인하고, 상세 화면에서 `현재 세그먼트`와 `연속 캡처 전체`를 상황에 따라 전환한다.
- 전체 라이브러리 백업은 `25 MiB` 제한을 넘지 않도록 오래된 기록을 정리하거나 기간별로 나눠 운용한다.
