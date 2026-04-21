# AI Context: Korea Assembly CC Chrome

이 문서는 다음 세션의 AI 에이전트가 현재 저장소를 빠르게 파악하고, Chrome Extension 코드베이스를 안전하게 수정하기 위한 루트 컨텍스트입니다.

## 1. 현재 프로젝트 상태

- 이 저장소의 활성 구현은 `Chrome Extension (Manifest V3) + TypeScript + React + Vite` 입니다.
- 과거 `PyQt6 + Selenium` 데스크톱 앱은 `legacy/` 아래 아카이브 대상으로 분리되어 있으며, 현재 작업 대상이 아닙니다.
- 최우선 기능은 `국회 AI 자막 추출`, `세션 저장`, `TXT / SRT / VTT / JSON 내보내기` 입니다.
- 현재 주 UI 는 `사이트 안 우측 패널`이며, popup 은 `페이지 패널 열기 / 저장된 기록 / 환경 설정 / 수집 진단` 중심의 보조 화면입니다.
- 현재 UI 보강 범위에는 `우측 패널 실시간 표시`, `history 기록 내부 검색/복사`, `최근 N줄 복사`, `history 즐겨찾기/세션 메모`, `entry 체크박스 기반 부분 복사/부분 export`, `전체 JSON 백업/복원`, `autosave 설정/최근 저장 시각 진단`, `autoScroll 옵션 반영`, `자막 우선 대형 미리보기`, `실시간 내용 / 수집된 자막 2단 구성`, `패널/popup 수집 진단 진입`, `즉시 노출되는 내보내기 버튼`이 포함됩니다.
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
      panel-live-rows.ts
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
- 본회의(`xcode=10` 또는 `xcgcd=DCM000010...`) container fallback 은 raw 누적 원문을 잘라내지 않습니다.

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
- 수동 저장 / export 는 현재 패널에 보이는 확정 `수집된 자막` row 만 직렬화하며, preview-only 텍스트는 저장 대상으로 materialize 하지 않습니다.
- unload / stop / page-exit 계열 prepared snapshot 생성 경로도 preview-only 텍스트를 clone state entry 로 승격하지 않고, 확정 entry 만 저장합니다.
- structured row snapshot 안에 stable/unstable row가 섞여 있으면 stable row subset만 commit 대상으로 내려가고, unstable row는 preview-only로 남겨야 합니다.

## 6. noise filtering 규칙

- `noiseFilterEnabled = true` 일 때만 아래 규칙으로 숫자-only / 기호-only를 차단합니다.
- 허용:
  - 한글 1~2글자
  - 영문 1~2글자
- 차단:
  - 숫자-only
  - 기호-only
- noise filter 설정과 무관하게 `로딩중..`, `로딩 중...`, `Loading...` placeholder는 commit/persist/export 대상에서 제외합니다.
- `noiseFilterEnabled = false` 이면 숫자-only / 기호-only도 통과시킵니다.
- 기본 언어 판정은 한글/영문 중심입니다. 외국어 텍스트 지원 확대는 이번 배치 범위에 포함하지 않았으며, raw foreign text 를 최대한 남기려면 noise filter 를 꺼야 합니다.
- 중복 차단 최소 길이 설정 키는 `recentDuplicateMinLength` 입니다.

## 7. exporter / persistence 규칙

### 7.1 Exporter

- `TXT`: `[HH:MM:SS] text`
- `SRT`: 세션 시작 기준 상대 시간, `HH:MM:SS,mmm`
- `VTT`: 세션 시작 기준 상대 시간, `HH:MM:SS.mmm`
- `JSON`: 세션 전체 복원 가능한 구조
- 수동 `saveSession` / `exportSessionData` 경로는 현재 패널에 보이는 확정 `수집된 자막` 목록만 사용하며, preview-only 항목으로 내려가지 않습니다.
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
- `loadSessionsByIds`
- `getSessionLibraryOverview`
- `buildSessionLibraryBackupExport`
- `replayQueuedExitPersistRecords`
- `closeRunningSessionsOnStartup`

