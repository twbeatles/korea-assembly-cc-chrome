# AI Context: Korea Assembly CC Chrome

이 문서는 다음 세션의 AI 에이전트가 현재 Chrome Extension 저장소를 바로 이어서 작업할 수 있도록 정리한 운영 메모입니다.

## 1. 프로젝트 한 줄 요약

국회 의사중계 페이지에서 AI 자막을 실시간 추출하고, 페이지 오른쪽 패널에서 바로 보여 주며, 기록을 저장하고 `TXT / SRT / VTT / JSON / MD / CSV` 로 내보내는 `Manifest V3` 기반 확장프로그램입니다.

## 2. 현재 활성 범위

- 활성 런타임: `Chrome Extension MV3`
- 비활성 아카이브: `legacy/` 아래 Python 데스크톱 앱
- 주요 목표:
  - 국회 AI 자막 추출
  - live row ledger + history 기반 증분 처리
  - 세션 persistence
  - 우측 패널 + popup/options/history 동작
  - 쉬운 한국어 UI / 검색 / 최근 N줄 복사 / autosave UX
  - history 전체 기록 검색 / 즐겨찾기 / 세션 메모 / 태그 / 카테고리 / 부분 선택 복사 / 중요 표시만 export / 시간 범위 export / JSON 백업·복원
  - history entry 텍스트, 발언자, 중요 표시, entry note, labels inline 편집과 병합/분할/삭제
  - options preset CRUD와 popup preset 바로 열기
  - 패널 / popup 수집 진단 진입 + options 수집 진단 탭
  - 자막 우선 대형 미리보기 / 수집된 자막 2단 UI

## 3. 필수 명령

```bash
npm install
npm run lint
npm run typecheck      # TypeScript 7 (scripts/run-tsc.mjs)
npm run typecheck:ts6  # TypeScript 6 비교
npm run test
npm run build
npm run verify:e2e
```

`npm run build` 는 `scripts/build-injected.mjs` 로 `public/injected-observer.js` 를 먼저 생성한 뒤 확장 번들을 만듭니다. 전체 검증은 `npm run verify` (CI: `.github/workflows/ci.yml`), 로컬 Chrome 확장 smoke 는 `npm run test:e2e:extension` (closed shadow · light DOM 미러) 기준입니다.

**보안·검증 문서:** `SECURITY.md` · `LIVE_CAPTURE_SMOKE_CHECKLIST.md`. 상세 Sync Delta 는 `CLAUDE.md` 를 우선합니다.

### 3.1 TypeScript dual-track (2026-07-13)

- **typecheck 기본:** TypeScript 7 (`typescript-7` + `scripts/run-tsc.mjs 7`)
- **ESLint API:** TypeScript 6 (`typescript@^6`) — `typescript-eslint` peer/API 제약
- emit/번들은 Vite + esbuild 유지 (`tsc --noEmit` only)

## 4. 핵심 파일 지도

### 4.1 확장 엔트리

- `manifest.json`
- `src/background/service-worker.ts`
- `src/content/content-script.ts`
- `src/content/app/context.ts`
- `src/content/app/runtime.ts` (public facade)
- `src/content/app/runtime/implementation.ts`
- `src/content/runtime/*`
- `src/content/inpage-panel.ts`
- `src/content/inpage-panel/*`
- `src/popup/App.tsx` (public facade), `src/popup/app/*`
- `src/options/App.tsx` (public facade), `src/options/app/*`
- `src/history/App.tsx` (public facade), `src/history/app/*`
- `src/offscreen/main.ts`

### 4.2 자막 수집 코어

- `src/content/dom-probe.ts`
- `src/content/frame-probe.ts`
- `src/content/injected-observer.ts`
- `src/content/panel-live-rows.ts`
- `src/content/inpage-panel.ts`는 공개 facade이고, 패널 상태/DOM/렌더링 세부 구현은 `src/content/inpage-panel/` 하위 모듈에 있습니다.
- `src/core/live-capture.ts`
- `src/core/session-lineage.ts`
- `src/core/subtitle-pipeline.ts`
- `src/core/noise-filter.ts`

### 4.3 저장 / 내보내기

- `src/storage/session-store.ts` (public facade)
- `src/storage/session-store/*`
- `src/storage/session-backup.ts`
- `src/storage/settings-store.ts`
- `src/core/exporters/txt.ts`
- `src/core/exporters/srt.ts`
- `src/core/exporters/vtt.ts`
- `src/core/exporters/json.ts`
- `src/core/exporters/markdown.ts`
- `src/core/exporters/csv.ts`
- `src/shared/capture-diagnostics.ts`

## 5. 메시지와 책임 분리

### popup -> content

- `GET_STATUS`
- `GET_DIAGNOSTICS_STATUS`
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
- `POPUP_FEEDBACK`
- `ERROR`

