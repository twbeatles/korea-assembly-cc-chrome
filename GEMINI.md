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
  - history 즐겨찾기 / 세션 메모 / 부분 선택 복사 / 부분 export / JSON 백업·복원
  - 패널 / popup 수집 진단 진입 + options 수집 진단 탭
  - 자막 우선 대형 미리보기 / 수집된 자막 2단 UI

## 3. 필수 명령

```bash
npm install
npm run lint
npm run typecheck
npm run test
npm run build
```

`npm run build` 는 `scripts/build-injected.mjs` 로 activation helper 번들(`public/injected-observer.js`)을 먼저 생성한 뒤 확장 번들을 만듭니다.

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

- `src/content/bootstrap/bootstrap-content-script.ts`
- `src/content/bootstrap/panel-controller.ts`
- `src/content/bootstrap/panel-ui.ts`
- `src/content/bootstrap/runtime-config.ts`
- `src/content/bootstrap/runtime-helpers.ts`
- `src/content/bootstrap/runtime-view.ts`
- `src/content/dom-probe.ts`
- `src/content/frame-probe.ts`
- `src/content/injected-observer.ts`
- `src/content/panel-live-rows.ts`
- `src/content/subtitle-dom.ts`
- `src/core/live-capture.ts`
- `src/core/subtitle-pipeline.ts`
- `src/core/noise-filter.ts`

### 4.3 저장 / 내보내기

- `src/storage/session-store.ts`
- `src/storage/session-store/operations.ts`
- `src/storage/session-store/db.ts`
- `src/storage/session-store/fallback.ts`
- `src/storage/session-store/normalize.ts`
- `src/storage/session-store/search.ts`
- `src/storage/session-backup.ts`
- `src/storage/settings-store.ts`
- `src/core/exporters/txt.ts`
- `src/core/exporters/srt.ts`
- `src/core/exporters/vtt.ts`
- `src/core/exporters/json.ts`
- `src/shared/capture-diagnostics.ts`

구조 메모:
- `src/content/content-script.ts`, `src/history/App.tsx`, `src/storage/session-store.ts`, `src/content/inpage-panel.ts` 는 facade 입니다.
- 실제 구현 본문은 `src/content/bootstrap/bootstrap-content-script.ts`, `src/history/components/HistoryPage.tsx`, `src/storage/session-store/operations.ts`, `src/content/inpage-panel/controller.ts` 기준으로 읽는 것이 맞습니다.

## 5. 메시지와 책임 분리

### popup -> content

- `OPEN_INPAGE_PANEL`
- `START_CAPTURE`
- `STOP_CAPTURE`
- `CLEAR_SESSION`
- `SAVE_SESSION`
- `EXPORT_REQUEST`

### background

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
- 본회의(`xcode=10` 또는 `xcgcd=DCM000010...`) container fallback 은 raw 누적 원문을 잘라내지 않습니다.
- 수집 시작 시 자막 레이어가 닫혀 있으면 DOM 클릭을 우선 시도하고, 필요할 때만 page function activation helper를 사용합니다.

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
- `로딩중..`, `로딩 중...`, `Loading...` placeholder는 noise filter 설정과 무관하게 commit/persist/export 대상에서 제외합니다.
- recent compact tail 로 과잉 재누적을 막습니다.
- 중복 차단 최소 길이 설정 키는 `recentDuplicateMinLength` 입니다.

### 6.4 keepalive / reset / finalize

- 동일 raw 유지 시 마지막 entry `endTime` 갱신
- `subtitle_reset` 시 live ledger 와 pipeline state 를 함께 완전 리셋
- stop 시 현재 state 기준으로 finalize
- 저장/export/unload/stop 직전 prepared snapshot 생성 경로는 `수집된 자막` 기준 snapshot을 사용

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
- `searchSessionsPage`
- `replayQueuedExitPersistRecords`
- `closeRunningSessionsOnStartup`

추가 UX 규칙:

- top frame 에 우측 패널이 자동 삽입됨
- popup 은 페이지 패널 다시 열기용 보조 화면
- popup 은 long-lived port 없이 현재 탭으로 request/response 명령만 보내며, content script 수신자가 없으면 새로고침 안내로 내려감
- 패널은 `실시간 내용`과 `수집된 자막` 2단으로 표시
- `수집된 자막`은 live ledger 기준 최근 row 누적 목록이며, preview-only 갱신만으로 목록 스크롤이 초기화되면 안 됨
- 본회의 fallback capture에서는 structured row가 비어 있어도 commit된 entry를 `수집된 자막` 목록으로 재구성해 누적 표시해야 함
- 복사 포맷은 `[HH:MM:SS] text`
- 페이지 패널과 history 모두 `recentCopyLineCount` 기반 최근 N줄 복사를 지원
- history 페이지는 열린 상태에서도 `recentCopyLineCount`, `filenamePattern`, `exportTxtWithoutTimestamps` 변경을 즉시 반영
- history 는 저장소 전체 transcript entry 본문 기준 `전체 기록 검색`을 지원하며, global query 와 session-local query 상태를 분리해야 함
- session record schema 는 `starred`, `pinnedAt`, `note` 를 포함하며 history 즐겨찾기/메모/JSON 백업·복원에서 그대로 유지
- history 는 `즐겨찾기만 보기`, 세션 메모 저장, entry 체크박스 기반 `선택한 항목 복사`, `선택 TXT/SRT/VTT/JSON` export, 전체 JSON 백업/가져오기를 지원
- history 전체 삭제 확인은 전체 preload 가 아니라 저장소 overview(count + preview) helper 기준으로 동작해야 함
- 전체 JSON 백업은 view-layer preload 대신 store helper export payload 를 사용해야 함
- `autoScroll` 이 꺼지면 `실시간 내용` / `수집된 자막` 강제 스크롤 금지
- autosave를 꺼도 `Stop` 시 최종 저장은 유지
- stopped 세션 최종 저장 실패 시 다음 시작/비우기 전에 1회 재시도 후, 계속 실패하면 폐기 확인
- page-exit stopped snapshot 은 replay queue 에 함께 적재되고, background 저장 성공 시 stale queued snapshot 을 정리해야 함
- startup 에서는 queued stopped snapshot replay -> stale running cleanup 순서를 유지해야 함
- replay / cleanup diagnostics 는 options `저장 복구 상태`에 노출됨
- replay queue 조회는 storage snapshot + memory snapshot merge여야 하며, 같은 `sessionId` 충돌 시 `updatedAt` 우선, 동률이면 늦은 `queuedAt`을 유지해야 함
- queue write 실패는 메모리 queue를 유지한 채 `lastQueueWriteError`로 기록하고, diagnostics는 `lastQueueWriteError`, `lastReplayError`, `lastCleanupError`, `lastError`를 함께 유지해야 함
- session import 는 allow-list sanitize 후 normalize 해야 하며, unsupported wrapper version / invalid timestamp 는 reject 해야 함
- 패널과 popup 은 `수집 진단` 화면 진입을 제공하고, capture mode, observer, selector, frame path, 최근 저장 시각, 저장 복구 상태는 options 의 `수집 진단` 탭에서 표시합니다. diagnostics view가 열려 있는 동안 `저장 복구 상태`는 `chrome.storage.onChanged`로 즉시 반영되어야 합니다.
- fallback/polling capture notice 는 실제 수집이 이어질 때 중립적 “수집 중 + 자동 조정” 톤을 유지해야 함
- popup `SAVE_SESSION`, 패널 `저장/복사/내보내기`, `beforeunload` 경고, pagehide/visibilitychange 저장 시도는 모두 prepared snapshot 기준 `canPersistPreparedContent`로 정렬되어야 함. raw preview만 남아 있고 prepared entry가 비면 저장 가능 상태로 취급하면 안 됨
- 패널 `화면 비우기`는 저장 가능 여부와 별개로 현재 화면에 보이는 runtime 내용이 있으면 계속 허용해야 함
- subtitle auto activation 성공은 `visible && (hasText || controlActive)`로 판정해야 함
- options 숫자 필드는 draft string + inline validation 패턴을 유지해야 함

## 8. exporter 규칙

- `TXT`: 기본값은 타임스탬프 제외(`text`)이며, 옵션에서 포함 시 `[HH:MM:SS] text`
- `SRT`: `HH:MM:SS,mmm`, 세션 시작 기준 상대 시간
- `VTT`: `HH:MM:SS.mmm`, 세션 시작 기준 상대 시간
- `JSON`: 세션 전체 복원 가능한 구조
- export/copy 단계에서는 추가 후단 정규화를 적용하지 않고 `수집된 자막` 기준 snapshot을 그대로 사용합니다.
- 다운로드는 `offscreen Blob URL` 우선, 실패 시 `data:` URL fallback