위 CRUD 흐름과 startup cleanup 의미론은 유지해야 합니다.

- record payload version 과 IndexedDB schema version 은 분리해서 관리합니다.
- 현재 session record schema 는 `version = "3"` 기준이며 `starred`, `pinnedAt`, `note` 필드를 포함합니다.
- `loadSession`/`listSessions` 는 IndexedDB + fallback 을 함께 읽고 `updatedAt` 기준으로 더 최신 레코드를 고릅니다. 동률이면 IndexedDB 를 우선합니다.
- 개별 IndexedDB transaction/read/write 실패는 현재 연산만 fallback 으로 우회하고, 런타임 전체 disable 은 open/capability failure 에만 허용됩니다.
- 성공한 IndexedDB write/delete 는 동일 id fallback copy 를 best-effort 로 정리합니다.
- page-exit 시점의 stopped 스냅샷은 세션별 replay queue 에 함께 적재되고, background 저장 성공 시 해당 세션의 stale queued snapshot 을 정리합니다.
- startup 에서는 queued stopped snapshot replay 를 먼저 수행하고, 그 다음 persisted running session cleanup 을 수행합니다.
- replay / cleanup 결과는 `chrome.storage.local` diagnostics snapshot 으로 저장되며 options `저장 복구 상태`에 노출됩니다.
- `closeRunningSessionsOnStartup` 는 숫자 하나가 아니라 `detected / closed / failed` 요약을 반환해야 합니다.
- JSON import 는 raw session spread 가 아니라 allow-list sanitize 후 normalize 순서를 유지해야 하며, unsupported wrapper version 과 invalid timestamp 는 reject 해야 합니다.
- import 경계에서는 incoming `running` 세션을 모두 `saved` 로 정규화해 실제로 종료된 기록이 stale `수집 중` 상태로 남지 않게 해야 합니다.

### 7.3 UX 보강 규칙

