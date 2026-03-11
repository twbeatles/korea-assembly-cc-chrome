# 국회 AI 자막 추출기 Chrome Extension

<p align="center">
  <img src="public/icons/icon128.png" alt="국회 AI 자막 추출기 아이콘" width="128" />
</p>

기존 `PyQt6 + Selenium` 데스크톱 앱을 `Chrome Extension (Manifest V3) + TypeScript + React + Vite` 구조로 재설계한 저장소입니다. 목표는 국회 의사중계/생중계 페이지에서 AI 자막을 실시간으로 수집하고, 페이지 오른쪽 패널에서 바로 보여 주며, 모은 내용을 `TXT / SRT / VTT / JSON`으로 저장하는 최소 실용 버전을 제공하는 것입니다.

## 왜 데스크톱 앱에서 크롬 확장으로 바꿨나

Selenium 기반 데스크톱 앱은 브라우저를 간접 제어해야 해서 `0.2초 폴링`, WebDriver 상태 불안정, 데스크톱 GUI/스레드 수명주기 관리 비용이 컸습니다. 이번 전환에서는 브라우저 DOM에 직접 접근하는 MV3 확장 구조로 바꿔서 `MutationObserver 우선 + polling fallback`, popup 종료와 무관한 content script 수집, IndexedDB 기반 세션 저장으로 구조를 단순화했습니다.

## 기술 선택

- 빌드 도구: `Vite + @crxjs/vite-plugin`
- 언어: `TypeScript`
- UI: `React`
- 스타일링: 페이지별 scoped CSS 파일
- 테스트: `Vitest`
- 린트/포맷: `ESLint + Prettier`

`Vite`를 선택한 이유는 popup/options/history 같은 multi-entry HTML 제어가 쉽고, MV3 manifest를 직접 관리하면서도 순수 TypeScript 모듈 테스트와 빌드 구성을 간결하게 유지할 수 있기 때문입니다.

## 주요 기능

- 국회 의사중계 페이지의 AI 자막 실시간 추출
- `실시간 내용 / 화면 자막` 2단 표시
- `MutationObserver` 우선 + polling fallback
- `.smi_word` nodeKey + framePath 기반 live row ledger 추적, 같은 row 제자리 보정, 컨테이너 fallback, 접근 가능한 iframe/frame 순회
- `normalized capture event -> live ledger -> preview / normalize / gate`
- 글로벌 히스토리 + `rfind` suffix 기반 증분 추출
- keepalive 기반 마지막 자막 `endTime` 갱신
- `subtitle_reset` 처리
- 저장된 기록 관리
- `TXT / SRT / VTT / JSON` 내보내기
- 사이트 안 우측 패널에서 실시간 자막 확인
- 수집 시작 시 AI 자막 레이어 자동 활성화 시도
- 페이지 패널 / history에서 최근 `N`줄 복사
- `autoScroll`, 중복 차단 최소 길이, noise filter 토글 등 옵션 반영
- popup 보조 화면
- history 기록 내부 검색 / 복사
- 실행 중 자동 저장 상태 표시 및 설정
- 페이지 패널 / options / history UI
- **크롬 확장프로그램 전용 아이콘 세트 적용(16, 32, 48, 128px)**
- 최소 단위 테스트

## 자막 및 내보내기 정합성

- SRT는 세션 시작 시각 기준 상대 cue time을 `HH:MM:SS,mmm` 형식으로 출력합니다
- VTT는 세션 시작 시각 기준 상대 cue time을 `HH:MM:SS.mmm` 형식으로 출력합니다
- JSON은 세션 전체 복원을 위해 `id`, `version`, `sourceUrl`, `startedAt`, `endedAt`, `entries`를 항상 포함합니다
- 중복 문장은 실시간 수집 단계에서 먼저 차단하고, export 정규화는 마지막 안전망으로만 한 번 더 적용합니다
- 동일 raw가 반복되는 구간은 keepalive로 마지막 entry의 `endTime`만 연장합니다

## 1차 범위

