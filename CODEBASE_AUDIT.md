# 코드베이스 감사 메모

업데이트 기준일: `2026-04-28`

## 1. 현재 판단

이 확장 프로그램은 `국회 의사중계 플레이어`에서 자막을 감지하고, structured stable row 또는 보수 fallback 안정 관측을 통과한 `확정 자막`만 세션 단위로 저장/내보내기 하는 구조로 정리되어 있다. 최근 변경으로 저장소, export, fallback-only 캡처, SPA 전환, lineage UX의 큰 병목이 한 단계 더 완화됐다.

- 저장소는 세션 메타데이터와 `entries chunk` 를 분리 저장한다.
- 단일 세션 export 는 content/history 가 대형 본문을 직접 background 로 보내지 않고, `sessionId + 옵션`만 넘긴다.
- fallback-only 자막은 같은 normalized raw 가 2회 이상 또는 400ms 이상 안정적으로 관측된 뒤 committed fallback entry 로 저장된다.
- autosave 는 preview-only 변화마다 전체 세션을 다시 쓰지 않는다.
- 확장 패널은 `main` / `main/` 홈에서도 즉시 보이고, 실제 capture start 는 `main/player*` 플레이어에서만 허용된다.
- content script 는 SPA URL 전환을 감지해 capture URL 진입/이탈/교체 시 observer, polling, autostart 상태를 전환한다.
- running capture 는 segment preset/threshold 초과 시 자동으로 다음 segment 로 roll-over 한다.
- history 는 lineage summary 목록, segment 상세, `연속 캡처 전체` 보기, lineage export, 대용량 lineage 분할 저장을 지원한다.
- options diagnostics 는 opt-in `GET_DIAGNOSTICS_STATUS` 경로에서만 현재 segment threshold 사용량, row/filter/fallback commit diagnostics, 포맷별 예상 export 크기를 보여준다.
- 큰 export 는 offscreen Blob chunk 경로를 우선 사용하고, 약 `2 MiB`를 넘는 payload 에 대해서는 무리한 data URL fallback 을 제한한다.
- 전체 JSON 백업은 history page Blob URL 다운로드를 사용해 대형 본문을 service worker runtime message 로 보내지 않는다.

즉, 가장 급한 메모리 리스크와 운영 가시성 공백은 크게 줄었고, 이제 남은 과제는 실제 사이트 DOM 변화에 대한 selector profile 보강과 초대형 단일 export 마지막 단계의 브라우저 제약 쪽에 가깝다.

## 2. 강한 부분

- `content-script`, `session-store`, `history`, `background` 사이 책임 경계가 이전보다 명확하다.
- 장시간 캡처 중 저장 실패가 나더라도 fallback 저장소와 replay queue 경로가 있다.
- 대형 파일 관련 테스트가 이미 많고, build/typecheck/test 루틴이 안정적으로 돌아간다.
- 세션 저장/내보내기 정합성은 `committed entries only` 원칙으로 일관된다.

## 3. 남은 핵심 리스크

### 실제 사이트 DOM 변화 대응

- row key source 와 stable/unstable/filter diagnostics 가 추가됐지만, 실제 국회 사이트 DOM 이 바뀌면 selector 우선순위와 key 휴리스틱은 계속 조정해야 한다.
- generated key row 는 unstable 로 진단되므로, 진단 수치가 증가하면 selector/profile 보강의 신호로 볼 수 있다.

### 히스토리/운영 가시성

- 현재 history 는 lineage summary 기준 목록을 기본으로 보여 주고, star/pin/note/delete/export 를 lineage 전체 segment 에 적용한다.
- options diagnostics 는 threshold / row filter / fallback commit state / 예상 export 규모를 바로 보여 준다.

### 초대형 단일 세션 export

- background export 로 단일 세션/lineage message size 리스크는 줄었고, offscreen Blob chunk 경로와 bounded data URL fallback 으로 마지막 단계도 한 번 더 안전해졌다.
- 전체 라이브러리 JSON 백업은 page Blob 다운로드로 전환되어 service worker message size 리스크가 줄었다.
- 그래도 최종적으로는 브라우저 다운로드 정책과 blob lifecycle 한계는 남아 있다.

## 4. 우선순위

권장 우선순위는 아래 순서다.

1. 실제 국회 사이트 fixture 기반 selector/profile 보강
2. 아주 큰 단일 export 에 대한 stream/offscreen 추가 보강
3. lineage summary 표시 밀도와 검색 UX 다듬기
4. chunk write 를 더 append-friendly 하게 최적화

이 순서인 이유:

- 1번은 운영 중 DOM 변화에 따른 캡처 실패 리스크를 줄인다.
- 2번은 장시간 세션을 실제로 파일로 가져갈 때의 마지막 리스크를 더 줄인다.
- 3번은 장시간 회의 기록 관리의 반복 작업을 줄인다.
- 4번은 가치가 있지만, 지금 구조에서는 체감도가 상대적으로 낮다.

## 5. 지금 바로 진행 가능한 상태

이번 정리로 장시간 세션과 fallback-only 수집은 foundation 이 아니라 실제 동작까지 들어갔다.

- 세션 모델은 `lineageId`, `segmentNumber` 메타데이터를 가진다.
- 저장소 정규화와 IndexedDB schema `5` migration 은 기존 세션에도 lineage 기본값을 채운다.
- store 에서 같은 lineage 의 segment 목록을 `lineageId` index 로 조회할 수 있다.
- runtime segmentation threshold helper 가 실제 roll-over에 연결됐다.
- 다음 segment state 생성과 live ledger reset 도 실제 동작에 연결됐다.
- fallback-only 안정 관측, 본회의 full internal raw, lineage summary list, lineage metadata update/delete/export, split export, release check, extension smoke 가 구현됐다.

즉, 다음 실제 구현 slice 는 `실제 사이트 fixture 보강` 과 `초대형 단일 export` 쪽이다.

## 6. 다음 구현 slice 체크리스트

1. 실제 국회 본회의/위원회 DOM fixture 를 extension smoke 에 추가
2. selector/key source diagnostics 를 기준으로 profile 우선순위 보정
3. 초대형 단일 export 의 추가 streaming 전략 검토
4. lineage summary 검색/필터 UI polish