### background

- `GET_FRAME_FORWARD_NONCE`
- `DOWNLOAD_REQUEST`
- `OPEN_HISTORY_PAGE`
- `OPEN_OPTIONS_PAGE`
- `OPEN_DIAGNOSTICS_PAGE`

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
- 본회의(`xcode=10` 또는 `xcgcd=DCM000010...`) container fallback 은 commit/diff 용 내부 raw 누적 원문을 잘라내지 않습니다. UI preview 는 URL 과 무관하게 `400자/3줄` tail 로 짧게 표시합니다.
- 수집 시작 시 자막 레이어가 닫혀 있으면 page function 또는 자막 버튼 클릭으로 자동 활성화를 시도합니다.

### 6.2 증분 추출

- suffix 매칭은 `rfind` 기반입니다.
- structured row 가 안정적으로 잡히면 row baseline 과 global history 를 함께 사용합니다.
- 자막 영역 공백은 top frame 에서 약 1초 grace 뒤에만 reset commit 합니다.
- 과거 세션의 `speakerColor`, `speakerChannel`, `speakerChanged` 메타는 호환성을 위해 읽을 수 있어야 하며, history UI에서는 `speakerChannel`을 `발언자 A / 발언자 B / 알 수 없음`으로 표시합니다.
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
- `로딩중..`, `로딩 중...`, `Loading...` placeholder는 noise filter 설정과 무관하게 commit/persist/export 대상에서 제외합니다.
- 기본 언어 판정은 한글/영문 중심입니다. 외국어 텍스트 지원 확대는 이번 배치 범위에 포함하지 않았으며, raw foreign text 를 최대한 남기려면 noise filter 를 꺼야 합니다.
- recent compact tail 로 과잉 재누적을 막습니다.
- 중복 차단 최소 길이 설정 키는 `recentDuplicateMinLength` 입니다.

### 6.4 keepalive / reset / finalize

- 동일 raw 유지 시 마지막 entry `endTime` 갱신
- `subtitle_reset` 시 live ledger 와 pipeline state 를 함께 완전 리셋
- stop 시 현재 state 기준으로 finalize
- 수동 저장 / export 는 현재 패널의 `300건` 렌더 window가 아니라 세션의 committed `entries` 전체를 직렬화합니다. fallback preview 는 같은 normalized raw 가 2회 이상 또는 400ms 이상 안정적으로 관측된 뒤에만 committed fallback entry 로 materialize 됩니다.
- unload / stop / page-exit 계열 prepared snapshot 생성 경로도 preview-only 텍스트를 entry 로 반영하지 않고 drop 함
- structured row snapshot 안에 stable/unstable row가 함께 있으면 stable row subset만 commit 대상으로 쓰고, unstable row는 preview-only로 남겨야 함

## 7. persistence 규칙

- `IndexedDB` 우선
- open/capability 실패 시 `chrome.storage.local` per-session fallback
- 둘 다 실패하면 메모리 fallback

다음 API 는 깨지면 안 됩니다.

- `saveSession`
- `loadSession`
- `listSessions`
- `deleteSession`
- `deleteAllSessions`
- `updateRunningSession`
- `upsertSessionRecord`
- `importSessionRecords`
- `exportSessionData`
- `loadSessionsByIds`
- `getSessionLibraryOverview`
- `buildSessionLibraryBackupExport`
- `replayQueuedExitPersistRecords`
- `closeRunningSessionsOnStartup`

추가 UX 규칙:

- top frame 에 우측 패널이 자동 삽입됨
- 패널은 지원 사이트의 `main` / `main/` 홈과 `main/player*` 플레이어에 모두 붙지만, 실제 `startCapture()` 는 player 페이지에서만 허용됨
- popup 은 페이지 패널 다시 열기용 보조 화면
- popup 은 기존 탭에서 content script 수신자가 없으면 재주입을 시도하고, 실패 시 새로고침 안내로 내려감
- 패널은 `실시간 내용`과 `수집된 자막` 2단으로 표시
- `수집된 자막`은 live ledger 기준 최근 row 누적 목록이며, preview-only 갱신만으로 목록 스크롤이 초기화되면 안 됨
- 본회의 fallback capture에서는 structured row가 비어 있어도 commit된 entry를 `수집된 자막` 목록으로 재구성해 누적 표시해야 함
- 복사 포맷은 `[HH:MM:SS] text`
- 페이지 패널과 history 모두 `recentCopyLineCount` 기반 최근 N줄 복사를 지원
- history 페이지는 열린 상태에서도 `recentCopyLineCount`, `filenamePattern` 변경을 즉시 반영
- session record schema 는 `starred`, `pinnedAt`, `note` 를 포함하며 history 즐겨찾기/메모/JSON 백업·복원에서 그대로 유지
- IndexedDB schema `5` 는 `lineageId` index 를 포함하며, migration 은 기존 record 의 `lineageId`, `segmentNumber` 기본값을 채워야 함
- history 즐겨찾기/메모 저장은 전용 `updateSessionMetadata(sessionId, patch)` 경로를 사용해야 하며, stale detail snapshot 이 최신 `entries` / `subtitleCount` / `status` 를 덮어쓰면 안 됨
- history 는 `즐겨찾기만 보기`, 전체 기록 검색, 태그/카테고리 필터, 세션 메모 저장, 세션/entry 발언자 라벨, entry 중요 표시/note/labels inline 편집, entry 체크박스 기반 `선택한 항목 복사`, 전체/선택/중요 표시만/시간 범위 `TXT/SRT/VTT/JSON/MD/CSV` export, 전체 JSON 백업/가져오기를 지원
- entry 편집은 `updateSessionContent(sessionId, patch)` 경로를 사용하고, 첫 텍스트 수정 시 기존 `text`를 `originalText`로 보존해야 함
- 전체 JSON 백업 / JSON 가져오기는 현재 단계와 진행량을 표시하고 취소를 지원하며, JSON import read phase 와 backup package phase 도 abort-aware 여야 하고 import cancel 은 이미 저장된 부분 완료 레코드를 rollback 하지 않음
- history 전체 삭제 확인은 전체 preload 가 아니라 저장소 overview(count + preview) helper 기준으로 동작해야 함
- 전체 JSON 백업은 view-layer preload 대신 store helper export payload 를 사용해야 함
- 전체 JSON 백업 다운로드는 history page Blob URL helper 로 시작해야 하며, 대형 `content` 문자열을 `DOWNLOAD_REQUEST` 로 service worker 에 보내면 안 됨
- `autoScroll` 이 꺼지면 `실시간 내용` / `수집된 자막` 강제 스크롤 금지
- autosave를 꺼도 `Stop` 시 최종 저장은 유지
- stopped 세션 최종 저장 실패 시 다음 시작/비우기 전에 1회 재시도 후, 계속 실패하면 폐기 확인
- page-exit stopped snapshot 은 replay queue 에 함께 적재되고, background 저장 성공 시 stale queued snapshot 을 정리해야 함
- startup 에서는 queued stopped snapshot replay -> stale running cleanup 순서를 유지해야 함
- replay / cleanup diagnostics 는 options `저장 복구 상태`에 노출됨
- replay queue 조회는 storage snapshot + memory snapshot merge여야 하며, 같은 `sessionId` 충돌 시 `updatedAt` 우선, 동률이면 늦은 `queuedAt`을 유지해야 함
- queue write 실패는 메모리 queue를 유지한 채 `lastQueueWriteError`로 기록하고, diagnostics는 `lastQueueWriteError`, `lastReplayError`, `lastCleanupError`, `lastError`를 함께 유지해야 함
- session import 는 allow-list sanitize 후 normalize 해야 하며, unsupported wrapper version / invalid timestamp 는 reject 해야 함
- 패널과 popup 은 `수집 진단` 화면 진입을 제공하고, capture mode, observer, selector, frame path, 최근 저장 시각, 저장 복구 상태는 options 의 `수집 진단` 탭에서 표시
- fallback/polling capture notice 는 실제 수집이 이어질 때 중립적 “수집 중 + 자동 조정” 톤을 유지해야 함
- capture notice 는 기본 idle 안내만 숨기고, 수동 클릭 안내 / 오류 / 복구 / 액션 feedback 을 실제 텍스트로 보여줘야 함
- popup `SAVE_SESSION`은 패널과 동일한 `hasPersistableContent` 기준일 때만 활성화되어야 하고, 빈 저장 요청은 `저장할 자막이 아직 없습니다.`로 응답해야 함
- in-page panel `화면 비우기`는 `hasPersistableContent`와 별도 gating 을 사용해 running 상태이거나 preview/notice-only 상태에서도 직접 reset 가능해야 함
- subtitle auto activation 성공은 `visible && (hasText || controlActive)`로 판정해야 함
- options 숫자 필드는 draft string + inline validation 패턴을 유지해야 함
- options / storage 숫자 설정은 모두 정수만 허용해야 하며, UI `step=1` 과 storage sanitize 최소값 정책이 일치해야 함

## 8. exporter 규칙