- 이미 열린 `https://assembly.webcast.go.kr/*` 페이지에서 자막 추출
- 페이지 오른쪽 패널에서 시작 / 중지 / 저장 / 파일 저장
- options에서 수집 설정 조정
- history에서 저장된 기록 목록, 삭제, 재열기, 파일 저장, 기록 내부 검색 / 복사

## 제외 범위

- PyQt6 GUI
- Selenium / WebDriver
- SQLite 직접 운용
- DOCX / HWP / RTF
- 데스크톱 병합 UI
- 데스크톱 단축키 체계
- 고급 preset / xcode -> xcgcd 자동 보완 UX
- 영상 캡처
- 중요 표시 / 발언자 편집

## 저장소 구조

```text
manifest.json
src/
  background/
  content/
  core/
  history/
  options/
  popup/
  shared/
  storage/
tests/
legacy/python-desktop/
```

기존 Python 데스크톱 코드, 알고리즘 분석 문서, 운영 메모는 `legacy/python-desktop/` 아래로 이동했습니다. 기존 의미론을 확인하려면 다음 문서를 참고하세요.

- `DEPLOYMENT.md`
- `CLAUDE.md`
- `GEMINI.md`
- `legacy/python-desktop/PIPELINE_LOCK.md`
- `legacy/python-desktop/ALGORITHM_ANALYSIS.md`
- `legacy/python-desktop/CLAUDE.md`

## 설치 방법

### 1. 의존성 설치

```bash
npm install
```

### 2. 개발 서버

```bash
npm run dev
```

`dev` 스크립트는 page-world observer 번들(`public/injected-observer.js`)을 먼저 생성한 뒤 Vite를 실행합니다.

### 3. 테스트

```bash
npm run test
```

정적 점검까지 포함한 기본 검증은 아래 세 명령을 기준으로 합니다.

```bash
npm run lint
npm run test
npm run build
```

### 4. 빌드

```bash
npm run build
```

빌드 결과물은 `dist/`에 생성됩니다.

## 크롬에서 unpacked extension 로드하기

1. `npm run build`
2. Chrome 주소창에 `chrome://extensions` 입력
3. 우측 상단 `개발자 모드` 활성화
4. 좌측 상단 `압축해제된 확장 프로그램을 로드합니다(Load unpacked)` 버튼 클릭
5. 저장소의 `dist/` 폴더 선택
6. 확장프로그램 툴바에 새롭게 추가된 **국회 로고+CC(자막)** 아이콘이 표시되는지 확인
7. 브라우저 우측 상단의 퍼즐 조각 아이콘 확장 프로그램 목록에서 `국회 AI 자막 추출기`를 핀 고정
8. 국회 의사중계 페이지(`https://assembly.webcast.go.kr/*`)를 열고 새로고침하면 오른쪽에 패널이 자동으로 나타납니다.

## 사용 방법

1. `https://assembly.webcast.go.kr/*` 페이지를 연다
2. 페이지 오른쪽의 `국회 자막 도우미` 패널을 확인한다
3. `자막 모으기`를 눌러 수집을 시작한다
4. 확장은 `AI 자막보기` 레이어를 자동으로 열려고 시도하며, 실패하면 패널 notice 로 수동 클릭 안내를 표시한다
5. `실시간 내용`은 패널 상단의 큰 미리보기 영역에서 먼저 확인하고, 바로 아래 `화면 자막`에서 지금 화면에 보이는 줄을 본다
6. 필요하면 패널의 `저장 / 내보내기` 버튼으로 `텍스트(TXT) / 자막(SRT) / 웹자막(VTT) / 기록(JSON)` 저장을 실행한다
7. 필요하면 페이지 패널 또는 history에서 `최근 N줄 복사`를 실행한다
8. `멈추기`를 누르면 수집이 끝나고 저장소 fallback 정책에 따라 정지 상태로 저장된다
9. 브라우저/확장을 다시 시작하면 남아 있던 `running` 세션은 자동으로 `stopped`로 정리된다
10. 확장 아이콘 popup은 `페이지 패널 열기`, `저장된 기록`, `환경 설정`을 빠르게 여는 보조 화면으로 사용한다