- top frame 의 content script 가 우측 패널을 자동으로 삽입합니다.
- 기본 상태는 `펼쳐짐` 이고, 접으면 오른쪽의 `자막 보기` 탭만 남습니다.
- popup 의 `OPEN_INPAGE_PANEL` 명령은 접힌 패널을 다시 엽니다.
- popup 은 기존 탭에서 content script 수신자가 없으면 재주입을 시도하고, 실패 시 새로고침 안내로 내려갑니다.
- 패널은 `실시간 내용`과 `수집된 자막` 2단으로 보입니다.
- `수집된 자막` 목록은 현재 active row만 번쩍 보여 주는 뷰가 아니라, live ledger 기준 최근 row가 누적되는 뷰를 유지합니다.
- 본회의 fallback capture에서는 structured row가 비어 있어도 이미 commit된 entry를 `수집된 자막` 목록으로 재구성해 누적 표시합니다.
- 같은 row key 의 갱신은 라이브 목록 DOM 노드를 재사용해 제자리 수정합니다.
- history 복사 포맷은 기본적으로 `[HH:MM:SS] text` 줄단위입니다.
- 페이지 패널과 history 모두 `recentCopyLineCount` 기반 `최근 N줄 복사`를 지원합니다.
- history 페이지는 열린 상태에서도 `recentCopyLineCount`, `filenamePattern` 변경을 `chrome.storage.onChanged` 로 즉시 반영합니다.
- history 의 `전체 삭제` 는 현재 로드된 1000건만이 아니라 저장소 전체를 비워야 하며, 선택 삭제는 부분 성공/실패 요약을 남긴 뒤 항상 refresh 해야 합니다.
- history 는 session-level `즐겨찾기`, `메모`, `즐겨찾기만 보기` 필터를 제공하고, 이 메타데이터는 persistence 및 JSON 백업/복원에서 함께 보존되어야 합니다.
- history 의 즐겨찾기/메모 저장은 전용 `updateSessionMetadata(sessionId, patch)` 경로를 사용해야 하며, stale detail snapshot 이 `entries` / `subtitleCount` / `status` 를 되돌리면 안 됩니다.
- history detail 은 entry 체크박스 기반 `선택한 항목 복사`, `선택 TXT/SRT/VTT/JSON export` 를 제공하며, 선택 export 의 시간 기준은 원본 세션 시작 시각 기준 상대 시간 의미론을 유지해야 합니다.
- history 상단은 전체 저장소 기준 `JSON 백업` 과 단일 세션/번들 `JSON 가져오기` 를 지원하며, 가져오기는 같은 `id` 충돌 시 더 최신 `updatedAt` 레코드를 유지합니다.
- history 의 전체 JSON 백업 / JSON 가져오기는 현재 단계와 진행량을 표시하고 취소를 지원해야 합니다. JSON import read phase 와 backup package phase 도 abort-aware 여야 하며, 가져오기 취소는 이미 저장된 부분 완료 레코드를 rollback 하지 않습니다.
- history 의 전체 삭제 확인은 전체 세션 preload 가 아니라 `정확한 총 건수 + 최대 3건 preview` 기준으로 보여 줘야 합니다.
- history 의 전체 JSON 백업은 view layer preload 가 아니라 store helper export payload 를 사용해야 합니다.
- `autoScroll` 옵션이 꺼지면 패널의 `실시간 내용` / `수집된 자막` 영역을 강제 스크롤하지 않습니다.
- autosave는 옵션에서 켜고 끌 수 있지만 `Stop` 시 최종 저장은 항상 유지합니다.
- stopped 세션 최종 저장이 실패하면 다음 `자막 모으기`/`화면 비우기` 전에 저장을 1회 재시도하고, 재시도도 실패할 때만 폐기 확인을 표시합니다.
- replay queue 조회는 `chrome.storage.local` snapshot과 메모리 snapshot을 merge 해야 하며, 같은 `sessionId` 충돌 시 `record.updatedAt` 우선, 동률이면 `queuedAt`이 더 늦은 쪽을 유지해야 합니다.
- queue write 실패는 메모리 queue를 지우면 안 되며, diagnostics는 `lastQueueWriteError`, `lastReplayError`, `lastCleanupError`, `lastError`로 phase별로 남겨야 합니다.
- capture notice 는 기본 idle 안내만 숨기고, `정상 수집`, `자동 조정 중 수집`, `reset 복구 중`, 수동 클릭 안내, 오류/액션 피드백을 실제 텍스트로 사용자에게 드러내야 하며, fallback/polling 경로에서도 실제 수집이 이어질 때는 과도한 장애 경고 문구를 피해야 합니다.
- 패널과 popup 은 `수집 진단` 화면 진입 버튼을 제공하고, 실제 수집 방식(`structured`/`fallback`/`polling`), observer 활성 여부, selector, frame path, 최근 저장 시각, 저장 복구 상태는 options 페이지의 `수집 진단` 탭에서 표시합니다.
- popup `SAVE_SESSION`은 패널과 같은 `hasPersistableContent` 판정으로만 활성화해야 합니다. 즉 누적 `수집된 자막`이 1건 이상 있을 때만 허용되며, preview-only fallback 은 저장 가능 조건에 포함하지 않습니다. 빈 저장 요청은 패널/popup 모두 `저장할 자막이 아직 없습니다.`로 응답해야 합니다.
- in-page panel `화면 비우기` 는 `hasPersistableContent` 와 별도 gating 을 사용해야 하며, running 상태이거나 preview/notice 가 남아 있을 때도 수동 reset 을 허용해야 합니다.
- 자막 자동 활성화 성공은 `visible && (hasText || controlActive)`를 만족할 때만 인정해야 합니다.
- options 숫자 필드는 canonical number state 와 별도 draft string state 를 유지하고, invalid draft 는 inline field error 로 표시하며 저장을 막아야 합니다.
- 옵션 숫자 설정은 모두 정수만 허용해야 하며, UI `step=1` 과 storage sanitize 최소값 정책이 일치해야 합니다.

## 8. 작업 시 주의사항