- `TXT`: 기본 호환 출력은 text 중심이며, 설정에 따라 timestamp, speaker, entry note/labels/중요 표시를 포함
- `SRT`: `HH:MM:SS,mmm`, 세션 시작 기준 상대 시간
- `VTT`: `HH:MM:SS.mmm`, 세션 시작 기준 상대 시간
- `JSON`: 세션 전체 복원 가능한 구조
- 수동 `saveSession` / `exportSessionData` 는 세션의 committed `entries` 전체를 사용하며, preview-only 항목으로 내려가지 않습니다.
- JSON single-session export 와 backup/import sanitize 경로는 `lineageId`, `segmentNumber` 를 보존하고, 기존 JSON 에 두 필드가 없으면 기본값을 적용합니다.
- export 직전 carry-over exact duplicate 정리를 한 번 더 적용합니다.
- 다운로드는 `offscreen Blob URL` 우선이며, 실패 시에도 `data:` URL fallback 은 bounded payload 에서만 허용
- offscreen Blob chunk split 은 surrogate pair 를 깨지 않는 code point 안전 방식이어야 합니다.
- export filename safety sanitize 는 남아 있는 금지 문자를 첫 1회가 아니라 전체 제거해야 합니다.

## 9. known limits

- 국회 사이트 DOM 변경 시 selector / observer 안정성이 달라질 수 있습니다.
- cross-origin frame 은 직접 DOM 접근이 제한될 수 있습니다.
- observer 실패 시 polling fallback 의존도가 높아질 수 있습니다.
- 영상 캡처, 외부 AI 요약, 외부 전송은 현재 범위 밖입니다.

## 10. 작업 원칙

- crash 보다 fallback 이 우선입니다.
- popup 종료와 수집 중단을 연결하면 안 됩니다.
- `legacy/` 는 로컬 참조 아카이브일 수 있지만 Git 추적 대상으로 전제하면 안 됩니다.
- frame forwarding 은 nonce 검증을 통과한 메시지만 허용해야 합니다.
- 변경 후에는 가능하면 `lint`, `typecheck`, `test`, `build` 를 모두 실행합니다.

## Sync Delta (2026-07-13)

Use this delta for the TypeScript toolchain.

- `npm run typecheck` = TypeScript 7 via `scripts/run-tsc.mjs`; keep `typescript@6` for ESLint.
- Do not single-package onto `typescript@7` until typescript-eslint peer/API allows it.
- `noEmit` + Vite emit only; keep `src/css-modules.d.ts` and rollup overrides (`vite`/`vitest` → rollup 4, crxjs → 2.80.0).
- Tooling change does not alter session storage, export formats, or Manifest contracts.

## Sync Delta (2026-04-13)

Use this delta as the current operational baseline.

- structured row snapshot 안에 stable/unstable row가 함께 있어도 stable row만 commit 하고, unstable row는 preview-only 로 남깁니다.
- `importSessionRecords()` 는 incoming `running` 상태를 모두 `saved` 로 정규화합니다.
- export filename safety sanitize 는 남아 있는 금지 문자를 첫 1회가 아니라 전체 제거해야 합니다.
- options / storage numeric settings 는 정수만 허용하며, 소수 입력은 저장 불가입니다.
- 기본 회귀 검증은 `npm run check:version`, `npm run check:injected`, `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build` 기준으로 유지합니다.

## Sync Delta (2026-03-19)

Use this delta as the current operational baseline.

- frame-forward nonce는 탭 단위 `chrome.storage.local`에 유지되며, 탭 `loading` 시 회전하고 탭 제거 시 정리됩니다.
- 모든 content script는 bootstrap 시 nonce를 받고 15초마다 재동기화하며, forwarded frame nonce mismatch는 현재 이벤트를 버리고 즉시 resync 해야 합니다.
- replay queue는 storage + memory merge 기준으로 읽고, storage write failure 뒤에도 메모리 queue를 유지해야 합니다.
- options `저장 복구 상태`는 queue write / replay / cleanup 오류를 개별적으로 보여 줘야 합니다.
- popup 저장 버튼은 persistable content가 없으면 비활성화되고, 빈 저장은 `저장할 자막이 아직 없습니다.` 피드백으로 일관되게 처리되어야 합니다.
- subtitle auto activation 성공은 `visible && (hasText || controlActive)` 조건을 충족할 때만 인정됩니다.

## Sync Delta (2026-03-20)

Use this delta as the current operational baseline.

- 본회의(`xcode=10` / `xcgcd=DCM000010...`) container fallback은 commit/diff 용 내부 raw 누적 원문을 그대로 유지해야 하며, UI preview 는 tail formatter 로 짧게 유지해야 합니다.
- 본회의 fallback capture에서는 structured live row가 비어 있어도 commit된 entry를 `수집된 자막` 목록으로 계속 보여 주어야 합니다.
- `로딩중..`, `로딩 중...`, `Loading...` placeholder는 noise filter 토글과 무관하게 commit/persist/export 대상에서 제외되어야 합니다.

## Sync Delta (2026-03-12)

Use this delta as the current operational baseline.

