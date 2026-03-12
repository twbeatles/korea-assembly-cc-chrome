# AI Context: Korea Assembly CC Chrome

이 문서는 다음 세션의 AI 에이전트가 현재 저장소를 빠르게 파악하고, Chrome Extension 코드베이스를 안전하게 수정하기 위한 루트 컨텍스트입니다.

## 1. 현재 프로젝트 상태

- 이 저장소의 활성 구현은 `Chrome Extension (Manifest V3) + TypeScript + React + Vite` 입니다.
- 과거 `PyQt6 + Selenium` 데스크톱 앱은 `legacy/` 아래 아카이브 대상으로 분리되어 있으며, 현재 작업 대상이 아닙니다.
- 최우선 기능은 `국회 AI 자막 추출`, `세션 저장`, `TXT / SRT / VTT / JSON 내보내기` 입니다.
- 현재 주 UI 는 `사이트 안 우측 패널`이며, popup 은 `페이지 패널 열기 / 저장된 기록 / 환경 설정 / 수집 진단` 중심의 보조 화면입니다.
- 현재 UI 보강 범위에는 `우측 패널 실시간 표시`, `history 기록 내부 검색/복사`, `최근 N줄 복사`, `history 즐겨찾기/세션 메모`, `entry 체크박스 기반 부분 복사/부분 export`, `전체 JSON 백업/복원`, `autosave 설정/최근 저장 시각 진단`, `autoScroll 옵션 반영`, `자막 우선 대형 미리보기`, `실시간 내용 / 화면 자막 2단 구성`, `패널/popup 수집 진단 진입`, `즉시 노출되는 내보내기 버튼`이 포함됩니다.
- 현재 기준 기본 검증 명령은 아래 4개입니다.

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

## 2. 핵심 기술 스택

- 빌드: `Vite + @crxjs/vite-plugin`
- 언어: `TypeScript`
- UI: `React`
- 테스트: `Vitest`
- 확장 런타임: `Manifest V3`
- 세션 저장: `IndexedDB` 우선, open/capability 실패 시 `chrome.storage.local` per-session fallback, 최후에는 메모리 fallback

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
    capture-notice.ts
    failed-stopped-session.ts
  core/
    live-capture.ts
    subtitle-pipeline.ts
    noise-filter.ts
    exporters/
  shared/
    capture-diagnostics.ts
  storage/
    session-store.ts
    session-backup.ts
    settings-store.ts
  popup/
  options/
  history/
tests/
README.md
CLAUDE.md
GEMINI.md
offscreen.html
```

## 4. 자막 추출 구조

### 4.1 DOM 탐색

- 선택자 우선순위는 아래 순서를 유지합니다.
  - `#viewSubtit .smi_word:last-child`
  - `#viewSubtit .smi_word`
  - `#viewSubtit .incont`
  - `#viewSubtit`
- 단일 노드 의존 금지입니다.
- `.smi_word` 는 목록 전체를 읽고 stable class token 을 `nodeKey` 로 추출합니다.
- top frame 에서는 `framePath + nodeKey` 기준 live row ledger 를 유지합니다.
- stable `nodeKey` 가 잡히면 같은 row 의 보정/완성은 live row 와 마지막 엔트리를 제자리 갱신하고, 새 row 만 commit 후보로 봅니다.
- stable key 가 없으면 `unstable` 로 간주하고 기존 raw/container fallback 으로 내려갑니다.
- 실패 시 container text fallback 을 사용합니다.

### 4.2 프레임 탐색

- `frame-probe.ts` 는 접근 가능한 `iframe/frame` 을 순회합니다.
- cross-origin 접근 실패는 예외를 삼키고 계속 진행합니다.
- top document, `body`, `documentElement` root fallback 을 같이 사용합니다.

### 4.3 Observer + Polling

- `injected-observer.ts` 가 page world 에서 `MutationObserver` 를 설치합니다.
- 수집 시작 시 자막 레이어가 닫혀 있으면 page function 또는 자막 버튼 클릭으로 자동 활성화를 먼저 시도합니다.
- observer 는 변경 신호를 받되, 실제 텍스트는 selector 기반으로 다시 읽고 `rows + raw preview` 를 함께 브리지합니다.
- 같은 row 의 텍스트가 수정되면 새 key 만 보내지 않고 현재 row 스냅샷을 다시 보내 제자리 갱신을 가능하게 합니다.
- observer, local polling, top-frame fallback 은 모두 같은 `NormalizedCaptureEvent` 형태로 합류합니다.
- top frame 에서는 자막 공백을 즉시 reset 하지 않고 약 1초 grace 뒤에만 실제 reset 을 commit 합니다.
- observer 실패 또는 타겟 미탐색 시 polling fallback 이 동작합니다.
- `content-script.ts` 는 top frame 에서만 세션 상태와 subtitle pipeline 을 소유합니다.

## 5. subtitle pipeline 고정 의미론

