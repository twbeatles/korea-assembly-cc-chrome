# 기능 구현 점검 보고서 (2026-04-03)

이 문서는 `CLAUDE.md`, `README.md`, 기존 `CODEBASE_AUDIT.md`, 그리고 현재 구현 코드를 다시 대조해 기능 구현 관점의 잠재 리스크와 추가 권장 항목을 정리한 보고서입니다.

## 후속 구현 상태 메모 (2026-04-03)

- 이 문서는 점검 시점의 리뷰 기록을 보존하기 위한 문서입니다.
- 이후 후속 구현으로 `위원회명 파싱 보정`, `subtitle visibility 공통 helper`, `selector profile`, `fallback migration cache`, `history 전체 transcript 검색`, `content/history/storage 구조 분할 리팩토링`이 반영되었습니다.
- 현재 구현 경로는 `src/content/content-script.ts -> src/content/bootstrap/bootstrap-content-script.ts`, `src/history/App.tsx -> src/history/components/HistoryPage.tsx`, `src/storage/session-store.ts -> src/storage/session-store/operations.ts` 기준으로 읽는 것이 맞습니다.
- 아래 line/path reference와 권장 항목 중 일부는 “점검 당시 관찰”로 남겨 두며, 현재 상태 판단은 본 메모와 최신 코드 기준으로 갱신해서 읽어야 합니다.

## 점검 기준

- 기준 문서: `CLAUDE.md`, `README.md`
- 주요 점검 영역:
  - `src/content/*`
  - `src/core/*`
  - `src/storage/*`
  - `src/history/*`
  - `src/options/*`