- Manual save/export must serialize only committed visible `수집된 자막` rows.
- Pagehide/beforeunload/stop snapshots must persist committed entries only and must not materialize preview-only text.
- Failed stopped-session persistence must retry before `start`/`clear` proceeds.
- Session reads must merge IndexedDB and fallback storage using freshest `updatedAt`.
- History view must live-sync settings-driven copy/export behavior.
- The in-page `수집된 자막` list now accumulates recent live rows and should remain visually stable during preview-only updates.
- History now supports favorites, notes, partial copy/export, and full JSON backup/import.
- Panel and popup now surface runtime capture diagnostics.

## Sync Delta (2026-03-13)

Use this delta as the current operational baseline.

- page-exit stopped snapshots now enqueue replay records, and startup replays them before stale running cleanup.
- replay / cleanup summaries are stored as diagnostics and surfaced in options `저장 복구 상태`.
- session import now sanitizes allow-listed fields and rejects unsupported wrapper versions or invalid timestamps.
- history full-delete confirmation now uses count + preview, and full-library JSON backup uses store-level export helpers.
- popup / history async actions must always leave a user-facing error message when they fail.
- options numeric settings now use draft-string validation instead of mutating canonical numbers on every keystroke.

## Sync Delta (2026-03-11)

Use this delta as the current operational baseline.

