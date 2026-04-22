# Runtime Session Segmentation Plan

업데이트 기준일: `2026-04-22`

## 1. 목표

장시간 회의 수집 중 현재 탭 메모리에 누적되는 `state.entries` 를 세션 segment 단위로 잘라, 수집 안정성을 `몇 시간`에서 `하루 단위` 쪽으로 끌어올린다.

현재 상태:

- phase 1 기본 roll-over 는 구현됨
- content script/panel 은 지원 사이트의 `main/` 홈과 `main/player*` 에서 로드되며, segmentation 판단은 실제 player capture 중에만 의미를 가진다
- history 에는 `세그먼트 N`, lineage summary, `연속 캡처 전체 보기` 토글이 들어감
- lineage 전체 TXT/SRT/VTT/JSON export 도 background 병합 경로로 연결됨
- diagnostics 에 현재 segment threshold 사용량과 예상 export 크기가 표시됨
- threshold 는 options 설정으로 조정 가능

## 2. 비목표

- 전체 라이브러리 backup/import 정책 변경
- 세션 export 포맷 자체 변경
- history 화면의 대규모 UX 개편

## 3. 현재 병목

- 저장소는 이미 `entries chunk` 단위라 write amplification 이 줄어들었다.
- export 는 background 조립이라 runtime message 길이 리스크가 줄었다.
- 하지만 현재 탭은 `state.entries` 전체를 유지하므로, 길어진 회의에서는 메모리와 복제 비용이 계속 증가한다.

## 4. 데이터 모델 결정

### 세션 메타데이터

- `SessionRecord.lineageId`
- `SessionRecord.segmentNumber`
- `SessionState.lineageId`
- `SessionState.segmentNumber`

기본 규칙:

- 분할되지 않은 기존 세션은 `lineageId = id`, `segmentNumber = 1`
- 같은 연속 캡처에서 분리된 segment 는 같은 `lineageId` 를 공유한다
- 순서는 `segmentNumber` 로 표현한다

왜 이 구조를 택했는가:

- `previousSegmentId` / `nextSegmentId` 같은 링크 필드 없이도 정렬과 그룹화가 된다
- 기존 세션과의 backward compatibility 가 단순하다
- history/export 에서 lineage 단위 조회를 만들기 쉽다

## 5. boundary 정책

현재 적용 중인 기본 threshold:

- `maxEntriesPerSegment = 2000`
- `maxCharsPerSegment = 120000`
- `maxDurationMs = 90분`

판정 순서:

1. entry 수
2. char 수
3. segment duration

현재 코드 기준 helper:

- `src/content/runtime/segmentation-policy.ts`

이 값들은 현재 실제 roll-over에 연결되어 있으며, options 숫자 설정으로 조정할 수 있다.

## 6. roll-over 동작

boundary 를 넘으면 현재 구현은 아래 순서로 처리한다.

1. 현재 running state 를 `prepared saved record` 로 만든다
2. 저장소에 즉시 persist 한다
3. 같은 `lineageId` 와 `segmentNumber + 1` 을 가진 새 running state 를 만든다
4. observer / polling / panel 상태는 유지한 채 segment 내부 버퍼만 새로 시작한다
5. notice 에 `세션을 새 segment 로 분할했다` 는 문구를 남긴다

주의:

- preview-only 상태에서는 roll-over 하지 않는다
- persist 실패 시 현재 segment 를 그대로 유지하고 사용자에게 오류를 보여준다
- roll-over 는 commit 직후에만 평가한다
- live ledger 는 유지하되 `committedEntryId` 만 끊어, 마지막 줄이 다음 segment 첫 줄로 중복 저장되는 가능성을 줄인다

## 7. history / export 정책

### history

현재 구현에는 아래가 들어가 있다.

- detail / list 화면에 `세그먼트 N` 표시
- 같은 lineage 의 segment 목록 조회 API 사용 가능
- detail 화면에서 lineage summary, segment 전환 버튼, `연속 캡처 전체 보기` 토글

### export

현재 구현에는 아래가 들어가 있다.

- 세그먼트별 export 유지
- lineage 전체 TXT/SRT/VTT/JSON export 추가
- lineage 전체 보기 상태에서는 history 의 선택 항목 export 도 병합 view 기준으로 동작

후속 후보:

- lineage list/grouping summary 강화
- lineage 수준 메타데이터 UX 정리

## 8. 이번 변경으로 준비된 기반

### 모델 / 코어

- `src/core/subtitle-models.ts`
- `src/core/session-lineage.ts`

### lifecycle

- `src/content/session-lifecycle.ts`

### segmentation policy

- `src/content/runtime/segmentation-policy.ts`

### live roll-over orchestration

- `src/content/runtime/segment-rollover.ts`
- `src/core/live-capture.ts`
- `src/content/content-script.ts`

### store

- `src/storage/session-store.ts`

## 9. 다음 구현 slice

다음 slice 는 아래 파일들을 주로 건드리면 된다.

- `src/history/App.tsx`
- `src/storage/session-store.ts`
- `src/background/service-worker-commands.ts`

실제 작업 순서:

1. history list 에 lineage grouping summary 추가
2. threshold preset/운영 모드 정리
3. 큰 export 의 stream/offscreen 경로 추가 보강
4. lineage 수준 메타데이터 UX 정리

## 10. 테스트 계획

- segment metadata 기본값 정규화
- lineage segment 정렬
- entry 병합 순서
- continuation state 생성
- threshold 판정
- roll-over 성공 / persist 실패 / preview-only 무시
- live ledger reset 시 committed link만 끊기는지