- popup 이 닫혀도 수집이 멈추면 안 됩니다.
- Selenium / PyQt 구조를 다시 가져오면 안 됩니다.
- `legacy/` 는 로컬 참조용 아카이브일 수 있지만 Git 추적 대상으로 전제하면 안 됩니다.
- storage 실패, observer 실패, frame 접근 실패, selector 미탐색은 크래시 대신 fallback 으로 내려가야 합니다.
- export 는 `offscreen Blob URL` 우선, 실패 시 `data:` URL fallback 을 유지합니다.
- frame forwarding 은 탭 단위 storage-backed nonce 검증을 통과한 메시지만 top frame 에서 수용해야 하며, content script는 주기 재동기화와 mismatch 즉시 resync를 유지해야 합니다.
- 코드 수정 후 가능하면 `lint`, `typecheck`, `test`, `build` 를 모두 확인합니다.

## 9. 관련 문서

- 메인 설명: `README.md`
- 배포 절차: `DEPLOYMENT.md`
- 스토어 권한 문안: `CHROME_WEB_STORE_PERMISSION_JUSTIFICATIONS.md`
- 개인정보 처리 초안: `PRIVACY_POLICY_DRAFT_KO.md`

## Sync Delta (2026-04-13)

When editing this repository, align with the newly implemented behavior below.

- structured row snapshot 안에 stable/unstable row가 함께 있어도 stable row만 commit 하고, unstable row는 preview-only 로 남깁니다.
- `importSessionRecords()` 는 incoming `running` 상태를 모두 `saved` 로 정규화합니다.
- export filename safety sanitize 는 남아 있는 금지 문자를 첫 1회가 아니라 전체 제거해야 합니다.
- options / storage numeric settings 는 정수만 허용하며, 소수 입력은 저장 불가입니다.
- 기본 회귀 검증은 `npm run lint`, `npm run typecheck`, `npm run test`, `npm run test:coverage`, `npm run build` 기준으로 유지합니다.

## Sync Delta (2026-03-23)

When editing this repository, align with the bug fixes below.

- `ensureSubtitleLayerActive` 반환값이 `layer.visible` 단독 → `layer.visible && (layer.hasText || layer.controlActive)` 로 수정되었습니다. 이 조건은 CLAUDE.md 의 subtitle auto activation 성공 판정 기준과 일치합니다.
- `saveCurrentSessionSnapshot` / `exportCurrentSession` 은 prepared snapshot 을 그대로 쓰지 않고, 현재 패널에 보이는 `수집된 자막` row 를 우선 직렬화합니다.
  - row 가 있으면 그 목록이 그대로 저장 / 내보내기 payload 가 됩니다.
  - row 가 없고 preview 만 있으면 placeholder / noise / duplicate 제거 뒤에도 의미가 남을 때만 현재 `실시간 내용` preview 를 단일 항목으로 저장합니다.
  - 둘 다 없을 때만 저장 / export 불가 상태로 남습니다.
- popup 버튼 활성화 조건은 `subtitleCount` / `previewText` 단순 판정이 아니라 `hasPersistableContent` 기준으로 통일됩니다.

## Sync Delta (2026-03-20)

When editing this repository, align with the newly implemented behavior below.

- 본회의(`xcode=10` / `xcgcd=DCM000010...`) container fallback은 `실시간 내용` 누적 원문을 그대로 유지해야 합니다.
- 본회의 fallback capture에서는 structured live row가 비어 있어도 commit된 entry를 `수집된 자막` 목록으로 계속 보여 주어야 합니다.
- `로딩중..`, `로딩 중...`, `Loading...` placeholder는 noise filter 토글과 무관하게 commit/persist/export 대상에서 제외되어야 합니다.

## Sync Delta (2026-03-19)

When editing this repository, align with the newly implemented behavior below.