- Confirm-before-destructive action policy is active.
- History export and in-page export are expected to both honor `filenamePattern`.
- Popup should recover transient disconnections automatically.
- Dynamic panel updates should remain screen-reader friendly (`aria-live`/status/log roles).
- Preferred verification pipeline:
  - `npm run check:version`
  - `npm run check:injected`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test`
  - `npm run build`
  - `npm run verify:e2e`
  - `npm run verify` for full pre-release checks.

## Addendum Closure (2026-03-11)

## Sync Delta (2026-03-16)

Use this delta as the current operational baseline.

- `listSessionsPage({ page, pageSize, starredOnly })` now uses IndexedDB-level paging when fallback session records are absent. When fallback records exist, merge fallback records with only the needed IndexedDB window/id lookups instead of loading every IndexedDB session.
- Session ordering remains `starred` first, then `pinnedAt || updatedAt` descending for starred sessions, then `updatedAt` descending, then `id`.
- `deleteAllSessions()` must attempt IndexedDB and fallback cleanup independently and surface partial-failure detail when only one store fails.
- `filenamePattern` now rejects forbidden path characters and unsupported placeholders, and invalid stored values are sanitized back to the default pattern.
- The in-page `최근 N줄 복사` action now uses the prepared cumulative session snapshot instead of transient live rows, so it matches history semantics.
- History long-running actions keep the shared busy state for 일반 작업 while full-library `JSON 백업` / `JSON 가져오기` use dedicated progress + cancel state and lock only the JSON task controls.
- History favorite/note writes must patch only `starred` / `pinnedAt` / `note` against the latest stored session record and must not replay stale detail snapshots.
- Full-library backup packaging and JSON import file reads are now cooperative abort-aware paths and should keep that behavior during future edits.
- Options tests and inputs now rely on accessible field labels instead of display-text-only selectors.

Keep this file aligned with the implementation closure below:

- Observer bridge message token verification: completed.
- Nonce rotation per navigation lifecycle: completed.
- Consistent unconfirmed filtering across container fallback: completed.
- Adaptive fallback backoff and cached frame-path probing: completed.
- Graceful shutdown on invalidated extension context: completed.
- Offscreen duplicate-create resilience: completed.
- Subtitle row style-computation optimization: completed.
- Test expansion for `dom-probe`, `frame-probe`, and `injected-observer`: completed.

Reference consistency set:

- `README.md`
- `DEPLOYMENT.md`

## 2026-03-12 Additional Sync Update

- content -> popup messaging now also includes `POPUP_FEEDBACK`.
- popup command feedback must explicitly surface `OPEN_INPAGE_PANEL` results.
- session import summaries now include `failedCount`.
- supported hosts are fixed to both `assembly.webcast.go.kr` and `webcast.assembly.go.kr`.
- options field exposure is now declared in code and covered by regression tests.

## Sync Delta (2026-03-23)

Use this delta as the current operational baseline.

- `ensureSubtitleLayerActive` 성공 판정은 `layer.visible` 단독이 아니라 `layer.visible && (layer.hasText || layer.controlActive)` 조건을 충족할 때만 인정합니다. 이전에는 `visible`만 체크해 텍스트나 control 신호가 없어도 성공으로 처리하던 버그가 수정되었습니다.
- `saveCurrentSessionSnapshot` / `exportCurrentSession` 은 prepared snapshot 의 committed `entries` 전체를 직렬화하며, in-page panel 의 가시 row window 와 저장 범위를 동일시하면 안 됩니다.
- committed entry 가 1건 이상 있을 때만 저장 / export payload 가 만들어지며, fallback `실시간 내용`은 안정 관측 전에는 저장/export 대상으로 승격되지 않습니다.
- committed entry 가 없으면 저장 / export 불가 상태로 남습니다.
- popup 버튼 활성화 조건은 `subtitleCount` / `previewText` 단순 판정이 아니라 `hasPersistableContent` 기준으로 통일됩니다.

## Sync Delta (2026-04-07)

Use this delta as the current operational baseline.

- `수집된 자막` 목록은 bounded live ledger 와 별개로 세션 전체 누적 committed subtitles 를 보여 줍니다. `liveLedgerMaxRows = 300` 은 reconciliation cap 일 뿐 저장/export 기준이 아닙니다.
- 수동 저장 / export 와 pagehide/beforeunload/stop 계열 persistence 는 누적 `수집된 자막` 목록만 source of truth 로 사용하며, fallback preview 는 안정 관측 뒤에만 materialize 합니다.
- popup / in-page panel 의 저장 가능 조건은 공통 `hasPersistableContent` 판정으로 통일되며, 이는 committed subtitle 존재 여부만 의미합니다.
- structured row snapshot에서는 stable row만 commit 이 일어나고, 같은 snapshot 안의 unstable row와 raw/container fallback은 preview 전용입니다.
- 하늘색 등 불투명 배경이나 background-image highlight 가 남아 있는 `인식 중` 자막은 미확정으로 보고 commit/persist/export 대상에서 제외합니다.
- replay queue 조회는 storage snapshot + memory snapshot 을 freshness 기준으로 merge 하며, 동시 queue insert 를 잃지 않아야 합니다.
- 회의명 파서는 trailing `|` branding 만 제거하고 날짜 / 회차 / 하이픈 텍스트는 유지합니다.
- subtitle visibility 판정은 `display:none`, `visibility:hidden`, `opacity:0`, zero-rect 를 모두 hidden 으로 간주하는 공통 helper 를 사용합니다.
- history full-library `JSON 백업` / `JSON 가져오기` 는 단계별 진행률과 취소를 지원하며, import cancel 은 partial completion 을 허용합니다.

## Sync Delta (2026-04-17)

Use this delta as part of the current operational baseline.

- running autosave는 committed subtitle이 있을 때만 동작해야 하며, preview-only / keepalive-only 상태로 빈 persisted `running` 세션을 만들면 안 됩니다.
- page-exit queue storage write가 content script에서 실패하면 background가 동일 stopped snapshot에 대해 durable queue write를 한 번 더 시도해야 합니다.
- history 에서 저장하지 않은 메모를 가진 채 새로고침 / `즐겨찾기만 보기` 전환을 하면서 폐기를 확인하면, dirty draft는 실제 저장값으로 즉시 되돌아가야 합니다.

## Sync Delta (2026-04-20)

Use this delta as part of the current operational baseline.

- subtitle layer activation/read state는 접근 가능한 frame 전체의 `#viewSubtit`, 자막 텍스트, visible control active 상태를 함께 집계하며, 성공 조건은 계속 `visible && (hasText || controlActive)` 입니다.
- capture diagnostics 는 `persistabilityState` / `persistabilityHint` 를 포함해야 하고, 상태 집합은 `idle`, `persistable`, `preview_only`, `unstable_only`, `filtered`, `duplicate` 로 고정됩니다.
- panel notice priority 는 `오류/액션 feedback -> 자동 조정/수동 클릭/reset 복구 -> preview-only 정보 -> idle` 순서를 유지합니다. options diagnostics 는 `persistabilityHint` 를 그대로 보여 줍니다.
- in-page `수집된 자막` 렌더는 최신 `liveLedgerMaxRows = 300` committed entry window 로 제한되지만, full session history, persistence, copy/export, JSON payload 는 전체 committed entry 를 계속 source of truth 로 사용합니다.
- full-library `JSON 백업` 은 page-wise incremental packaging 경로를 사용해야 하며, full-library backup/import 는 모두 `25 MiB` 를 넘으면 즉시 실패해야 합니다.
- download fallback 은 Blob URL 생성 실패 또는 Blob download 실패에서만 `data:` fallback 으로 내려가야 합니다. download 성공 뒤 metadata persist 실패만으로 중복 다운로드를 다시 열면 안 됩니다.
- popup 은 현재 window active tab 기준으로 재연결하고, diagnostics 는 `tabId` 대상이 사라지거나 unsupported 가 되면 다른 supported assembly tab 으로 fallback 해야 합니다.

## Sync Delta (2026-04-21)

Use this delta as part of the current operational baseline.