- `normalized capture event -> live reconcile -> normalize -> preview gate -> history/rfind suffix -> noise filter -> merge/add`
- structured row 가 안정적으로 잡히면 row baseline 과 글로벌 history 를 함께 사용해 commit/update 를 분리합니다.
- `_confirmed_compact` / `trailingSuffix` 의미를 유지합니다.
- suffix 매칭은 `rfind` 기반입니다.
- 과거 세션에 남아 있는 `speakerColor`, `speakerChannel`, `speakerChanged` 는 로드 가능해야 하지만, 현재 UI/내보내기에서는 이 메타를 전면에 드러내지 않습니다.
- desync 시 순서는 다음과 같습니다.
  - 직전 raw 대비 delta fallback
  - history anchor 기반 incremental fallback
  - 반복 실패 시 soft resync
- 동일 raw 유지 시 keepalive 로 마지막 entry 의 `endTime` 만 갱신합니다.
- `subtitle_reset` 이 오면 grace 이후 live ledger 와 pipeline state 를 함께 완전 리셋합니다.
- `finalizeSession` 은 현재 state 기준으로 종료 처리합니다.
- 저장/export/unload/stop 직전 prepared snapshot 생성 경로에서는 `flushPendingPreviews` 가 현재 preview-only 텍스트를 clone 상태에 materialize 합니다.

## 6. noise filtering 규칙

- `noiseFilterEnabled = true` 일 때만 아래 규칙으로 숫자-only / 기호-only를 차단합니다.
- 허용:
  - 한글 1~2글자
  - 영문 1~2글자
- 차단:
  - 숫자-only
  - 기호-only
- `noiseFilterEnabled = false` 이면 숫자-only / 기호-only도 통과시킵니다.
- 중복 차단 최소 길이 설정 키는 `recentDuplicateMinLength` 입니다.

## 7. exporter / persistence 규칙

### 7.1 Exporter

- `TXT`: `[HH:MM:SS] text`
- `SRT`: 세션 시작 기준 상대 시간, `HH:MM:SS,mmm`
- `VTT`: 세션 시작 기준 상대 시간, `HH:MM:SS.mmm`
- `JSON`: 세션 전체 복원 가능한 구조
- export 직전 carry-over exact duplicate 정리를 한 번 더 적용합니다.

### 7.2 Session Store

- `saveSession`
- `loadSession`
- `listSessions`
- `deleteSession`
- `deleteAllSessions`
- `updateRunningSession`
- `upsertSessionRecord`
- `importSessionRecords`
- `exportSessionData`
- `closeRunningSessionsOnStartup`

위 CRUD 흐름과 startup cleanup 의미론은 유지해야 합니다.

- record payload version 과 IndexedDB schema version 은 분리해서 관리합니다.
- 현재 session record schema 는 `version = "3"` 기준이며 `starred`, `pinnedAt`, `note` 필드를 포함합니다.
- `loadSession`/`listSessions` 는 IndexedDB + fallback 을 함께 읽고 `updatedAt` 기준으로 더 최신 레코드를 고릅니다. 동률이면 IndexedDB 를 우선합니다.
- 개별 IndexedDB transaction/read/write 실패는 현재 연산만 fallback 으로 우회하고, 런타임 전체 disable 은 open/capability failure 에만 허용됩니다.
- 성공한 IndexedDB write/delete 는 동일 id fallback copy 를 best-effort 로 정리합니다.
- `closeRunningSessionsOnStartup` 는 IndexedDB 와 fallback 양쪽의 persisted running 세션을 닫고 중복 id 는 1건으로 count 합니다.

### 7.3 UX 보강 규칙

