# 코드베이스 감사 메모

업데이트 기준일: `2026-04-22`

## 1. 현재 판단

이 확장 프로그램은 `국회 의사중계 플레이어`에서 자막을 감지하고, `확정 자막`만 세션 단위로 저장/내보내기 하는 구조로 정리되어 있다. 최근 변경으로 저장소와 export 경로의 가장 큰 병목 둘은 이미 한 단계 완화됐다.

- 저장소는 세션 메타데이터와 `entries chunk` 를 분리 저장한다.
- 단일 세션 export 는 content/history 가 대형 본문을 직접 background 로 보내지 않고, `sessionId + 옵션`만 넘긴다.
- autosave 는 preview-only 변화마다 전체 세션을 다시 쓰지 않는다.
- 확장 패널은 `main/` 홈에서도 즉시 보이고, 실제 capture start 는 `main/player*` 플레이어에서만 허용된다.
- running capture 는 threshold 초과 시 자동으로 다음 segment 로 roll-over 한다.
- history 는 같은 lineage 의 세그먼트를 묶어 `연속 캡처 전체` 보기와 lineage export 를 지원한다.
- options diagnostics 는 현재 segment threshold 사용량과 포맷별 예상 export 크기를 보여준다.
- 큰 export 는 offscreen Blob chunk 경로를 우선 사용하고, 약 `2 MiB`를 넘는 payload 에 대해서는 무리한 data URL fallback 을 제한한다.

즉, 가장 급한 메모리 리스크와 운영 가시성 공백은 크게 줄었고, 이제 남은 과제는 `lineage UX polish` 와 `초대형 export 마지막 단계의 브라우저 제약` 쪽에 가깝다.

## 2. 강한 부분

- `content-script`, `session-store`, `history`, `background` 사이 책임 경계가 이전보다 명확하다.
- 장시간 캡처 중 저장 실패가 나더라도 fallback 저장소와 replay queue 경로가 있다.
- 대형 파일 관련 테스트가 이미 많고, build/typecheck/test 루틴이 안정적으로 돌아간다.
- 세션 저장/내보내기 정합성은 `committed entries only` 원칙으로 일관된다.

## 3. 남은 핵심 리스크

### 세그먼트 이후 UX

- 자동 segmentation 으로 세션이 여러 개 생기면, 사용자는 이것들을 `하나의 연속 캡처`로 보고 싶어질 가능성이 높다.
- 현재 history 는 lineage summary, segment 전환, `연속 캡처 전체 보기`, lineage export 까지 지원한다.
- 다만 list 쪽 grouping, lineage 수준 메모/즐겨찾기 정책, 더 강한 요약 표시는 아직 후속 여지가 있다.

### 히스토리/운영 가시성

- 현재 history 는 detail 기준 lineage 개념을 표시하고 전환할 수 있다.
- options diagnostics 는 threshold / 예상 export 규모를 바로 보여 준다.

### 초대형 단일 세션 export

- background export 로 message size 리스크는 줄었고, offscreen Blob chunk 경로와 bounded data URL fallback 으로 마지막 단계도 한 번 더 안전해졌다.
- 그래도 최종적으로는 브라우저 다운로드 정책과 blob lifecycle 한계는 남아 있다.

## 4. 우선순위

권장 우선순위는 아래 순서다.

1. lineage list/grouping polish
2. 아주 큰 export 에 대한 stream/offscreen 추가 보강
3. threshold preset/운영 프로파일 정리
4. chunk write 를 더 append-friendly 하게 최적화

이 순서인 이유:

- 1번은 segmented history의 가독성을 더 높인다.
- 2번은 장시간 세션을 실제로 파일로 가져갈 때의 마지막 리스크를 더 줄인다.
- 3번은 운영자가 threshold를 상황에 맞게 더 일관되게 다룰 수 있게 해준다.
- 4번은 가치가 있지만, 지금 구조에서는 체감도가 상대적으로 낮다.

## 5. 지금 바로 진행 가능한 상태

이번 정리로 step 1은 foundation 이 아니라 실제 phase 1 동작까지 들어갔다.

- 세션 모델은 `lineageId`, `segmentNumber` 메타데이터를 가진다.
- 저장소 정규화는 기존 세션에도 lineage 기본값을 채운다.
- store 에서 같은 lineage 의 segment 목록을 조회할 수 있다.
- runtime segmentation threshold helper 가 실제 roll-over에 연결됐다.
- 다음 segment state 생성과 live ledger reset 도 실제 동작에 연결됐다.

즉, 다음 실제 구현 slice 는 `초대형 export` 와 `운영 가시성` 쪽이다.

## 6. 다음 구현 slice 체크리스트

1. history list 에 lineage grouping summary 추가
2. threshold preset 또는 운영 모드 정의
3. 큰 export 의 stream/offscreen 추가 보강
4. 장시간 lineage 메타데이터 UX 정리

상세 설계는 [RUNTIME_SESSION_SEGMENTATION_PLAN.md](./RUNTIME_SESSION_SEGMENTATION_PLAN.md)에 정리했다.
