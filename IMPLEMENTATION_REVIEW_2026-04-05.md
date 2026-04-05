# 기능 구현 점검 보고서 (2026-04-05)

이 문서는 `README.md`, `CLAUDE.md`, 기존 점검 문서들, 그리고 현재 HEAD 기준 실제 구현 코드를 다시 대조해 기능 구현 관점의 잠재 리스크와 추가 권장 항목을 정리한 보고서입니다.

## 점검 기준

- 참조 문서:
  - `README.md`
  - `CLAUDE.md`
  - `CODEBASE_AUDIT.md`
  - `IMPLEMENTATION_REVIEW_2026-04-03.md`
- 주요 확인 범위:
  - `src/content/*`
  - `src/storage/*`
  - `src/history/*`
  - `src/options/*`
  - `src/popup/*`

## 자동 검증 결과

아래 기본 검증은 모두 통과했습니다.

- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run build`

추가 메모:

- `vitest` 실행 중 `session-store` 관련 `stderr` 로그는 실제 실패가 아니라, transient failure/fallback 복구 시나리오를 의도적으로 검증하는 테스트 출력이었습니다.
- 이번 점검은 정적 코드 리뷰 + 로컬 검증 기준이며, 실제 국회 생중계 페이지를 대상으로 한 수동 E2E 확인까지는 포함하지 않았습니다.

## 현재 판단 요약

- 즉시 배포를 막을 정도의 치명 이슈는 이번 점검에서 보이지 않았습니다.
- 기존 리뷰에서 지적되었던 `committee` 파싱, prepared snapshot 저장 조건, subtitle visibility 공통화 같은 핵심 항목은 현재 코드에서 상당 부분 정리된 상태입니다.
- 다만 아래 항목들은 테스트가 통과하더라도, 실제 사이트 DOM 변화나 대용량 데이터 운영에서 문제로 번질 수 있는 잠재 리스크로 보입니다.

## 잠재 이슈

### M-1. 숨겨진 DOM이나 비활성 자막 레이어의 텍스트를 fallback 경로가 읽을 여지가 있습니다

- 근거 코드:
  - `src/content/subtitle-rows.ts:186`
  - `src/content/subtitle-dom.ts:112-113`
  - `src/content/injected-observer.ts:231-247`
  - `src/content/injected-observer.ts:282-285`
  - `src/content/dom-probe.ts:84`

관찰:

- row 추출과 container fallback 모두 `innerText || textContent`를 사용합니다.
- 실제 DOM probe / observer fallback 경로에서는 컨테이너 노드 자체의 visibility를 다시 확인하지 않고 읽습니다.
- observer target 선택도 첫 매칭 노드를 그대로 잡기 때문에, 보이지 않는 컨테이너나 stale subtitle DOM이 먼저 잡히면 그쪽을 기준으로 감시를 시작할 수 있습니다.
- 현재 `isElementActuallyVisible()` 유틸은 존재하고 테스트도 있지만, 실제 fallback 읽기 경로 전체에 일관되게 적용되어 있지는 않습니다.

잠재 영향:

- 사이트가 숨김용 자막 컨테이너, offscreen 템플릿, 이전 자막 DOM을 남겨두는 식으로 바뀌면 실제로는 보이지 않는 텍스트를 수집할 가능성이 있습니다.
- generic selector(`.subtitle_area`, `.ai_subtitle`, `[class*='subtitle']`)가 포함되어 있어 DOM 변경 시 오탐 여지가 더 커집니다.

권장:

- container fallback과 observer target selection에 visibility guard를 추가하는 편이 안전합니다.
- `readObservedSubtitleRows()`도 필요하면 visible row 기준 필터를 둘지 검토하는 것이 좋습니다.
- 회귀 테스트로 "hidden container는 probe/fallback 대상이 아니어야 함" 케이스를 추가하는 것을 권장합니다.

### M-2. 히스토리 페이지네이션이 fallback 세션 1건만 있어도 전체 라이브러리 풀스캔으로 전환됩니다

- 문서 기대:
  - `README.md:60` — "history는 store-level 페이지네이션을 사용"
- 근거 코드:
  - `src/storage/session-store/operations.ts:264-286`
  - `src/storage/session-store/operations.ts:289-314`
  - `src/storage/session-store/operations.ts:105`
  - `src/history/components/HistoryPage.tsx:199-204`
  - `src/history/components/HistoryPage.tsx:325`

관찰:

- `listSessionsPage()`는 fallback session id가 하나라도 있으면 IndexedDB page 조회를 쓰지 않고 `listAllSessions()`로 전체 세션을 메모리로 올린 뒤 paginate 합니다.
- `searchSessionsPage()`도 항상 `listAllSessions()` 기반 전체 스캔입니다.
- history 화면은 `globalSearchQuery`가 바뀔 때마다 search effect가 바로 재실행되고, 별도 debounce가 없습니다.

잠재 영향:

- transient IndexedDB 실패 후 fallback 레코드가 잠깐이라도 남아 있으면, "store-level 페이지네이션"의 이점이 사라집니다.
- 저장 세션 수가 커질수록 history 진입, 검색, 새로고침, 즐겨찾기 필터 전환 시 체감 지연이 커질 수 있습니다.
- 긴 회의 기록을 많이 쌓아두는 실제 사용 패턴과 맞물리면, 이 부분이 가장 먼저 운영 병목이 될 가능성이 있습니다.

권장:

- fallback 레코드가 있어도 현재 페이지 범위만 병합하는 방식으로 개선하는 것이 좋습니다.
- 전체 기록 검색에는 최소한 250~300ms debounce를 두는 편이 안전합니다.
- 중장기적으로는 lightweight search index 또는 preview-only search payload 분리를 검토할 만합니다.

### L-1. noise filter는 여전히 한글/영문 외 자막을 의미 없는 텍스트로 처리합니다

- 근거 코드:
  - `src/core/noise-filter.ts:3-4`
  - `src/core/noise-filter.ts:53-71`
  - `tests/noise-filter.test.ts:30-31`
- 관련 문서:
  - `README.md:51`
  - `README.md:303`
  - `src/options/App.tsx:744`

관찰:

- 현재 의미 있는 언어 문자 판정은 `/[가-힣A-Za-z]/` 기준입니다.
- 테스트에도 `字幕`가 noise로 처리되는 동작이 고정되어 있습니다.
- 문서와 옵션에 이 제한이 적혀 있기는 하지만, 실제 기능 관점에서는 "지원 언어 범위가 좁다"는 제약이 계속 남아 있습니다.

잠재 영향:

- 향후 다국어 자막이나 외국어 회의 페이지를 다루게 되면 저장 전에 자동 누락될 수 있습니다.
- 사용자는 "수집 실패"로 이해하기 쉽고, 디버깅 포인트도 DOM 쪽보다 filter 정책 쪽에 숨어 있게 됩니다.

권장:

- 제품 정책이 한국어/영어 중심이라면 지금 수준의 문서화는 유지하되, diagnostics에도 filter drop 이유를 더 드러내는 편이 좋습니다.
- 정책 확장이 가능하다면 CJK 등 Unicode 범위 확장을 옵션화하는 방향을 검토할 수 있습니다.

## 추가 권장 항목

### A-1. selector profile은 도입됐지만 아직 실질적인 분화가 약합니다

- 근거 코드:
  - `src/content/subtitle-dom.ts:21-39`
  - `src/shared/constants.ts:19-28`
- 관련 문서:
  - `CLAUDE.md:255`
  - `README.md:311`

현재 `default`, `committee`, `plenary` profile 구조는 들어와 있지만, 실제 selector set은 대부분 동일하고 plenary의 `preserveFullContainerText`만 차이가 납니다. 향후 DOM 구조가 바뀌면 이 확장 포인트를 더 적극적으로 쓰는 편이 유지보수에 유리합니다.

### A-2. 실제 MV3 런타임 기준 E2E / 스모크 테스트가 있으면 회귀 방지력이 크게 올라갑니다

- 관련 문서:
  - `README.md:313`

현재 테스트 커버리지는 좋지만 대부분 unit/component 레벨입니다. 실제 브라우저에서 "자막 레이어 활성화 -> observer/fallback 수집 -> panel 표시 -> 저장/export" 한 줄기만 있어도 DOM 변경 리스크를 훨씬 빨리 잡을 수 있습니다.

### A-3. 대용량 JSON import/export는 진행률과 취소 UX가 있으면 운영 안정성이 올라갑니다

- 근거 코드:
  - `src/storage/session-store/operations.ts:228-239`
  - `src/storage/session-store/operations.ts:378-430`
- 관련 문서:
  - `README.md:302`

현재 구현은 기능적으로는 충분하지만, 전체 백업/가져오기가 커질수록 사용자는 "멈춘 것처럼 보이는 구간"을 경험할 수 있습니다. 진행률, 취소, 단계별 피드백이 있으면 실제 사용성 차이가 큽니다.

### A-4. 전체 기록 검색은 동작하지만 하이라이트 / relevance ranking은 아직 추가 가치가 큽니다

- 관련 문서:
  - `README.md:309`

전체 기록 검색은 이미 구현되어 있지만, 결과 snippet 하이라이트와 relevance 정렬이 들어가면 기록 수가 많아질수록 탐색 효율이 좋아집니다. 기능 완성도보다는 "쌓인 데이터를 다시 찾는 경험"을 올리는 쪽의 투자 포인트입니다.

## 우선순위 제안

1. hidden/stale subtitle DOM 오탐 가능성 보강
2. history의 fallback/검색 경로 성능 구조 보강
3. selector profile 확장 + 실제 브라우저 스모크 테스트 추가
4. 대용량 import/export UX와 검색 고도화

## 결론

현재 코드는 기본 품질 게이트를 안정적으로 통과하고 있고, 이전 리뷰에서 문제였던 핵심 저장/자동활성화 정합성도 꽤 잘 정리되어 있습니다. 지금 시점의 핵심 리스크는 "자막 DOM이 예상과 다르게 바뀌는 경우"와 "기록이 많이 쌓였을 때 history/backup이 전체 스캔 구조로 무거워지는 경우"에 집중되어 있습니다.

즉, 지금 필요한 다음 하드닝은 새 기능을 급히 늘리기보다:

- fallback 경로 visibility 정합성 강화
- history 대용량 경로 최적화
- 실제 브라우저 기준 회귀 테스트 추가

이 세 가지에 우선순위를 두는 편이 가장 효과적입니다.