- frame-forward nonce는 탭 단위 `chrome.storage.local` source를 기준으로 유지되며, 탭 `loading` 시 회전하고 탭 제거 시 정리합니다.
- 모든 content script는 bootstrap 시 nonce를 받고 15초마다 재동기화하며, forwarded frame message nonce mismatch는 현재 이벤트를 버리고 즉시 resync 해야 합니다.
- replay queue는 storage와 memory를 merge 해서 읽고, storage write failure 뒤에도 같은 런타임의 memory queue를 보존해야 합니다.
- options `저장 복구 상태`는 queue write / replay / cleanup 오류를 개별 행으로 노출해야 하며 `lastError`는 요약 필드로만 유지합니다.
- popup 저장 버튼은 persistable content가 있을 때만 활성화되며, 빈 저장 요청은 `저장할 자막이 아직 없습니다.` 피드백으로 일관되게 처리해야 합니다.
- subtitle auto activation 성공은 `visible && (hasText || controlActive)` 조건을 충족할 때만 인정하고, 그 외에는 수동 클릭 안내 notice로 내려가야 합니다.

## Sync Delta (2026-03-12)

When editing this repository, align with the newly implemented behavior below.

- Manual save/export must serialize only committed visible `수집된 자막` rows.
- Pagehide/beforeunload/stop snapshots must persist committed entries only and must not materialize preview-only text.
- Failed stopped-session persistence must retry before destructive continuation and require explicit discard confirmation only after the retry fails.
- Session storage reads must merge IndexedDB and fallback records, while successful IndexedDB writes heal stale fallback copies.
- History view must live-sync `recentCopyLineCount` and `filenamePattern` while the page remains open.
- The in-page `수집된 자막` list must accumulate recent live rows and must not jump-scroll on preview-only updates.
- History now persists session favorites/notes, supports partial copy/export, and supports JSON backup/import with freshest-`updatedAt` conflict resolution.
- Panel and popup now expose runtime capture diagnostics (mode, observer, selector, frame path).
- Local polling change-detection work stays test-first; use the regression scaffold before broadening heuristics.

## Sync Delta (2026-03-13)

When editing this repository, align with the newly implemented behavior below.

- page-exit stopped snapshots now enqueue replay records, and startup replays them before stale running cleanup.
- replay / cleanup summaries are persisted as diagnostics and surfaced in options `저장 복구 상태`.
- session import now sanitizes allow-listed fields and rejects unsupported wrapper versions or invalid timestamps.
- history full-delete confirmation now uses count + preview, and full-library JSON backup uses store-level export helpers.
- popup / history async actions must always leave a user-facing error message when they fail.
- options numeric settings now use draft-string validation rather than mutating canonical numbers on every keystroke.

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

Current closure status:

- Bridge token verification: completed.
- Frame-forward nonce rotation: completed.
- Unconfirmed fallback consistency: completed.
- Fallback probe backoff + cached frame path: completed.
- Invalidated context shutdown path: completed.
- Offscreen duplicate-create tolerance: completed.
- Subtitle row style-cost tuning: completed.
- Focused regression tests added for probe/bridge paths.

## 2026-03-12 Additional Sync Update

- content -> popup messaging now also includes `POPUP_FEEDBACK`.
- popup command feedback must explicitly surface `OPEN_INPAGE_PANEL` results.
- session import summaries now include `failedCount`.
- supported hosts are fixed to both `assembly.webcast.go.kr` and `webcast.assembly.go.kr`.
- options field exposure is now declared in `settings-fields.ts` and covered by regression tests.

## 2026-03-14 Sync Update

When editing this repository, align with the newly implemented behavior below.

- `startCapture()` must not create an empty persisted `running` session.
- If the current session has no persistable content, `stopCapture()` and reset-before-preserve flows must explicitly remove any existing persisted record for that session id.
- `saveSession()` and `updateRunningSession()` must preserve stored `starred`, `pinnedAt`, and `note` metadata. Only `upsertSessionRecord()` is the explicit overwrite path for those fields.
- page-exit stopped persistence must always queue replay state before sending the background persist request.
- `importSessionRecords()` now follows the same transient IndexedDB fallback policy as normal writes.
- History must use store-level paging through `listSessionsPage({ page, pageSize, starredOnly })`; do not reintroduce full-library preload with an arbitrary cap.
- Session-library writes/deletes/imports/startup cleanup now bump `SESSION_LIBRARY_REVISION_STORAGE_KEY`, and the history page must live-refresh off that signal.
- History detail may load a selected session outside the current page, and same-session refreshes must not clobber a dirty note draft.
- `CAPTURE_STATUS` is now a complete initial snapshot for popup/options hydration and must include `subtitleCount`, `charCount`, `previewText`, and `recentEntries`.

