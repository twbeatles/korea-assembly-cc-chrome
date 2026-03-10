# AI Context: Korea Assembly CC Chrome

이 문서는 다음 세션의 AI 에이전트가 현재 Chrome Extension 저장소를 바로 이어서 작업할 수 있도록 정리한 운영 메모입니다.

## 1. 프로젝트 한 줄 요약

국회 의사중계 페이지에서 AI 자막을 실시간 추출하고, 세션을 저장하며, `TXT / SRT / VTT / JSON` 으로 내보내는 `Manifest V3` 기반 확장프로그램입니다.

## 2. 현재 활성 범위

- 활성 런타임: `Chrome Extension MV3`
- 비활성 아카이브: `legacy/` 아래 Python 데스크톱 앱
- 주요 목표:
  - 국회 AI 자막 추출
  - suffix 기반 증분 처리
  - 세션 persistence
  - popup/options/history 동작

## 3. 필수 명령

```bash
npm install
npm run lint
npm run test
npm run build
```

`npm run build` 는 `scripts/build-injected.mjs` 로 `public/injected-observer.js` 를 먼저 생성한 뒤 확장 번들을 만듭니다.

## 4. 핵심 파일 지도

### 4.1 확장 엔트리

- `manifest.json`
- `src/background/service-worker.ts`
- `src/content/content-script.ts`
- `src/popup/App.tsx`
- `src/options/App.tsx`
- `src/history/App.tsx`

### 4.2 자막 수집 코어

- `src/content/dom-probe.ts`
- `src/content/frame-probe.ts`
- `src/content/injected-observer.ts`
- `src/core/subtitle-pipeline.ts`
- `src/core/suffix-diff.ts`
- `src/core/noise-filter.ts`

### 4.3 저장 / 내보내기

- `src/storage/session-store.ts`
- `src/storage/settings-store.ts`
- `src/core/exporters/txt.ts`
- `src/core/exporters/srt.ts`
- `src/core/exporters/vtt.ts`
- `src/core/exporters/json.ts`

## 5. 메시지와 책임 분리

### popup -> content

- `START_CAPTURE`
- `STOP_CAPTURE`
- `CLEAR_SESSION`
- `SAVE_SESSION`
- `EXPORT_REQUEST`

### content -> popup

- `CAPTURE_STATUS`
- `PREVIEW_UPDATE`
- `SESSION_STATS`
- `ERROR`

### background

- `DOWNLOAD_REQUEST`
- `OPEN_HISTORY_PAGE`
- `OPEN_OPTIONS_PAGE`

`shared/message-types.ts` 의 타입 정의를 기준으로 유지해야 합니다.

## 6. 자막 알고리즘 핵심

### 6.1 DOM 수집

- selector 우선순위:
  - `#viewSubtit .smi_word:last-child`
  - `#viewSubtit .smi_word`
  - `#viewSubtit .incont`
  - `#viewSubtit`
- `.smi_word` 는 목록 전체를 읽고 최근 3개 텍스트를 window 조합합니다.
- container text fallback 이 항상 있어야 합니다.

### 6.2 증분 추출

- suffix 매칭은 `rfind` 기반입니다.
- 대표 edge case:
  - 이전: `이 문장은 테스트입니다`
  - 현재: `이 문장은 테스트입니다 감사합니다`
  - 결과: `감사합니다`
- direct anchor, suffix fallback, overlap fallback 순으로 봅니다.

### 6.3 게이트와 후단 정제

- raw text 를 바로 append 하지 않습니다.
- `normalize -> preview gate -> suffix diff -> noise filter -> merge/add`
- 숫자-only, 기호-only는 reject 합니다.
- 한글/영문 1~2글자는 허용합니다.
- recent compact tail 로 과잉 재누적을 막습니다.

### 6.4 keepalive / reset / finalize

- 동일 raw 유지 시 마지막 entry `endTime` 갱신
- `subtitle_reset` 시 완전 리셋
- stop 시 pending preview drain 후 finalize

## 7. persistence 규칙

- `IndexedDB` 우선
- 실패 시 `chrome.storage.local` fallback
- 둘 다 실패하면 메모리 fallback

다음 API 는 깨지면 안 됩니다.

- `saveSession`
- `loadSession`
- `listSessions`
- `deleteSession`
- `updateRunningSession`

## 8. exporter 규칙

- `SRT`: `HH:MM:SS,mmm`, 세션 시작 기준 상대 시간
- `VTT`: `HH:MM:SS.mmm`, 세션 시작 기준 상대 시간
- `JSON`: 세션 전체 복원 가능한 구조

## 9. known limits

- 국회 사이트 DOM 변경 시 selector / observer 안정성이 달라질 수 있습니다.
- cross-origin frame 은 직접 DOM 접근이 제한될 수 있습니다.
- observer 실패 시 polling fallback 의존도가 높아질 수 있습니다.

## 10. 작업 원칙

- crash 보다 fallback 이 우선입니다.
- popup 종료와 수집 중단을 연결하면 안 됩니다.
- `legacy/` 는 Git ignore 대상이므로, 현재 구현 변경은 루트 확장 코드에만 반영해야 합니다.
- 변경 후에는 가능하면 `lint`, `test`, `build` 를 모두 실행합니다.
