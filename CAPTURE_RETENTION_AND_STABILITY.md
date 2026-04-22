# 자막 수집 보존 범위와 장시간 세션 안정성

업데이트 기준일: `2026-04-22`

이 문서는 현재 구현이 `무엇을 얼마나 오래 들고 있는지`, `어디까지 저장/내보내기 되는지`, `몇 시간 단위 세션에서 어떤 병목이 남아 있는지`를 정리한 운영 문서다. 기준 구현은 `src/content/content-script.ts`, `src/content/autosave.ts`, `src/core/subtitle-pipeline.ts`, `src/storage/session-store.ts`, `src/storage/session-backup.ts`, `src/shared/constants.ts` 이다.

## 1. 요약

- 화면의 `실시간 내용(preview)` 은 기본적으로 메모리/UI 전용이다.
- 확장 UI 패널은 지원 사이트의 `main/` 홈에서도 즉시 뜨지만, 실제 자막 수집 시작은 `main/player*` 플레이어 페이지에서만 허용된다.
- 실제 저장, 자동 저장, 중지 저장, export 대상은 `state.entries` 에 들어간 `확정 자막(committed entries)` 뿐이다.
- 단일 세션 저장 자체에는 코드상 하드 용량 제한이 없다.
- 단일 세션 export 는 저장된 세션을 background 가 직접 읽어 조립하므로, 이전보다 Chrome runtime message 길이 한계 영향을 덜 받는다.
- segmented lineage 는 history 에서 `연속 캡처 전체 보기`로 합쳐 보고, TXT/SRT/VTT/JSON export 도 lineage 단위로 시작할 수 있다.
- 전체 라이브러리 `JSON 백업` / `JSON 가져오기` 는 `25 MiB` 하드 제한이 있다.
- `2026-04-22` 기준으로 autosave 는 `확정 자막 변경` 위주로만 스케줄되고, 연속 발화 중에도 최대 `15초` 안에는 한 번 저장되며, keepalive 기반 저장은 최소 `30초` 간격으로 줄였다.
- 저장소는 세션 메타데이터와 `entries chunk` 를 분리해 IndexedDB 에 저장한다.
- 실행 중 세션은 기본 threshold(`2000문장` / `120000자` / `90분`)를 넘기면 자동으로 다음 세그먼트로 roll-over 하며, 이 threshold는 options에서 조정할 수 있다.

## 2. 미리보기와 UI 보존 범위

### 실시간 preview

- fallback/container 원문은 내부적으로 tail `4096자` 까지만 유지한다.
- 일반 페이지의 fallback preview 표시는 최대 `400자` 또는 최근 `3줄` tail 의미론으로 줄여서 보여 준다.
- 본회의 계열 URL(`xcode=10` 또는 `xcgcd=DCM000010...`)은 UI에서 더 많이 보이더라도, 원본 입력 자체는 여전히 `4096자` tail 안에서만 유지된다.

### 패널/팝업 표시용 확정 자막

- 페이지 패널의 `수집된 자막` 렌더는 최신 `300건`만 그린다.
- live ledger도 최신 `300행` 기준으로 prune 된다.
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
- 전체 세션을 읽는 경로(`loadSession`, 전체 export, 전체 backup)는 필요한 시점에 chunk 를 hydrate 한다.

### 저장되지 않는 것

- preview-only 텍스트
- unstable row
- duplicate 로 판정된 텍스트
- noise filter 에 걸린 텍스트
- 패널 notice 문구

즉, 화면에 보였다고 해서 바로 영구 저장되지는 않는다. `확정 자막`으로 commit 된 뒤에만 저장 대상이 된다.

## 4. export 범위와 한계

### TXT / SRT / VTT / JSON

- export 는 현재 세션의 `확정 자막 전체`를 사용한다.
- 패널이 최신 `300건`만 보여도 export 는 세션 전체 `entries` 를 대상으로 한다.
- export 직전에는 `normalizeSessionForExport()` 가 마지막 안전망으로 중복/이어붙기 흔적을 한 번 더 정리한다.

### 단일 세션 export의 실제 한계

- 코드상 하드 byte cap 은 없다.
- 현재는 content script/history 가 `sessionId + export 옵션`만 background 에 보내고, 실제 export payload 는 service worker 가 저장소에서 세션을 직접 읽어 조립한다.
- Blob 다운로드가 실패하면 약 `2 MiB` 이하 payload 에 한해 data URL fallback 으로 한 번 더 시도한다.
- 큰 payload 는 offscreen Blob URL을 chunked part 기준으로 만들고, data URL fallback 이 비현실적인 크기에서는 명시적 오류로 중단한다.
- 현재 사용자 노출 오류 문구는 `message length exceeded`, `invalid data URL`, `large data URL fallback disabled` 계열을 별도 안내로 매핑한다.

실무 의미:

- 몇 시간짜리 매우 큰 단일 세션도 저장소에는 남길 수 있다.
- 이전보다 `한 번에 파일 export` 안정성은 좋아졌지만, 최종 다운로드 단계는 여전히 브라우저 download/Blob 정책 한계의 영향을 받는다.

### 전체 라이브러리 backup/import

- `JSON 백업` / `JSON 가져오기` 는 둘 다 `25 MiB` 이하만 지원한다.
- 이 제한은 세션 하나가 아니라 `라이브러리 전체 payload` 기준이다.

## 5. 메모리와 장시간 세션 안정성

### 현재 메모리 스케일링