## 2026-03-16 Sync Update

When editing this repository, align with the newly implemented behavior below.

- `listSessionsPage({ page, pageSize, starredOnly })` now uses store-level paging semantics. When fallback records are absent, the primary path is IndexedDB paging/index based; when fallback records exist, keep correctness-first merged paging behavior.
- Session ordering semantics remain fixed as `starred first -> pinnedAt || updatedAt desc -> updatedAt desc -> id`.
- `deleteAllSessions()` now attempts IndexedDB and fallback cleanup independently and may report partial-failure detail even when one backend was cleared successfully.
- `filenamePattern` validation is now strict: only `{date}`, `{time}`, `{committee}` placeholders are supported, forbidden filename characters are rejected in options, invalid stored values sanitize back to default, and export filename generation performs a final safety sanitize.
- In-page `최근 N줄 복사` must now match history semantics and copy from the prepared cumulative session snapshot, not temporary live-row timestamps.
- History long-running actions now keep the existing busy lock for 일반 작업 while full-library `JSON 백업` / `JSON 가져오기` expose dedicated progress + cancel state and only lock the JSON task controls.
- History favorite/note writes must use metadata-only updates against the latest stored session record; do not re-save stale detail snapshots through `upsertSessionRecord()`.
- Full-library backup packaging and JSON import file reads must remain cooperative and abort-aware even for large payloads.

## Sync Delta (2026-04-07)

When editing this repository, align with the newly implemented behavior below.

- `수집된 자막` 목록은 bounded live ledger 와 별개로 세션 전체 누적 committed subtitles 를 보여 주는 뷰입니다. `liveLedgerMaxRows = 300` 은 reconciliation cap 일 뿐 저장/export 기준이 아닙니다.
- 수동 저장 / export 와 pagehide/beforeunload/stop 계열 persistence 는 누적 `수집된 자막` 목록만 source of truth 로 사용하며, preview-only fallback 은 materialize 하지 않습니다.
- popup / in-page panel 의 저장 가능 조건은 공통 `hasPersistableContent` 판정으로 통일되며, 이는 committed subtitle 존재 여부만 의미합니다.
- structured row snapshot에서는 stable row만 commit 이 일어나고, 같은 snapshot 안의 unstable row와 raw/container fallback은 preview 전용입니다.
- 하늘색 등 불투명 배경이나 background-image highlight 가 남아 있는 `인식 중` 자막은 미확정으로 보고 commit/persist/export 대상에서 제외합니다.
- `listQueuedExitPersistRecords()` 는 storage snapshot + memory snapshot 을 freshness 기준으로 in-place merge 하며, 동시 queue insert 를 잃지 않아야 합니다.
- 회의명 파서는 trailing `|` branding 만 제거하고 날짜 / 회차 / 하이픈 텍스트는 유지해야 합니다.
- subtitle visibility 판정은 `display:none`, `visibility:hidden`, `opacity:0`, zero-rect 를 모두 hidden 으로 간주하는 공통 helper 를 사용합니다.
- history full-library `JSON 백업` / `JSON 가져오기` 는 단계별 진행률과 취소를 지원합니다. import cancel 은 partial completion 을 허용하며 rollback 하지 않습니다.
- Options numeric-field tests now query accessible field names instead of concatenated label+unit strings.

## Sync Delta (2026-04-17)

When editing this repository, align with the newly implemented behavior below.

