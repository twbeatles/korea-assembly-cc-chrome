# AI Context: Korea Assembly CC Chrome

이 문서는 다음 세션의 AI 에이전트가 현재 저장소를 빠르게 파악하고, Chrome Extension 코드베이스를 안전하게 수정하기 위한 루트 컨텍스트입니다.

## 1. 현재 프로젝트 상태

- 이 저장소의 활성 구현은 `Chrome Extension (Manifest V3) + TypeScript + React + Vite` 입니다.
- 과거 `PyQt6 + Selenium` 데스크톱 앱은 `legacy/` 아래 아카이브 대상으로 분리되어 있으며, 현재 작업 대상이 아닙니다.
- 최우선 기능은 `국회 AI 자막 추출`, `세션 저장`, `TXT / SRT / VTT / JSON 내보내기` 입니다.
- 현재 기준 기본 검증 명령은 아래 3개입니다.

```bash
npm run lint
npm run test
npm run build
```

## 2. 핵심 기술 스택

- 빌드: `Vite + @crxjs/vite-plugin`
- 언어: `TypeScript`
- UI: `React`
- 테스트: `Vitest`
- 확장 런타임: `Manifest V3`
- 세션 저장: `IndexedDB` 우선, 실패 시 `chrome.storage.local`, 최후에는 메모리 fallback

## 3. 주요 파일 구조

```text
manifest.json
src/
  background/service-worker.ts
  content/
    content-script.ts
    injected-observer.ts
    dom-probe.ts
    frame-probe.ts
  core/
    subtitle-pipeline.ts
    suffix-diff.ts
    noise-filter.ts
    exporters/
  storage/
    session-store.ts
    settings-store.ts
  popup/
  options/
  history/
tests/
README.md
CLAUDE.md
GEMINI.md
```

## 4. 자막 추출 구조

### 4.1 DOM 탐색

- 선택자 우선순위는 아래 순서를 유지합니다.
  - `#viewSubtit .smi_word:last-child`
  - `#viewSubtit .smi_word`
  - `#viewSubtit .incont`
  - `#viewSubtit`
- 단일 노드 의존 금지입니다.
- `.smi_word` 는 목록 전체를 읽고 인접 compact 중복을 압축한 뒤 최근 3개 window 텍스트를 조합합니다.
- 실패 시 container text fallback 을 사용합니다.

### 4.2 프레임 탐색

- `frame-probe.ts` 는 접근 가능한 `iframe/frame` 을 순회합니다.
- cross-origin 접근 실패는 예외를 삼키고 계속 진행합니다.
- top document, `body`, `documentElement` root fallback 을 같이 사용합니다.

### 4.3 Observer + Polling

- `injected-observer.ts` 가 page world 에서 `MutationObserver` 를 설치합니다.
- observer 는 변경 신호를 받되, 실제 텍스트는 selector 기반으로 다시 읽어 `.smi_word` window 조합을 유지합니다.
- observer 실패 또는 타겟 미탐색 시 polling fallback 이 동작합니다.
- `content-script.ts` 는 top frame 에서만 세션 상태와 subtitle pipeline 을 소유합니다.

## 5. subtitle pipeline 고정 의미론

- `normalize -> preview gate -> suffix diff -> noise filter -> merge/add`
- `_confirmed_compact` / `trailingSuffix` 의미를 유지합니다.
- suffix 매칭은 `rfind` 기반입니다.
- desync 시 순서는 다음과 같습니다.
  - 직전 raw 대비 delta fallback
  - history anchor 기반 incremental fallback
  - 반복 실패 시 soft resync
- 동일 raw 유지 시 keepalive 로 마지막 entry 의 `endTime` 만 갱신합니다.
- `subtitle_reset` 이 오면 pending preview drain 후 완전 리셋합니다.
- `finalizeSession` 은 stop 시 pending preview 를 먼저 소진합니다.

## 6. noise filtering 규칙

- 허용:
  - 한글 1~2글자
  - 영문 1~2글자
- 차단:
  - 숫자-only
  - 기호-only

## 7. exporter / persistence 규칙

### 7.1 Exporter

- `TXT`: `[HH:MM:SS] text`
- `SRT`: 세션 시작 기준 상대 시간, `HH:MM:SS,mmm`
- `VTT`: 세션 시작 기준 상대 시간, `HH:MM:SS.mmm`
- `JSON`: 세션 전체 복원 가능한 구조

### 7.2 Session Store

- `saveSession`
- `loadSession`
- `listSessions`
- `deleteSession`
- `updateRunningSession`

위 5개 API 는 항상 유지해야 합니다.

## 8. 작업 시 주의사항

- popup 이 닫혀도 수집이 멈추면 안 됩니다.
- Selenium / PyQt 구조를 다시 가져오면 안 됩니다.
- `legacy/` 는 현재 기준 참조용 아카이브이며 Git 추적 대상에서도 제외되어 있습니다.
- storage 실패, observer 실패, frame 접근 실패, selector 미탐색은 크래시 대신 fallback 으로 내려가야 합니다.
- 코드 수정 후 가능하면 `lint`, `test`, `build` 를 모두 확인합니다.

## 9. 관련 문서

- 메인 설명: `README.md`
- 과거 의미론 참고: `legacy/python-desktop/PIPELINE_LOCK.md`
- 과거 운영 설명 참고: `legacy/python-desktop/README.md`