- 가장 큰 메모리 사용처는 현재 탭의 `state.entries` 이다.
- `2026-04-22` 기준으로는 이 배열이 세션 전체 길이만큼 무한히 늘어나지 않고, 현재 segment threshold 안에서만 커진다.
- `confirmedCompact` 는 최대 `50000자`, recent history compact 는 `5000자`, fallback raw 는 `4096자` 로 따로 cap 이 걸려 있다.

즉, 장시간 세션에서 진짜로 커지는 것은 preview 보조 버퍼가 아니라 `현재 segment의 확정 자막 목록` 이다.

### 2026-04-22 안정화 반영

- autosave 는 preview-only 변경 때마다 전체 세션을 다시 쓰지 않는다.
- autosave 는 `확정 자막 commit` 이 생겼을 때만 스케줄한다.
- 발화가 계속 이어져 debounce 가 계속 밀려도, dirty 상태가 시작된 뒤 최대 `15초` 안에는 한 번 저장한다.
- keepalive 로 마지막 줄 `endTime` 만 연장되는 상황은 최소 `30초` 간격으로만 저장한다.
- pipeline 의 keepalive/row update/finalize 경로는 이제 세션 전체 entry 객체를 매번 깊게 복제하지 않고, 바뀐 entry만 복제한다.
- autosave 성공 후 `lastPersistedAt` 갱신도 세션 전체 deep clone 대신 얕은 구조 복제로 처리한다.
- 저장소 write path 는 세션 전체 자막 배열을 한 레코드로 다시 쓰지 않고, 바뀐 chunk 만 갱신한다.
- history/panel export 는 content 쪽에서 대형 문자열을 미리 만들지 않고 background 쪽에서 세션 단위로 조립한다.
- running capture 는 threshold 초과 시 현재 segment 를 즉시 저장하고, 같은 lineage 의 다음 segment 로 자동 전환한다.
- segment 전환 시 live ledger 는 유지하되 committed entry 연결만 끊어, 마지막 줄이 다음 segment 첫 줄로 중복 저장될 가능성을 낮춘다.
- options `수집 진단` 화면에는 현재 segment의 문장 수/글자 수/경과 시간 사용량과 TXT/SRT/VTT/JSON 예상 export 크기가 표시된다.
- segmentation threshold도 options 숫자 설정으로 조정할 수 있다.

이 변경으로 줄어든 것:

- 장시간 세션 중 불필요한 전체 record rewrite 빈도
- keepalive 구간의 CPU/GC 부담
- autosave 성공 직후의 대형 deep clone 비용

## 6. 아직 남아 있는 한계

- 현재 탭 메모리는 이제 `현재 segment` 범위 안에서 제한되지만, threshold 자체는 여전히 메모리 사용량과 UX trade-off를 가진다.
- segment 가 여러 개 생기면 history 에서 개별 세그먼트와 lineage 전체 보기를 전환할 수 있다.
- lineage 전체 export 는 지원하지만, 최종 다운로드 단계는 여전히 browser transport 한계의 영향을 받는다.
- 단일 세션 export 는 background 조립으로 개선됐지만, 최종 다운로드 단계는 여전히 browser transport 한계의 영향을 받는다.

따라서 현재 구조는 `몇 시간 단위 운영`을 넘어서도 훨씬 안전해졌고, 남은 과제는 `lineage 전체 UX의 세부 polish`와 `아주 큰 export` 쪽으로 더 좁혀졌다.

## 7. 운영 권장안

- 회의가 매우 길더라도 수집 자체는 계속해도 된다. 다만 export 안전성까지 보려면 휴회/정회/안건 전환 지점에서 세션을 한 번 끊는 편이 낫다.
- 장시간 녹화 중 중요한 구간이 끝날 때마다 `지금 저장`을 눌러 두면 recovery 지점이 더 촘촘해진다.
- 자동 segmentation 이 켜져 있어도, 단일 세그먼트 export 가 너무 커질 수 있는 경우 history 의 부분 선택 export 또는 휴회 시점 수동 분할이 여전히 유효하다.
- 여러 세그먼트가 쌓인 회의는 history 에서 `현재 세그먼트`와 `연속 캡처 전체`를 상황에 따라 전환해 보는 것이 맞다.

## 8. 다음 단계 후보

진짜로 `몇 시간이 아니라 사실상 하루 단위`까지 안정성을 끌어올리려면 아래 순서가 맞다.

1. lineage 전체 보기에서의 grouping/polish 개선
2. 필요하면 offscreen/stream 기반 download 경로로 아주 큰 export 의 브라우저 한계 대응
3. threshold preset 또는 운영 프로파일 정책 정리

현재 배치에서는 저장소 chunking, background export-by-session, write amplification 완화, runtime segmentation roll-over, lineage 전체 보기/export, diagnostics 규모 노출, threshold 설정화까지 반영했다.

- 세션 모델/저장소는 `lineageId`, `segmentNumber` 메타데이터를 수용한다.
- 같은 lineage 의 segment 를 store 에서 조회할 수 있다.
- runtime segmentation threshold 판정 helper 와 다음 segment state 생성 helper 가 실제 roll-over 흐름에 연결되어 있다.
- history 는 `세그먼트 N` 표시, lineage segment 전환, `연속 캡처 전체 보기` 토글을 제공한다.
- lineage 전체 TXT/SRT/VTT/JSON export 는 background 에서 병합 조립한다.
- options `수집 진단`은 현재 segment threshold 사용량과 예상 export 크기를 표시한다.
- 매우 큰 export는 data URL fallback을 무조건 시도하지 않고, offscreen Blob 경로 실패 시 명시적 오류로 정리한다.

상세 설계와 후속 slice 는 `RUNTIME_SESSION_SEGMENTATION_PLAN.md` 를 따른다.