주의:
- 수집 중 페이지를 이동하거나 새로고침하면 브라우저가 경고를 표시합니다.
- 탭이 숨겨지거나 페이지를 떠날 때는 현재까지의 running/stopped 스냅샷을 background에 넘겨 자동 저장을 시도합니다.

## 권한 설명

- `storage`: options 저장, lightweight state 저장
- `downloads`: TXT/SRT/VTT/JSON 파일 다운로드
- `offscreen`: 대용량 export용 Blob URL 생성
- `activeTab`: 현재 탭 상태 조회
- `scripting`: MV3 런타임 보조 권한
- `host_permissions: https://assembly.webcast.go.kr/*`
  국회 의사중계 도메인만 대상으로 제한합니다

## 동작 구조

### content script

- 현재 탭에서 세션 상태를 보유합니다
- popup이 닫혀도 수집은 계속됩니다
- top frame에 우측 패널을 삽입해 현재 상태를 바로 보여 줍니다
- page-world `MutationObserver`, local polling, top-frame fallback을 모두 같은 `normalized capture event` 형태로 파이프라인에 전달합니다
- top frame에서는 `framePath + nodeKey` 기준 live row ledger를 유지하고, 같은 row 보정은 live view와 마지막 entry를 제자리 갱신합니다
- 새 row는 바로 append하지 않고 carry-over trim과 글로벌 히스토리 비교를 거쳐 실제 신규 delta만 확정합니다
- 수집 시작 시 page function 호출/버튼 클릭을 통해 AI 자막 레이어 활성화를 먼저 시도합니다

### injected observer

- page context에서 DOM 변화를 감시합니다
- `window.postMessage`로 `subtitle:update`, `subtitle:reset`, `subtitle:health`를 브리지합니다
- `subtitle:update`에는 raw preview 외에 `.smi_word` row 메타도 함께 실립니다
- 같은 `nodeKey`의 텍스트가 보정되면 새 key만 보내는 대신 현재 row 스냅샷 전체를 다시 보내 제자리 갱신을 가능하게 합니다

### pipeline

- `normalized capture event -> live reconcile -> normalize -> preview gate -> history/rfind suffix -> noise filter -> merge/add`
- structured row 가 안정적으로 잡히면 row별 baseline과 글로벌 history를 함께 써서 commit/update를 분리하고, 아니면 raw/container fallback으로 내려갑니다
- `confirmedCompact`, `trailingSuffix`, history anchor, overlap fallback, soft resync 의미론을 유지합니다
- recent compact tail 기반 중복 차단
- export 정규화는 마지막 안전망으로만 exact carry-over duplicate 를 한 번 더 정리합니다
- keepalive / reset / finalize 처리

### storage

- 세션 본문은 `IndexedDB`를 우선 사용합니다
- `IndexedDB`가 실패하면 `chrome.storage.local` per-session fallback을 사용합니다
- 두 저장소가 모두 실패하는 극단적 상황에서는 현재 런타임 동안 메모리 fallback을 유지합니다
- 설정은 `chrome.storage.local`
- 실행 중 autosave는 옵션에서 켜고 끌 수 있으며, 중지 시 최종 저장은 항상 유지됩니다
- 브라우저/확장 cold start 시 남아 있던 `running` 세션은 `stopped`로 자동 정리됩니다

### background

- offscreen Blob 우선 + data URL fallback 다운로드 처리
- history/options 페이지 열기
- content script 준비 여부 확인
- 이미 열려 있던 탭에는 필요 시 content script 재주입 시도
- frame forwarding nonce 발급

## 알려진 한계