- top frame 의 content script 가 우측 패널을 자동으로 삽입합니다.
- 기본 상태는 `펼쳐짐` 이고, 접으면 오른쪽의 `자막 보기` 탭만 남습니다.
- popup 의 `OPEN_INPAGE_PANEL` 명령은 접힌 패널을 다시 엽니다.
- popup 은 기존 탭에서 content script 수신자가 없으면 재주입을 시도하고, 실패 시 새로고침 안내로 내려갑니다.
- 패널은 `실시간 내용`과 `화면 자막` 2단으로 보입니다.
- `화면 자막` 목록은 현재 active row만 번쩍 보여 주는 뷰가 아니라, live ledger 기준 최근 row가 누적되는 뷰를 유지합니다.
- 같은 row key 의 갱신은 라이브 목록 DOM 노드를 재사용해 제자리 수정합니다.
- history 복사 포맷은 기본적으로 `[HH:MM:SS] text` 줄단위입니다.
- 페이지 패널과 history 모두 `recentCopyLineCount` 기반 `최근 N줄 복사`를 지원합니다.
- history 페이지는 열린 상태에서도 `recentCopyLineCount`, `filenamePattern` 변경을 `chrome.storage.onChanged` 로 즉시 반영합니다.
- history 의 `전체 삭제` 는 현재 로드된 1000건만이 아니라 저장소 전체를 비워야 하며, 선택 삭제는 부분 성공/실패 요약을 남긴 뒤 항상 refresh 해야 합니다.
- history 는 session-level `즐겨찾기`, `메모`, `즐겨찾기만 보기` 필터를 제공하고, 이 메타데이터는 persistence 및 JSON 백업/복원에서 함께 보존되어야 합니다.
- history detail 은 entry 체크박스 기반 `선택한 항목 복사`, `선택 TXT/SRT/VTT/JSON export` 를 제공하며, 선택 export 의 시간 기준은 원본 세션 시작 시각 기준 상대 시간 의미론을 유지해야 합니다.
- history 상단은 전체 저장소 기준 `JSON 백업` 과 단일 세션/번들 `JSON 가져오기` 를 지원하며, 가져오기는 같은 `id` 충돌 시 더 최신 `updatedAt` 레코드를 유지합니다.
- `autoScroll` 옵션이 꺼지면 패널의 `실시간 내용` / `화면 자막` 영역을 강제 스크롤하지 않습니다.
- autosave는 옵션에서 켜고 끌 수 있지만 `Stop` 시 최종 저장은 항상 유지합니다.
- stopped 세션 최종 저장이 실패하면 다음 `자막 모으기`/`화면 비우기` 전에 저장을 1회 재시도하고, 재시도도 실패할 때만 폐기 확인을 표시합니다.
- capture notice 는 `정상 수집`, `fallback 수집`, `reset 복구 중` 상태를 구분해 사용자에게 드러내야 합니다.
- 패널과 popup 은 `수집 진단` 화면 진입 버튼을 제공하고, 실제 수집 방식(`structured`/`fallback`/`polling`), observer 활성 여부, selector, frame path, 최근 저장 시각은 options 페이지의 `수집 진단` 탭에서 표시합니다.
- 브라우저/확장 cold start 시 남아 있던 persisted `running` 세션은 `stopped` 로 자동 정리됩니다.

## 8. 작업 시 주의사항

- popup 이 닫혀도 수집이 멈추면 안 됩니다.
- Selenium / PyQt 구조를 다시 가져오면 안 됩니다.
- `legacy/` 는 현재 기준 참조용 아카이브이며 Git 추적 대상에서도 제외되어 있습니다.
- storage 실패, observer 실패, frame 접근 실패, selector 미탐색은 크래시 대신 fallback 으로 내려가야 합니다.
- export 는 `offscreen Blob URL` 우선, 실패 시 `data:` URL fallback 을 유지합니다.
- frame forwarding 은 nonce 검증을 통과한 메시지만 top frame 에서 수용해야 합니다.
- 코드 수정 후 가능하면 `lint`, `typecheck`, `test`, `build` 를 모두 확인합니다.

## 9. 관련 문서

- 메인 설명: `README.md`
- 과거 의미론 참고: `legacy/python-desktop/PIPELINE_LOCK.md`
- 과거 운영 설명 참고: `legacy/python-desktop/README.md`
- 배포 절차: `DEPLOYMENT.md`

## Sync Delta (2026-03-12)

When editing this repository, align with the newly implemented behavior below.

- Preview-only subtitles must be preserved in save/export/pagehide/beforeunload/stop snapshots.
- Failed stopped-session persistence must retry before destructive continuation and require explicit discard confirmation only after the retry fails.
- Session storage reads must merge IndexedDB and fallback records, while successful IndexedDB writes heal stale fallback copies.
- History view must live-sync `recentCopyLineCount` and `filenamePattern` while the page remains open.
- The in-page `화면 자막` list must accumulate recent live rows and must not jump-scroll on preview-only updates.
- History now persists session favorites/notes, supports partial copy/export, and supports JSON backup/import with freshest-`updatedAt` conflict resolution.
- Panel and popup now expose runtime capture diagnostics (mode, observer, selector, frame path).
- Local polling change-detection work stays test-first; use the regression scaffold before broadening heuristics.

## Sync Delta (2026-03-11)

When editing this repository, align with the current implemented behavior below.

- Destructive actions require user confirmation:
  - history delete
  - clear current in-page session
- History export must pass `filenamePattern` from settings.
- Popup connection strategy is auto-reconnect with bounded backoff.
- Accessibility expectation for dynamic UI:
  - live preview/notice use polite live regions
  - live row stream uses log semantics
- Verification gate for meaningful changes:
  - `npm run typecheck`
  - `npm run test:coverage`
  - `npm run build` (or `npm run verify`)

## Addendum Closure (2026-03-11)

Cross-document alignment note:

- `FUNCTIONAL_GAP_REVIEW_2026-03-11.md` is the baseline index.
- `FUNCTIONAL_GAP_REVIEW_ADDENDUM_2026-03-11.md` tracks addendum findings and closure mapping.
- `BUILD_ENV_FEATURE_REVIEW_2026-03-11.md` tracks build/runtime validation state.

Current closure status:

- Bridge token verification: completed.
- Frame-forward nonce rotation: completed.
- Unconfirmed fallback consistency: completed.
- Fallback probe backoff + cached frame path: completed.
- Invalidated context shutdown path: completed.
- Offscreen duplicate-create tolerance: completed.
- Subtitle row style-cost tuning: completed.
- Focused regression tests added for probe/bridge paths.