## 9. known limits

- 국회 사이트 DOM 변경 시 selector / observer 안정성이 달라질 수 있습니다.
- cross-origin frame 은 직접 DOM 접근이 제한될 수 있습니다.
- observer 실패 시 polling fallback 의존도가 높아질 수 있습니다.
- 영상 캡처, 중요 표시, 발언자 편집은 현재 범위 밖입니다.

## 10. 작업 원칙

- crash 보다 fallback 이 우선입니다.
- popup 종료와 수집 중단을 연결하면 안 됩니다.
- `legacy/` 는 로컬 참조 아카이브일 수 있지만 Git 추적 대상으로 전제하면 안 됩니다.
- page-world observer bridge, frame forwarding, nonce 동기화 계층은 재도입하지 않습니다.
- 변경 후에는 가능하면 `lint`, `typecheck`, `test`, `build` 를 모두 실행합니다.

## Sync Delta (2026-04-03)

Use this delta as the current operational baseline.

- 위원회명 파싱은 `src/content/committee-name.ts` 의 보수적 suffix 제거 규칙을 사용해야 하며, 일반 제목의 하이픈/날짜를 잘라내면 안 됩니다.
- subtitle visibility 판정은 `hidden`, `display:none`, `visibility:hidden`, `opacity:0`, zero-size 를 함께 반영하는 공통 helper 기준으로 맞춰야 합니다.
- selector profile(`default | committee | plenary`)은 `src/content/subtitle-dom.ts` 단일 기준으로 유지해야 하며, probe/observer/fallback 간 selector 의미론이 갈라지면 안 됩니다.
- 전체 기록 검색은 `searchSessionsPage()` 기반 transcript full scan + case-insensitive substring 의미론을 유지합니다.
- 2026-04-03 이후 구조는 facade + internal module 분리 기준이므로, 새 기능은 `content-script.ts`/`session-store.ts` 같은 facade 파일로 다시 몰아넣지 않습니다.

## Sync Delta (2026-03-26)

Use this delta as the current operational baseline.

- 내보내기/복사 기준 데이터는 패널 `수집된 자막` 목록과 같은 snapshot 경로를 사용해야 합니다.
- `session-store` export 경로에서는 `normalizeSessionForExport` 기반 후단 정규화를 적용하지 않습니다.
- `TXT` 내보내기는 `exportTxtWithoutTimestamps` 옵션을 지원하고 기본값은 `true`(타임스탬프 제외)입니다.
- 장시간 세션에서는 화면/내보내기 데이터는 무제한 유지하고, 내부 state cache만 주기 압축합니다.

## Sync Delta (2026-04-01)

Use this delta as the current operational baseline.

- fallback 세션 조회는 `chrome.storage.local` index만 신뢰하지 않고 storage snapshot + memory snapshot union을 사용해야 합니다.
- `IndexedDB`와 `chrome.storage.local` write가 모두 실패한 경우에도 같은 런타임 안에서는 memory-only fallback 세션이 history/list/overview에서 계속 보여야 합니다.
- queued exit persist CRUD(`queue/list/clear`)는 직렬화되어야 하며, storage read 중 새 memory queue가 추가되어도 기존 메모리 레코드가 지워지면 안 됩니다.
- popup 저장 버튼, 패널 저장/복사/내보내기, unload 경고는 prepared snapshot 기준 `canPersistPreparedContent`를 사용해야 합니다.
- 패널 `화면 비우기`는 visible runtime content가 있으면 계속 허용해야 하며, 저장 가능 여부와 동일하게 묶으면 안 됩니다.
- options `저장 복구 상태`는 diagnostics view가 열려 있는 동안 `chrome.storage.onChanged`로 live sync 되어야 합니다.

## Sync Delta (2026-04-06)

Use this delta as the current operational baseline.