- session import sanitize 는 `sourceUrl` 에 대해 `isSupportedAssemblyUrl()` 검증을 강제하고, 미지원 URL은 항상 빈 문자열로 정규화해야 합니다.
- history `원본 페이지 열기`는 supported assembly URL일 때만 버튼 활성화/실행이 가능해야 하며, 클릭 핸들러에서도 같은 조건을 재검증해야 합니다.
- unconfirmed 필터로 container fallback 이 막힐 때 `blockedByUnconfirmedFilter` 신호를 유지하고, local polling / top fallback / injected observer 모두 `연속 6회` 차단 시 fallback 일시 허용 로직을 공통으로 써야 합니다.
- unconfirmed 차단 streak 는 자막 텍스트 재획득 시 즉시 0으로 리셋하고, neutral miss에서는 streak를 유지해야 합니다.
- container fallback 내부 raw는 비본회의에서 `4KB tail cap` 비교용 텍스트로 유지하고, 본회의에서는 full raw 를 보존합니다. UI preview는 `400자/3줄 tail` formatter로만 축약 노출해야 합니다.
- 단일 세션 export 는 하드 제한 없이 시도하며, runtime message 길이 초과/invalid data URL 계열 실패는 사용자 친화 메시지로 매핑해야 합니다.
- frame-forward nonce mismatch 발생 시 nonce resync와 빠른 top fallback probe를 즉시 트리거해 드롭 구간 복구를 우선해야 합니다.

## Sync Delta (2026-04-22)

Use this delta as part of the current operational baseline.

- content script/panel 은 `https://assembly.webcast.go.kr/main`, `https://assembly.webcast.go.kr/main/`, `https://webcast.assembly.go.kr/main`, `https://webcast.assembly.go.kr/main/`, 각 도메인의 `main/player*` 에서 로드됩니다. 홈(`main`/`main/`)에서는 패널/진단 UI만 먼저 보이고, 실제 capture start 는 player 페이지에서만 허용됩니다.
- runtime segmentation threshold(`maxEntriesPerSegment`, `maxCharsPerSegment`, `maxSegmentDurationMinutes`) 는 settings 로 저장되며 options 숫자 필드와 storage sanitize 최소값 정책을 공유합니다.
- options `수집 진단`은 `GET_DIAGNOSTICS_STATUS` 로 연결해 현재 segment threshold 사용량과 TXT/SRT/VTT/JSON 예상 export 크기를 표시합니다. popup/panel 기본 status 는 예상 export 크기를 계산하지 않습니다.
- lineage 전체 보기/export 는 history 와 background 조립 경로로 동작하며, single-session / lineage export 모두 대형 본문을 content runtime message 로 직접 보내지 않습니다.
- 매우 큰 export 는 offscreen Blob chunk 경로를 우선 사용하고, lineage export 는 segment별 분할 저장 액션을 제공해야 합니다. `data:` fallback 이 비현실적인 크기에서는 명시적 large-export 오류로 중단해야 합니다.

## Sync Delta (2026-04-28)

Use this delta as part of the current operational baseline.

- fallback-only text is conservatively materialized: the same normalized raw must be observed at least twice or remain stable for at least 400ms before it becomes a committed entry with `sourceCaptureMode: "fallback"`.
- Structured rows remain preferred. Stable structured rows clear pending fallback candidates and committed structured entries carry `sourceCaptureMode: "structured"`.
- Plenary fallback internal raw is preserved in full for diff/commit recovery, while non-plenary fallback internal raw keeps the 4KB tail cap. UI preview remains short via the `400자/3줄` tail formatter.
- Capture diagnostics include stable/unstable row counts, filtered unconfirmed count, row key source buckets, and fallback commit state.
- Content script bootstrap is idempotent across SPA URL transitions and stops/persists a running session before changing capture URL state.
- `ExtensionSettings.segmentPreset` controls segmentation thresholds. Presets are `stability`, `balanced`, `capacity`, and `custom`; direct numeric edits switch to `custom`.
- History list UX is lineage-first. Star/pin/note/delete/export actions apply to all segments in the selected lineage, while segment detail navigation remains available.
- Lineage export over the 8 MiB estimate exposes split download using segment file suffixes such as `segment-001`.
- Release verification includes `check:version` and `check:injected`; `npm run verify` runs those checks before lint/typecheck/test/build. `npm run test:e2e:extension` is the local Chrome extension smoke path.

## Sync Delta (2026-04-27)

Use this delta as part of the current operational baseline.

