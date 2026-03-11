# AI Context: Korea Assembly CC Chrome

이 문서는 다음 세션의 AI 에이전트가 현재 Chrome Extension 저장소를 바로 이어서 작업할 수 있도록 정리한 운영 메모입니다.

## 1. 프로젝트 한 줄 요약

국회 의사중계 페이지에서 AI 자막을 실시간 추출하고, 페이지 오른쪽 패널에서 바로 보여 주며, 기록을 저장하고 `TXT / SRT / VTT / JSON` 으로 내보내는 `Manifest V3` 기반 확장프로그램입니다.

## 2. 현재 활성 범위

- 활성 런타임: `Chrome Extension MV3`
- 비활성 아카이브: `legacy/` 아래 Python 데스크톱 앱
- 주요 목표:
  - 국회 AI 자막 추출
  - live row ledger + history 기반 증분 처리
  - 세션 persistence
  - 우측 패널 + popup/options/history 동작
  - 쉬운 한국어 UI / 검색 / 최근 N줄 복사 / autosave UX
  - 자막 우선 대형 미리보기 / 화면 자막 2단 UI

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
- `src/offscreen/main.ts`

### 4.2 자막 수집 코어

- `src/content/dom-probe.ts`
- `src/content/frame-probe.ts`
- `src/content/injected-observer.ts`
- `src/core/live-capture.ts`
- `src/core/subtitle-pipeline.ts`
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

- `OPEN_INPAGE_PANEL`
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

- `GET_FRAME_FORWARD_NONCE`
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
- `.smi_word` 는 목록 전체를 읽고 stable class token 을 `nodeKey` 로 추적합니다.
- top frame 에서는 `framePath + nodeKey` 기준 live row ledger 를 유지합니다.
- stable key 가 있으면 같은 노드의 텍스트 보정은 기존 live row 와 기존 엔트리 갱신으로 처리합니다.
- 새 row 는 carry-over trim 과 글로벌 history 비교를 거친 뒤 실제 신규 delta 만 commit 합니다.
- stable key 가 없으면 `unstable` 로 표시하고 raw/container fallback 을 사용합니다.
- container text fallback 이 항상 있어야 합니다.
- 수집 시작 시 자막 레이어가 닫혀 있으면 page function 또는 자막 버튼 클릭으로 자동 활성화를 시도합니다.

### 6.2 증분 추출

- suffix 매칭은 `rfind` 기반입니다.
- structured row 가 안정적으로 잡히면 row baseline 과 global history 를 함께 사용합니다.
- 자막 영역 공백은 top frame 에서 약 1초 grace 뒤에만 reset commit 합니다.
- 과거 세션의 `speakerColor`, `speakerChannel`, `speakerChanged` 메타는 호환성을 위해 읽을 수 있어야 하지만, 현재 UI/내보내기에서는 이 메타를 전면에 쓰지 않습니다.
- 대표 edge case:
  - 이전: `이 문장은 테스트입니다`
  - 현재: `이 문장은 테스트입니다 감사합니다`
  - 결과: `감사합니다`
- direct anchor, suffix fallback, overlap fallback 순으로 봅니다.

### 6.3 게이트와 후단 정제

- raw text 를 바로 append 하지 않습니다.
- `normalized capture event -> live reconcile -> normalize -> preview gate -> history/rfind suffix -> noise filter -> merge/add`
- `noiseFilterEnabled = true` 이면 숫자-only, 기호-only는 reject 합니다.
- `noiseFilterEnabled = false` 이면 숫자-only, 기호-only도 통과시킵니다.
- 한글/영문 1~2글자는 허용합니다.
- recent compact tail 로 과잉 재누적을 막습니다.
- 중복 차단 최소 길이 설정 키는 `recentDuplicateMinLength` 입니다.

### 6.4 keepalive / reset / finalize

- 동일 raw 유지 시 마지막 entry `endTime` 갱신
- `subtitle_reset` 시 live ledger 와 pipeline state 를 함께 완전 리셋
- stop 시 현재 state 기준으로 finalize

## 7. persistence 규칙

- `IndexedDB` 우선
- 실패 시 `chrome.storage.local` per-session fallback
- 둘 다 실패하면 메모리 fallback

다음 API 는 깨지면 안 됩니다.

- `saveSession`
- `loadSession`
- `listSessions`
- `deleteSession`
- `updateRunningSession`
- `closeRunningSessionsOnStartup`

추가 UX 규칙:

- top frame 에 우측 패널이 자동 삽입됨
- popup 은 페이지 패널 다시 열기용 보조 화면
- popup 은 기존 탭에서 content script 수신자가 없으면 재주입을 시도하고, 실패 시 새로고침 안내로 내려감
- 패널은 `실시간 내용`과 `화면 자막` 2단으로 표시
- 복사 포맷은 `[HH:MM:SS] text`
- 페이지 패널과 history 모두 `recentCopyLineCount` 기반 최근 N줄 복사를 지원
- `autoScroll` 이 꺼지면 `실시간 내용` / `화면 자막` 강제 스크롤 금지
- autosave를 꺼도 `Stop` 시 최종 저장은 유지
- browser/extension cold start 시 남아 있던 `running` 세션은 `stopped` 로 정리

## 8. exporter 규칙

- `SRT`: `HH:MM:SS,mmm`, 세션 시작 기준 상대 시간
- `VTT`: `HH:MM:SS.mmm`, 세션 시작 기준 상대 시간
- `JSON`: 세션 전체 복원 가능한 구조
- export 직전 carry-over exact duplicate 정리를 한 번 더 적용합니다.
- 다운로드는 `offscreen Blob URL` 우선, 실패 시 `data:` URL fallback

## 9. known limits

- 국회 사이트 DOM 변경 시 selector / observer 안정성이 달라질 수 있습니다.
- cross-origin frame 은 직접 DOM 접근이 제한될 수 있습니다.
- observer 실패 시 polling fallback 의존도가 높아질 수 있습니다.
- 영상 캡처, 중요 표시, 발언자 편집은 현재 범위 밖입니다.

## 10. 작업 원칙

- crash 보다 fallback 이 우선입니다.
- popup 종료와 수집 중단을 연결하면 안 됩니다.
- `legacy/` 는 Git ignore 대상이므로, 현재 구현 변경은 루트 확장 코드에만 반영해야 합니다.
- frame forwarding 은 nonce 검증을 통과한 메시지만 허용해야 합니다.
- 변경 후에는 가능하면 `lint`, `test`, `build` 를 모두 실행합니다.

## Sync Delta (2026-03-11)

Use this delta as the current operational baseline.

- Confirm-before-destructive action policy is active.
- History export and in-page export are expected to both honor `filenamePattern`.
- Popup should recover transient disconnections automatically.
- Dynamic panel updates should remain screen-reader friendly (`aria-live`/status/log roles).
- Preferred verification pipeline:
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:coverage`
  - `npm run build`
  - `npm run verify` for full pre-release checks.