- top frame content script 가 single-owner capture coordinator 를 유지하고, 접근 가능한 same-origin frame document 를 직접 probe/observe 합니다.
- page-world helper 는 activation 전용이며, observer bridge / frame forwarding / nonce 동기화 계층은 사용하지 않습니다.
- replay queue는 storage + memory merge 기준으로 읽고, storage write failure 뒤에도 메모리 queue를 유지해야 합니다.
- options `저장 복구 상태`는 queue write / replay / cleanup 오류를 개별적으로 보여 주고, diagnostics view가 열려 있는 동안 storage 변경을 즉시 반영해야 합니다.
- popup 저장 버튼은 prepared snapshot 기준 persistable content가 없으면 비활성화되고, 빈 저장은 `저장할 자막이 아직 없습니다.` 피드백으로 일관되게 처리되어야 합니다.
- subtitle auto activation 성공은 `visible && (hasText || controlActive)` 조건을 충족할 때만 인정됩니다.

## Sync Delta (2026-03-20)

Use this delta as the current operational baseline.

- 본회의(`xcode=10` / `xcgcd=DCM000010...`) container fallback은 `실시간 내용` 누적 원문을 그대로 유지해야 합니다.
- 본회의 fallback capture에서는 structured live row가 비어 있어도 commit된 entry를 `수집된 자막` 목록으로 계속 보여 주어야 합니다.
- `로딩중..`, `로딩 중...`, `Loading...` placeholder는 noise filter 토글과 무관하게 commit/persist/export 대상에서 제외되어야 합니다.

## Sync Delta (2026-03-12)

Use this delta as the current operational baseline.

- Preview-only runtime text may remain visible in the panel, but save/export/pagehide/beforeunload/stop snapshots must only persist prepared entries.
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
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:coverage`
  - `npm run build`
  - `npm run verify` for full pre-release checks.

## Addendum Closure (2026-03-11)

## Sync Delta (2026-03-16)

Use this delta as the current operational baseline.

- `listSessionsPage({ page, pageSize, starredOnly })` now uses IndexedDB-level paging when fallback session records are absent, but must preserve the existing merged path when fallback records exist.
- Session ordering remains `starred` first, then `pinnedAt || updatedAt` descending for starred sessions, then `updatedAt` descending, then `id`.
- `deleteAllSessions()` must attempt IndexedDB and fallback cleanup independently and surface partial-failure detail when only one store fails.
- `filenamePattern` now rejects forbidden path characters and unsupported placeholders, and invalid stored values are sanitized back to the default pattern.
- The in-page `최근 N줄 복사` action now uses the prepared cumulative session snapshot instead of transient live rows, so it matches history semantics.
- History long-running actions lock related controls through a shared busy state while preserving search and note editing.
- Options tests and inputs now rely on accessible field labels instead of display-text-only selectors.

Keep this file aligned with the implementation closure below:

- Top-frame DOM coordinator simplification: completed.
- Activation-only injected helper reduction: completed.
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

- popup command feedback must explicitly surface `OPEN_INPAGE_PANEL` results.
- session import summaries now include `failedCount`.
- supported hosts are fixed to both `assembly.webcast.go.kr` and `webcast.assembly.go.kr`.
- options field exposure is now declared in code and covered by regression tests.

## Sync Delta (2026-03-23)

Use this delta as the current operational baseline.

- `ensureSubtitleLayerActive` 성공 판정은 `layer.visible` 단독이 아니라 `layer.visible && (layer.hasText || layer.controlActive)` 조건을 충족할 때만 인정합니다. 이전에는 `visible`만 체크해 텍스트나 control 신호가 없어도 성공으로 처리하던 버그가 수정되었습니다.
- `saveCurrentSessionSnapshot`에 2단계 guard가 추가되었습니다. pre-flush 단계에서 `entries.length === 0 && previewText.trim() === ""`이면 즉시 반환하고, post-flush 단계에서 `record.entries.length === 0`이면(noise-only previewText가 flush 후 필터링된 경우) 빈 저장을 막습니다. popup/패널 저장 가능 여부와 unload 계열 guard는 raw preview 유무가 아니라 prepared snapshot 기준 `canPersistPreparedContent`와 정렬됩니다.
- noise-only `previewText`(숫자/기호만 포함)는 flush 후 entries가 0개가 되어 최종 저장 guard에서 걸립니다. `shouldPersistFinalSession(true, 0)` → `false` 동작이 regression test로 보장됩니다.

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
- `GET_STATUS` response snapshot is the complete initial payload for popup/options hydration and must include `subtitleCount`, `charCount`, `previewText`, and `recentEntries`.
