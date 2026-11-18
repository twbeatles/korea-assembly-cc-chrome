# Modern Web Guidance 기반 개선 문서

대상 앱: 국회 AI 자막 추출기 (Chrome 확장, `popup` / `sidepanel` / `options` / `history` /
in-page 패널 / content-script).

참조: [Modern Web Guidance](https://developer.chrome.com/docs/modern-web-guidance?hl=ko)와
`modern-web-guidance` 스킬. `legacy-scan src --json`으로 결정적 레거시 패턴을 스캔하고,
`dialog` · `dark-mode` · `forms` · `accessibility` 가이드를 조회해 나머지를 수동 감사했다.

## 1. legacy-scan 결과

총 4건, 전부 `js` 가이드의 복사-정렬 규칙이었다.

| 파일                                           | 기존 코드                                    | 판단                |
| ---------------------------------------------- | -------------------------------------------- | ------------------- |
| `src/content/dom-probe.ts`                     | `[...candidates].sort(...)`                  | `toSorted()`로 교체 |
| `src/core/session-lineage.ts`                  | `[...sessions].sort(...)`                    | `toSorted()`로 교체 |
| `src/storage/session-store/entry-chunks.ts`    | `chunks.slice().sort(...)`                   | `toSorted()`로 교체 |
| `src/storage/session-store/lineage-helpers.ts` | `[...records].sort(...).slice(...).map(...)` | `toSorted()`로 교체 |

`toSorted()`는 ES2023 API라 `tsconfig.json`의 `lib`을 `ES2022`에서 `ES2023`으로 올렸다.
`target`은 `ES2022` 그대로라 빌드 출력은 변하지 않고, 런타임(Chrome 110+·Node 26)도 지원한다.

## 2. 수동 감사 발견 및 조치

### 2.1 다크 모드 (`dark-mode`)

- 현황: 5개 엔트리 HTML에 `color-scheme` 선언이 없고, 모든 CSS가 라이트 고정 팔레트였다.
  시스템 다크 모드에서 스크롤바·폼 컨트롤이 라이트로 남고, 흰 캔버스가 번쩍였다.
- 조치:
  - `popup.html` · `sidepanel.html` · `options.html` · `history.html` · `offscreen.html`에
    `<meta name="color-scheme" content="light dark">` 추가.
  - `popup.css` · `options.css` · `history.css`의 `:root`에 `color-scheme: light dark`
    선언 + `@media (prefers-color-scheme: dark)` 토큰/표면 오버라이드 추가.
- 제외: in-page 패널(`src/content/inpage-panel`)은 타사 중계 페이지 안에 주입되는 임베드 UI라
  라이트로 고정했다(`.host { color-scheme: light; }`). 시스템 설정과 무관하게 항상 같은 대비를
  보장하기 위한 컴포넌트 단위 고정이다.

### 2.2 파괴적 확인 다이얼로그 (`dialog` · `accessibility`)

- 현황: `src/shared/accessible-confirm.ts`가 커스텀 오버레이(`div`+수동 포커스 트랩)를 쓰고,
  파괴적 확인임에도 **확인(위험) 버튼에 초기 포커스**를 줬다. 오버레이에 스크롤 체이닝 방지 처리가
  없었다.
- 조치:
  - 초기 포커스를 안전 동작인 **취소 버튼**으로 변경.
  - 오버레이·다이얼로그에 `overscroll-behavior: contain` 추가(배경 페이지 스크롤 연쇄 방지).
    `history.css`의 `.confirm-dialog-overlay`도 동일 처리.
  - `Esc`/바깥 클릭 닫기·포커스 복원은 기존 동작 유지.
- 2차 개선: `history` 확인 UI를 네이티브 `<dialog>`로 마이그레이션 완료
  (`src/history/app/confirm-dialog.ts` 재작성: `showModal()` + `method="dialog"` 폼 +
  `closedby="any"`, `role`/`aria-modal` 미사용, `returnValue` 리셋).
  `Esc`·포커스 복원을 브라우저에 위임하고, `showModal` 미지원 환경은 `window.confirm`
  폴백으로 점진 향상한다. `history.css`의 미사용 오버레이 규칙은 제거하고
  `dialog.confirm-dialog` 리셋·`::backdrop`·다크모드 대응을 추가했다.
- content-script/인페이지 패널은 호스트 페이지 전체를 inert 하게 만들지 않기 위해 공유
  커스텀 오버레이(`src/shared/accessible-confirm.ts`)를 계속 쓴다.

### 2.3 폼 (`forms`)

- 현황 ①: 설정 화면 `SettingInputCard`의 입력에 `id`가 없어 `htmlFor` 연결이 비어 있었고,
  오류 문구가 `aria-describedby`로 연결되지 않았다. `options.css`가 `:focus`에
  `outline: none`을 쓰고 있었다.
- 조치 ①: 숫자 필드·파일명 입력에 `id="setting-<field>"`, 오류에 `id="setting-<field>-error"`를
  부여하고 `htmlFor`·`aria-describedby`로 연결. 입력 포커스 링을 `:focus-visible`로 전환.
- 현황 ②: 기록 화면 검색행의 태그/카테고리 입력이 `placeholder`만 있고 접근 가능한 이름이 없었다.
- 조치 ②: 두 입력에 `aria-label` 추가, 검색행을 `<search>`로 감쌈. 상태 메시지 영역에
  `role="status"`를 달아 비동기 결과를 스크린리더에 알린다.
- 2차 개선: 검증 타이밍을 가이드 방식으로 전환 완료. 입력 중에는 기존 오류만 지우고
  (`handleNumberDraftChange`), 검증은 `blur`(`handleNumberDraftBlur`)와 저장 시점에 한다.
  저장은 `NUMBER_FIELDS` 전체 드래프트 + 파일명 패턴을 재검증하는 최종 게이트로 막고,
  첫 번째 오류 필드로 포커스를 옮긴다. 파일명 입력도 동일 패턴(`onChange`에 지우기,
  `onBlur`에 검증)으로 맞췄다.

### 2.4 목록 시맨틱·토글 상태 (`accessibility`)

- `SessionListPanel`: `<aside>`에 `aria-label`, 목록을 `<ul>/<li>`, 선택 항목에 `aria-current`,
  페이징을 `<nav aria-label>`로 변경. 즐겨찾기 전용·중요 표시 토글 버튼에 `aria-pressed` 추가.

### 2.5 CSS 성능·모션 (`css` 범주 일반 원칙)

- `options.css` 버튼의 `transition: all`을 `background-color, box-shadow, transform`으로 한정.
- 기록 목록 `.session-item-row`에 `content-visibility: auto` +
  `contain-intrinsic-size: auto 76px` (페이지당 최대 200행 렌더 비용 완화).
- `options.css` · `history.css`에 `prefers-reduced-motion: reduce` 블록 추가
  (팝업에는 이미 있음).

## 3. 잔여 항목 스캔 결과

- `legacy-scan src --json` 재실행: 0건.
- 테이블(`responsive-table`): 자막 항목·세션 목록이 헤더 기반 표 데이터가 아니라 리스트
  시맨틱으로 충분해 미적용.
- 스크롤·리빌 애니메이션(`motion` 계열): 사용하는 애니메이션이 상태 점멸·접힘 전환뿐이라
  신규 도입 없이, 인페이지 패널 접힘 전환(`live.ts`)에 `prefers-reduced-motion` 가드만 추가.
- 인페이지 패널 상태 점멸 애니메이션은 기존 가드 유지.

## 4. 검증

- `npm run typecheck`
- `npx eslint` 변경 파일
- `npx vitest run` 관련 테스트: `session-lineage` · `dom-probe` · `session-store` ·
  `options-app` · `history-app` · `accessible-confirm` · `history-confirm-dialog` ·
  `modern-web-guidance`
- `npm run build`로 MV3 번들 확인
- 다크 모드는 OS 다크 모드에서 4개 화면을 육안 확인(자동화 미포함)