- JSON single-session export, backup sanitize, and import clone paths preserve `lineageId` and `segmentNumber`; older JSON without those fields remains importable.
- IndexedDB schema `5` adds a `lineageId` index, and migrations must fill lineage defaults for existing records.
- `listSessionLineageSegments()` should query and hydrate only the target lineage records. Fallback-aware page listing should calculate pages from metadata first and hydrate only the current page.
- Full-library JSON backup downloads must be started from the history page Blob URL helper, not via a large `DOWNLOAD_REQUEST.content` runtime message.
- `GET_DIAGNOSTICS_STATUS` is the only status request that should include TXT/SRT/VTT/JSON export estimates. Popup and panel status snapshots stay lightweight.
- `pendingPreviews` must be dropped from prepared session snapshots and must never be materialized into saved/exported entries.
- Offscreen Blob content chunking must remain surrogate-pair safe.
- Supported home URLs include both `/main` and `/main/` for both Assembly webcast hosts.

## Sync Delta (2026-03-14)

Use this delta as the current operational baseline.

- `startCapture()` must not create an empty persisted `running` session.
- If the current session has no persistable content, `stopCapture()` and reset-before-preserve flows must explicitly remove any existing persisted record for that session id.
- `saveSession()` and `updateRunningSession()` must preserve stored `starred`, `pinnedAt`, and `note` metadata. Only `upsertSessionRecord()` is the explicit overwrite path for those fields.
- page-exit stopped persistence must queue replay state before the background persist request is sent.
- `importSessionRecords()` now follows the same transient IndexedDB fallback policy as normal writes.
- History must use store-level paging through `listSessionsPage({ page, pageSize, starredOnly })`; do not reintroduce capped full-library preload behavior.
- Session-library writes now bump `SESSION_LIBRARY_REVISION_STORAGE_KEY`, and the history page must live-refresh off that signal.
- Same-session history refreshes must not clobber a dirty note draft.
- `CAPTURE_STATUS` is now a complete lightweight initial snapshot for popup/options hydration and must include `subtitleCount`, `charCount`, `previewText`, and `recentEntries`; export estimate calculation must remain opt-in.

<!-- SPECKIT-AGENT-GUIDE:START -->

## Spec Kit / Spec-Driven Development (AI 에이전트 필독)

> 이 블록은 GitHub Spec Kit 활성화 및 기능 명세 작업 결과를 AI 에이전트가 바로 쓰도록 정리한 안내입니다.
> 수정 시 마커 주석을 유지하세요. 스크립트/후속 세션이 이 구간을 갱신합니다.

### 이 저장소 상태

- **프로젝트**: `korea-assembly-cc-chrome`
- **Spec Kit 초기화**: `.specify/ 있음`
- **에이전트 스킬**: Grok=True, Claude=True, Codex/Agy(.agents)=True
- **활성 기능**: 아직 `specs/` 기능 명세 없음 — `.specify/` 만 준비된 상태

### 에이전트가 먼저 읽을 파일

1. `.specify/` 및 `.grok/skills` / `.claude/skills` / `.agents/skills` 의 `speckit-*`
2. 기능 작업 시작 시 `/speckit-specify` 로 `specs/00N-...` 생성

### 권장 워크플로 (스킬 / 슬래시 커맨드)

| 단계 | 커맨드 (Grok/Claude 등) | 산출 |
|------|-------------------------|------|
| 원칙 | `/speckit-constitution` | `.specify/memory/constitution.md` |
| 명세 | `/speckit-specify` | `specs/<id>/spec.md` |
| 계획 | `/speckit-plan` | `plan.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md` |
| 작업 | `/speckit-tasks` | `tasks.md` |
| 구현 | `/speckit-implement` | 코드 (tasks 순서) |
| 갭점검 | `/speckit-converge` | `tasks.md` 에 Phase Convergence **append-only** |

- Codex skills 모드: `$speckit-specify` 형태일 수 있음
- 스킬 파일: `.grok/skills/speckit-*/SKILL.md`, `.claude/skills/speckit-*/SKILL.md`

### 작업 규칙 (에이전트)

1. **새 기능/큰 변경 전** 활성 `spec.md`·`tasks.md` 를 읽고, 없으면 specify→plan→tasks 순으로 만든다.
2. **구현은 tasks.md 체크리스트**를 따른다. 완료 시 `- [ ]` → `- [x]`.
3. **`/speckit-converge` 는 tasks.md 를 rewrite 하지 않는다** — 잔여 갭만 하단 Phase 로 append.
4. brownfield 프로젝트는 상당 기능이 이미 있을 수 있다. 중복 구현 전에 코드·`[x]` 태스크를 확인한다.
5. 웹/데스크톱 패리티 등 **out-of-scope Assumptions** 는 새 feature 로 분리하는 것을 선호한다.
6. 기본 integration 은 **grok** 이며, 동일 레포에 claude / codex / agy 스킬도 multi-install 되어 있을 수 있다.

### 관련 링크

- Spec Kit: https://github.com/github/spec-kit
- 로컬 CLI: `specify` (uv tool, 버전은 `specify version`)

<!-- SPECKIT-AGENT-GUIDE:END -->