- 국회 사이트 DOM 구조가 바뀌면 selector 우선순위와 fallback 성능이 달라질 수 있습니다
- cross-origin frame 내부 DOM은 브라우저 보안 정책 때문에 직접 순회하지 못할 수 있습니다
- 일부 페이지는 observer보다 polling fallback 의존도가 높을 수 있습니다
- `xcode -> xcgcd` 자동 보완 흐름은 이번 1차 범위에 포함하지 않았습니다
- 확장 설치 전에 열려 있던 탭은 재주입으로 복구를 시도하지만, 탭 상태에 따라 새로고침이 필요할 수 있습니다
- 브라우저 저장소가 모두 실패하면 세션 persistence는 현재 탭 런타임 범위로 제한됩니다
- 매우 큰 export는 Blob 경로를 우선 사용하지만, 브라우저 정책에 따라 data URL fallback으로 내려갈 수 있습니다

## 향후 계획

- 페이지/위원회 preset 관리
- DOM 구조 변화에 대한 selector profile 추가
- reconnect / restore robustness 강화
- session detail 검색과 부분 export
- 영상 캡처
- 중요 표시 / 발언자 편집
- 브라우저 E2E 테스트 추가

## 스토어 배포 (Publishing) 가이드

크롬 웹스토어에 정식 출시하기 위해서는 다음 과정을 거칩니다:

1. **프로덕션 빌드**: `npm run build` 명령을 통해 `dist/` 디렉터리에 배포용 에셋을 생성합니다. (아이콘 등 에셋 포함)
2. **압축(Zip)**: 생성된 `dist/` 폴더 내부의 모든 파일(디렉터리 포함)을 `extension.zip` 형태로 압축합니다. 폴더 자체를 압축하지 않고 내부 에셋들을 압축해야 합니다.
3. **스토어 등록**: 
   - [Chrome 웹 스토어 개발자 대시보드](https://chrome.google.com/webstore/devconsole)에 로그인합니다.
   - 우측 상단 `새 항목(New Item)`을 클릭하고 `extension.zip`을 업로드합니다.
4. **리뷰 요청**: 정보(설명, 스토어 아이콘, 스크린샷 등)를 기입한 뒤 검토(Review)를 요청합니다.

## 검증 기준

현재 기준 기본 검증은 아래 세 명령입니다.

```bash
npm run lint
npm run test
npm run build
```

## 2026-03-11 Sync Update

This section is the current source-of-truth for the latest engineering updates.

- UI/UX hardening completed:
  - Added confirmation guard for destructive actions (history delete, clear session).
  - Added responsive breakpoints in history layout for narrow viewports.
  - Added `aria-live`/status semantics for live preview, live list, and notices.
  - Added popup auto-reconnect with exponential backoff.
- Settings UX consistency completed:
  - Option input minimum values now match sanitization constraints.
  - Save/reset in options now include explicit error handling.
- Export consistency completed:
  - History export now respects `filenamePattern` settings.
- Build pipeline baseline:
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:coverage`
  - `npm run build`
  - `npm run verify` (full pipeline)
- Known deferred item (intentionally not changed in this cycle):
  - Potential subtitle-change miss in local polling path.
- Security note:
  - `npm audit` high findings on `rollup@2.x` remain due upstream pinning in `@crxjs/vite-plugin` dependency chain.

## 2026-03-11 Addendum Closure

The functional-gap addendum items have been implemented and verified.

- Security hardening completed:
  - page-world observer bridge now requires a runtime token
  - frame-forward nonce rotates on navigation
- Functional consistency completed:
  - `filterUnconfirmedEnabled` now applies consistently to container fallback paths
- Runtime stability completed:
  - invalidated extension context now triggers explicit runtime shutdown cleanup
  - offscreen document create-flow tolerates already-exists conditions
- Performance stabilization completed:
  - top-frame fallback uses adaptive backoff
  - last successful frame-path is reused for targeted probing
  - subtitle row style normalization uses cache + bounded descendant checks
- Coverage expansion completed:
  - added focused tests for `dom-probe`, `frame-probe`, and `injected-observer`

Reference docs:

- `FUNCTIONAL_GAP_REVIEW_2026-03-11.md`
- `FUNCTIONAL_GAP_REVIEW_ADDENDUM_2026-03-11.md`
- `BUILD_ENV_FEATURE_REVIEW_2026-03-11.md`