- running autosave는 committed subtitle이 있을 때만 동작해야 하며, preview-only / keepalive-only 상태로 빈 persisted `running` 세션을 만들면 안 됩니다.
- page-exit queue storage write가 content script에서 실패하면 background가 동일 stopped snapshot에 대해 durable queue write를 한 번 더 시도해야 합니다.
- history 에서 저장하지 않은 메모를 가진 채 새로고침 / `즐겨찾기만 보기` 전환을 하면서 폐기를 확인하면, dirty draft는 실제 저장값으로 즉시 되돌아가야 합니다.

## Sync Delta (2026-04-20)

When editing this repository, align with the newly implemented behavior below.

- subtitle layer activation/read state는 접근 가능한 frame 전체의 `#viewSubtit`, 자막 텍스트, visible control active 상태를 함께 집계합니다. 성공 조건 자체는 계속 `visible && (hasText || controlActive)` 입니다.
- capture diagnostics는 `persistabilityState` 와 `persistabilityHint` 를 포함해야 하며, 허용 상태 집합은 `idle`, `persistable`, `preview_only`, `unstable_only`, `filtered`, `duplicate` 입니다.
- panel notice 우선순위는 `오류/액션 feedback -> 자동 조정/수동 클릭/reset 복구 -> preview-only 정보 -> idle` 순서를 유지해야 합니다. options diagnostics 는 `persistabilityHint` 를 그대로 노출해야 합니다.
- in-page `수집된 자막` 렌더는 최신 `liveLedgerMaxRows = 300` committed entry window 로 제한됩니다. full session history, persistence, copy/export, JSON payload 는 여전히 전체 committed entry 목록을 source of truth 로 사용합니다.
- full-library `JSON 백업` 은 전체 preload 대신 page-wise incremental packaging 을 유지해야 하며, full-library backup/import 는 모두 `25 MiB` 를 초과하면 명시적으로 실패해야 합니다.
- download fallback 은 3단계 경계를 유지해야 합니다. Blob URL 생성 실패 또는 Blob download 실패일 때만 `data:` fallback 으로 내려가고, download 성공 뒤 metadata persist 실패만으로는 재다운로드를 트리거하면 안 됩니다.
- popup 은 현재 window active tab 을 기준으로 재연결하고 `tabs.onActivated` / `tabs.onUpdated` / `tabs.onRemoved` 변화에 반응해야 합니다. diagnostics 는 `tabId` 가 있으면 그 탭을 우선 추적하되, 대상이 사라지거나 unsupported 가 되면 다른 supported assembly tab 으로 fallback 해야 합니다.

## Sync Delta (2026-04-21)

When editing this repository, align with the newly implemented behavior below.

- session import sanitize 는 `sourceUrl` 에 대해 `isSupportedAssemblyUrl()` 검증을 강제하며, 미지원 URL은 항상 빈 문자열로 정규화해야 합니다.
- history `원본 페이지 열기`는 단순 non-empty 값이 아니라 supported assembly URL일 때만 활성화/실행해야 하며, 핸들러에서도 같은 검증을 재수행해야 합니다.
- unconfirmed 필터로 container fallback 이 막힌 경우 `blockedByUnconfirmedFilter` 신호를 유지하고, local polling / top fallback / injected observer 모두 `연속 6회` 차단 시 fallback 을 일시 허용하는 동일 로직을 사용해야 합니다.
- unconfirmed 차단 streak 는 자막 텍스트를 성공적으로 다시 읽는 즉시 0으로 리셋해야 하며, neutral miss에서는 기존 streak를 보존해야 합니다.
- container fallback 내부 raw는 비교/복원용으로 `4KB tail cap`을 적용해 보존하고, UI preview는 별도 formatter를 통해 `400자/3줄 tail` 의미론으로만 축약 노출해야 합니다.
- 단일 세션 export 하드 제한은 두지 않으며, runtime message 크기 초과/invalid data URL 계열 실패는 사용자 안내 문구로 매핑해야 합니다.
- frame-forward nonce mismatch 는 즉시 nonce resync 요청과 빠른 top fallback probe를 함께 트리거해 단기 드롭 구간 복구를 우선해야 합니다.