- 실행 확인:
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test`
  - `npm run build`

## 현재 판단 요약

- 자동 검증(`lint`, `typecheck`, `test`, `build`)은 모두 통과했습니다.
- 즉시 배포를 막을 정도의 명확한 치명 이슈는 이번 점검에서는 보이지 않았습니다.
- 다만 아래 항목들은 "테스트는 통과하지만 실제 운영/사용자 입력/사이트 DOM 변화에서 문제로 번질 수 있는 부분"이라서 우선순위를 두고 손보는 편이 안전합니다.

## 잠재 이슈

### 1. 위원회명 추출 로직이 제목의 일반 하이픈까지 잘라낼 수 있음

- 위치: `src/content/content-script.ts:284-285`
- 관련 영향 지점:
  - `src/content/content-script.ts:1451`
  - `src/content/content-script.ts:1896`
  - `src/core/timeline.ts:76-91`

현재 구현:

```ts
function deriveCommitteeName(title: string): string {
  return title.replace(/\s*[-|].*$/, "").trim();
}
```

문제:

- `-` 또는 `|` 뒤를 전부 제거하는 방식이라, 사이트 suffix 제거 의도와 무관한 일반 제목도 잘릴 수 있습니다.
- 예를 들어 `행정안전위원회 2026-03-23 전체회의` 같은 제목은 날짜의 `-`에서 잘려 `행정안전위원회 2026`처럼 축약될 수 있습니다.
- 이 값은 세션 메타데이터와 `{committee}` 파일명 치환에 같이 쓰이므로 기록 목록, export 파일명, JSON 백업 메타 모두 왜곡될 수 있습니다.

권장:

- 사이트 suffix(`| 국회TV`, `- 국회방송` 등)처럼 실제로 제거해야 하는 패턴만 명시적으로 제거하세요.
- 최소한 날짜 패턴(`YYYY-MM-DD`)과 회차 표기처럼 일반 제목에 등장하는 `-`는 보존해야 합니다.
- 이 로직 전용 테스트를 추가하는 것이 좋습니다. 현재 테스트는 `buildExportFilename`은 검증하지만 title -> committee 파싱 자체는 직접 검증하지 않습니다.

### 2. noise filter가 한글/영문 외 언어를 전부 noise로 간주함

- 위치:
  - `src/core/noise-filter.ts:3-15`
  - `src/core/noise-filter.ts:52-68`
- 테스트 근거:
  - `tests/noise-filter.test.ts:29-32`

현재 구현은 언어 문자를 아래처럼 정의합니다.

```ts
const LANGUAGE_RE = /[가-힣A-Za-z]/;
```

문제:

- 중국어, 일본어, 기타 비한글/비영문 문자가 들어오면 실제 자막이어도 `isNoiseOnly = true`로 처리됩니다.
- 이 동작은 테스트에도 고정돼 있어서 우연한 실수가 아니라 현재 정책에 가깝습니다.
- 하지만 `README.md`와 사용자 노출 기능 설명에는 이 제한이 거의 드러나지 않아, 실제로는 "왜 자막이 저장되지 않는지"를 알기 어려운 silent failure가 됩니다.

권장:

- 제품 정책이 "한국어/영어만 지원"이라면 options/README/스토어 문구에 명확히 적어 두는 편이 안전합니다.
- 정책이 아니라 구현 한계라면 Unicode 문자 범위를 넓히거나, 최소한 CJK 계열은 별도 허용 여부를 검토해야 합니다.
- 이 항목은 기능 버그이자 제품 정책 문서화 부족 문제라 중간 우선순위로 보는 편이 맞습니다.

### 3. 자막 레이어 가시성 판정이 약해서 투명/비노출 상태를 visible로 오인할 수 있음

- 위치:
  - `src/content/subtitle-layer.ts:29-35`
  - `src/content/injected-observer.ts:89-95`
  - `src/content/content-script.ts:1045-1052`

현재 가시성 판정:

```ts
const style = window.getComputedStyle(element);
return style.display !== "none" && style.visibility !== "hidden";
```

문제:

- `opacity: 0`, `hidden` 속성, 실제 크기 0, 스크립트상만 남아 있는 비활성 레이어 같은 경우를 걸러내지 못합니다.
- 그 결과 자동 활성화 성공 판단(`visible && (hasText || controlActive)`)의 전제인 `visible` 자체가 너무 느슨해질 수 있습니다.
- 같은 로직이 page world observer 쪽에도 중복되어 있어, 한쪽만 보정하면 다시 어긋날 여지가 있습니다.

권장:

- 가시성 판정을 공통 유틸로 모으고 `hidden`, `opacity: 0`, 필요 시 `getBoundingClientRect()` 기반 최소 크기 체크까지 포함하는 쪽이 안전합니다.
- 최소한 `subtitle-layer.test.ts`에 "투명하지만 DOM에는 존재하는 레이어" 케이스를 추가하는 게 좋습니다.

### 4. fallback 마이그레이션 체크가 fallback CRUD마다 반복되어 저장소 저하 상황에서 오버헤드가 커질 수 있음

- 위치:
  - `src/storage/session-store.ts:526-562`
  - `src/storage/session-store.ts:570`
  - `src/storage/session-store.ts:628`
  - `src/storage/session-store.ts:648`

문제:

- `migrateLegacyChromeFallbackIfNeeded()`가 fallback read/write/delete 경로에서 반복 호출됩니다.
- 이 함수는 매번 `chrome.storage.local.get([FALLBACK_INDEX_STORAGE_KEY, LEGACY_FALLBACK_STORAGE_KEY])`를 수행합니다.
- 즉, IndexedDB가 흔들려 fallback 경로를 자주 타는 상황일수록 같은 마이그레이션 확인 I/O를 계속 반복하게 됩니다.

영향:

- 즉시 오동작을 만드는 버그는 아니지만, "저장소가 불안정한 순간"에 추가 I/O를 만드는 구조라 회복성 측면에서는 불리합니다.

권장:

- 런타임 메모리 플래그나 완료 sentinel을 둬서 마이그레이션 완료 여부를 캐시하세요.
- 특히 장시간 세션 + autosave + fallback write 조합에서 효과가 있습니다.

## 추가 권장 항목

### 1. 전체 기록 통합 검색은 아직 부재

- 근거:
  - `README.md` 향후 계획에 `전체 기록을 가로지르는 통합 검색`이 남아 있음
  - 실제 구현은 `src/history/App.tsx:148-150`에서 선택된 단일 세션의 entry만 검색함

의미:

- 현재 history 검색은 "선택한 세션 안 검색"이고, 기록 라이브러리 전체를 가로지르는 검색은 아직 없습니다.
- 세션 수가 쌓일수록 실제 사용성 차이가 커지는 기능이라 추가 우선순위를 높게 둘 만합니다.

### 2. DOM 변화 대응용 selector profile 체계가 있으면 유지보수성이 좋아짐

- 근거:
  - `README.md` 향후 계획에 `DOM 구조 변화에 대한 selector profile 추가`가 남아 있음
  - 현재 기본 selector 우선순위는 `src/content/dom-probe.ts:22-31`에 하드코딩되어 있음

의미:

- 사이트 구조가 바뀌면 현재는 코드 수정과 재배포가 거의 필수입니다.
- URL 패턴, 회의 타입, 프레임 구조별 selector profile을 분리하면 장애 대응 속도가 좋아집니다.

### 3. 실제 브라우저 캡처 흐름을 검증하는 E2E/스모크 테스트가 필요

- 근거:
  - `README.md` 향후 계획에 `브라우저 E2E 테스트 추가`가 남아 있음
  - 현재 테스트는 unit/component 수준이 강하고, 실제 MV3 런타임 + 실제 페이지 DOM 캡처 smoke는 없습니다

의미:

- 이번 점검에서도 자동 테스트는 모두 통과했지만, 위원회명 파싱이나 DOM visibility 같은 항목은 unit test만으로 놓치기 쉽습니다.
- 최소한 "실제 저장된 HTML fixture + content script probe" 또는 "브라우저에서 capture start -> live update -> save/export" 스모크 한 줄기는 필요합니다.

## 권장 우선순위

1. `deriveCommitteeName()` 제목 파싱 보정 + 회귀 테스트 추가
2. noise filter의 지원 언어 범위 확정
3. subtitle layer 가시성 판정 공통화 및 테스트 보강
4. fallback 마이그레이션 완료 캐시
5. 통합 검색 / selector profile / E2E 스모크를 다음 기능 하드닝 묶음으로 진행

## 결론

현재 코드는 기본 품질 게이트는 통과하고 있고, 기존 감사 문서에서 이미 잡혔던 주요 저장/자동활성화 문제도 대부분 정리된 상태입니다. 지금 시점의 핵심 리스크는 "테스트는 통과하지만 실제 제목 패턴, 실제 DOM visibility, 실제 다국어 자막, 저장소 저하 상황에서 드러나는 경계 조건" 쪽에 몰려 있습니다.
