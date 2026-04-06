# AI Context: Korea Assembly CC Chrome

이 문서는 다음 세션의 AI 에이전트가 현재 저장소를 빠르게 파악하고, Chrome Extension 코드베이스를 안전하게 수정하기 위한 루트 컨텍스트입니다.

## 1. 현재 프로젝트 상태

- 이 저장소의 활성 구현은 `Chrome Extension (Manifest V3) + TypeScript + React + Vite` 입니다.
- 과거 `PyQt6 + Selenium` 데스크톱 앱은 `legacy/` 아래 아카이브 대상으로 분리되어 있으며, 현재 작업 대상이 아닙니다.
- 최우선 기능은 `국회 AI 자막 추출`, `세션 저장`, `TXT / SRT / VTT / JSON 내보내기` 입니다.
- 현재 주 UI 는 `사이트 안 우측 패널`이며, popup 은 `페이지 패널 열기 / 저장된 기록 / 환경 설정 / 수집 진단` 중심의 보조 화면입니다.
- 현재 UI 보강 범위에는 `우측 패널 실시간 표시`, `history 기록 내부 검색/복사`, `history 전체 기록 검색`, `최근 N줄 복사`, `history 즐겨찾기/세션 메모`, `entry 체크박스 기반 부분 복사/부분 export`, `전체 JSON 백업/복원`, `autosave 설정/최근 저장 시각 진단`, `autoScroll 옵션 반영`, `자막 우선 대형 미리보기`, `실시간 내용 / 수집된 자막 2단 구성`, `패널/popup 수집 진단 진입`, `즉시 노출되는 내보내기 버튼`이 포함됩니다.
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
- 세션 저장: `IndexedDB` 우선, open/capability 실패 시 `chrome.storage.local` per-session fallback, replay queue는 session DB 내부 `IndexedDB` store 우선, 최후에는 메모리 fallback
- 저장소 권한: `storage` + `unlimitedStorage` 조합으로 장시간 회의의 fallback/diagnostics quota 리스크를 낮춥니다.

## 3. 주요 파일 구조

```text
manifest.json
src/
  background/service-worker.ts
  content/
    bootstrap/
      bootstrap-content-script.ts
      panel-controller.ts
      panel-ui.ts
      runtime-config.ts
      runtime-helpers.ts
      runtime-view.ts
    inpage-panel/
      controller.ts
      dom.ts
      index.ts
      styles.ts
      view-state.ts
    content-script.ts
    dom-probe.ts
    frame-probe.ts
    injected-observer.ts
    panel-live-rows.ts
    subtitle-dom.ts
    subtitle-layer.ts
  core/
    live-capture.ts
    subtitle-pipeline.ts
    noise-filter.ts
    exporters/
  shared/
    capture-diagnostics.ts
  storage/
    session-store/
      db.ts
      fallback.ts
      merge.ts
      normalize.ts
      operations.ts
      search.ts
      state.ts
      test-reset.ts
    session-store.ts
    session-backup.ts
    settings-store.ts
  popup/
  options/
  history/
    components/
      HistoryPage.tsx
    model/
      history-confirm.ts
      session-list-row.ts
    App.tsx
tests/
README.md
CLAUDE.md
GEMINI.md
offscreen.html
```

- `src/content/content-script.ts`, `src/history/App.tsx`, `src/storage/session-store.ts`, `src/content/inpage-panel.ts` 는 외부 경로 안정성을 위한 facade 입니다.
- 실제 구현 본문은 `src/content/bootstrap/bootstrap-content-script.ts`, `src/history/components/HistoryPage.tsx`, `src/storage/session-store/operations.ts`, `src/content/inpage-panel/controller.ts` 기준으로 읽는 것이 맞습니다.

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

- top frame content script 가 단일 capture coordinator 를 소유합니다.
- coordinator 는 접근 가능한 same-origin `iframe/frame` document 를 재귀적으로 순회하고, subtitle container 부모 레벨 observer + polling fallback 을 함께 사용합니다.
- observer 는 변경 신호용이고 실제 텍스트는 selector 기반 probe 로 다시 읽어 `rows + raw preview` 를 같은 `NormalizedCaptureEvent` 로 합류시킵니다.
- `injected-observer.ts` 는 DOM 관측을 하지 않고, 자막 레이어 activation 이 DOM 클릭만으로 해결되지 않을 때 page function 호출을 돕는 최소 helper 로만 남깁니다.
- top frame 에서는 자막 공백을 즉시 reset 하지 않고 약 1초 grace 뒤에만 실제 reset 을 commit 합니다.
- observer miss, 타겟 교체, 로딩 지연 상황에서는 polling fallback 이 동작합니다.
- `src/content/content-script.ts` 는 bootstrap facade 이고, 실제 top-frame orchestration은 `src/content/bootstrap/bootstrap-content-script.ts` 가 소유합니다.

## 5. subtitle pipeline 고정 의미론

- `normalized capture event -> live reconcile -> normalize -> preview gate -> history/rfind suffix -> noise filter -> merge/add`
- structured row 가 안정적으로 잡히면 row baseline 과 글로벌 history 를 함께 사용해 commit/update 를 분리합니다.
- structured row upsert 와 prepared snapshot 직렬화도 같은 commit sanitizer 를 사용해야 합니다.
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
- 저장/export/unload/stop 직전 prepared snapshot 생성 경로는 `수집된 자막` 기준 snapshot을 사용합니다.

## 6. noise filtering 규칙

- `noiseFilterEnabled = true` 일 때만 아래 규칙으로 숫자-only / 기호-only를 차단합니다.
- 허용:
  - 한글 1~2글자
  - 영문 1~2글자
- 차단:
  - 숫자-only
  - 기호-only
- noise filter 설정과 무관하게 `로딩중..`, `로딩 중...`, `Loading...` placeholder는 structured/fallback 공통 commit/persist/export 대상에서 제외합니다.
- `noiseFilterEnabled = false` 이면 숫자-only / 기호-only도 통과시킵니다.
- 중복 차단 최소 길이 설정 키는 `recentDuplicateMinLength` 입니다.

## 7. exporter / persistence 규칙

### 7.1 Exporter

- `TXT`: 기본값은 타임스탬프 제외(`text`)이며, 옵션에서 포함 시 `[HH:MM:SS] text`
- `SRT`: 세션 시작 기준 상대 시간, `HH:MM:SS,mmm`
- `VTT`: 세션 시작 기준 상대 시간, `HH:MM:SS.mmm`
- `JSON`: 세션 전체 복원 가능한 구조
- export/copy 단계에서는 추가 후단 정규화를 적용하지 않고 `수집된 자막` 기준 snapshot을 그대로 사용합니다.

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
- `searchSessionsPage`
- `replayQueuedExitPersistRecords`
- `closeRunningSessionsOnStartup`

위 CRUD 흐름과 startup cleanup 의미론은 유지해야 합니다.

- record payload version 과 IndexedDB schema version 은 분리해서 관리합니다.
- 현재 session record schema 는 `version = "3"` 기준이며 `starred`, `pinnedAt`, `note` 필드를 포함합니다.
- `loadSession`/`listSessions` 는 IndexedDB + fallback 을 함께 읽고 `updatedAt` 기준으로 더 최신 레코드를 고릅니다. 동률이면 IndexedDB 를 우선합니다.
- 개별 IndexedDB transaction/read/write 실패는 현재 연산만 fallback 으로 우회하고, 런타임 전체 disable 은 open/capability failure 에만 허용됩니다.
- 성공한 IndexedDB write/delete 는 동일 id fallback copy 를 best-effort 로 정리합니다.
- page-exit 시점의 stopped 스냅샷은 세션별 replay queue 에 함께 적재되고, background/direct/replay 저장 성공 시 해당 세션의 stale queued snapshot 을 정리합니다.
- startup 에서는 queued stopped snapshot replay 를 먼저 수행하고, 그 다음 persisted running session cleanup 을 수행합니다.
- replay / cleanup 결과는 `chrome.storage.local` diagnostics snapshot 으로 저장되며 options `저장 복구 상태`에 노출됩니다.
- replay queue 는 session DB 내부 `IndexedDB` store, legacy `chrome.storage.local` snapshot, 메모리 snapshot 을 merge 해서 읽어야 하며, `chrome.storage.local` queue는 레거시/IDB 불가 fallback source로만 유지해야 합니다.
- `closeRunningSessionsOnStartup` 는 숫자 하나가 아니라 `detected / closed / failed` 요약을 반환해야 합니다.
- JSON import 는 raw session spread 가 아니라 allow-list sanitize 후 normalize 순서를 유지해야 하며, unsupported wrapper version 과 invalid timestamp 는 reject 해야 합니다.

### 7.3 UX 보강 규칙

- top frame 의 content script 가 우측 패널을 자동으로 삽입합니다.
- 기본 상태는 `펼쳐짐` 이고, 접으면 오른쪽의 `자막 보기` 탭만 남습니다.
- popup 의 `OPEN_INPAGE_PANEL` 명령은 접힌 패널을 다시 엽니다.
- popup 은 long-lived port 없이 현재 탭에 request/response 명령만 보내며, 수신자가 없으면 새로고침 안내로 내려갑니다.
- 패널은 `실시간 내용`과 `수집된 자막` 2단으로 보입니다.
- `수집된 자막` 목록은 현재 active row만 번쩍 보여 주는 뷰가 아니라, live ledger 기준 최근 row가 누적되는 뷰를 유지합니다.
- 본회의 fallback capture에서는 structured row가 비어 있어도 이미 commit된 entry를 `수집된 자막` 목록으로 재구성해 누적 표시합니다.
- 같은 row key 의 갱신은 라이브 목록 DOM 노드를 재사용해 제자리 수정합니다.
- history 복사 포맷은 기본적으로 `[HH:MM:SS] text` 줄단위입니다.
- 페이지 패널과 history 모두 `recentCopyLineCount` 기반 `최근 N줄 복사`를 지원합니다.
- history 페이지는 열린 상태에서도 `recentCopyLineCount`, `filenamePattern`, `exportTxtWithoutTimestamps` 변경을 `chrome.storage.onChanged` 로 즉시 반영합니다.
- history 는 저장소 전체 transcript entry 본문 기준 `전체 기록 검색`을 지원하며, global query 와 selected-session local query 상태를 분리해야 합니다.
- history 의 `전체 삭제` 는 현재 로드된 1000건만이 아니라 저장소 전체를 비워야 하며, 선택 삭제는 부분 성공/실패 요약을 남긴 뒤 항상 refresh 해야 합니다.
- history 는 session-level `즐겨찾기`, `메모`, `즐겨찾기만 보기` 필터를 제공하고, 이 메타데이터는 persistence 및 JSON 백업/복원에서 함께 보존되어야 합니다.
- history detail 은 entry 체크박스 기반 `선택한 항목 복사`, `선택 TXT/SRT/VTT/JSON export` 를 제공하며, 선택 export 의 시간 기준은 원본 세션 시작 시각 기준 상대 시간 의미론을 유지해야 합니다.
- history 상단은 전체 저장소 기준 `JSON 백업` 과 단일 세션/번들 `JSON 가져오기` 를 지원하며, 가져오기는 같은 `id` 충돌 시 더 최신 `updatedAt` 레코드를 유지합니다.
- history 의 전체 삭제 확인은 전체 세션 preload 가 아니라 `정확한 총 건수 + 최대 3건 preview` 기준으로 보여 줘야 합니다.
- history 의 전체 JSON 백업은 view layer preload 가 아니라 store helper export payload 를 사용해야 합니다.
- `autoScroll` 옵션이 꺼지면 패널의 `실시간 내용` / `수집된 자막` 영역을 강제 스크롤하지 않습니다.
- autosave는 옵션에서 켜고 끌 수 있지만 `Stop` 시 최종 저장은 항상 유지합니다.
- stopped 세션 최종 저장이 실패하면 다음 `자막 모으기`/`화면 비우기` 전에 저장을 1회 재시도하고, 재시도도 실패할 때만 폐기 확인을 표시합니다.
- replay queue 조회는 session DB 내부 `IndexedDB` queue store, legacy `chrome.storage.local` snapshot, 메모리 snapshot을 merge 해야 하며, 같은 `sessionId` 충돌 시 `record.updatedAt` 우선, 동률이면 `queuedAt`이 더 늦은 쪽을 유지해야 합니다.
- queue write 실패는 메모리 queue를 지우면 안 되며, diagnostics는 `lastQueueWriteError`, `lastReplayError`, `lastCleanupError`, `lastError`로 phase별로 남겨야 합니다.
- capture notice 는 `정상 수집`, `자동 조정 중 수집`, `reset 복구 중` 상태를 구분해 사용자에게 드러내야 하며, fallback/polling 경로에서도 실제 수집이 이어질 때는 과도한 장애 경고 문구를 피해야 합니다.
- 패널과 popup 은 `수집 진단` 화면 진입 버튼을 제공하고, 실제 수집 방식(`structured`/`fallback`/`polling`), observer 활성 여부, selector, frame path, 최근 저장 시각, 저장 복구 상태는 options 페이지의 `수집 진단` 탭에서 표시합니다. `저장 복구 상태`는 diagnostics view가 열려 있는 동안 `chrome.storage.onChanged`를 통해 즉시 반영되어야 하며, 마지막 queue 대상 session id / record.updatedAt / payload 크기, 현재 persistence context, 마지막 stopped save 방식도 보여야 합니다.
- popup `SAVE_SESSION`, 패널 `저장/복사/내보내기`, `beforeunload` 경고, pagehide/visibilitychange 저장 시도는 모두 prepared snapshot 기준 `canPersistPreparedContent`로 정렬해야 합니다. 현재 화면에 raw preview만 남아 있고 prepared entry가 비면 저장 가능 상태로 취급하면 안 됩니다.
- 패널 `화면 비우기`는 저장 가능 여부와 별개로 현재 화면에 보이는 runtime 내용이 있으면 계속 허용해야 합니다.
- 자막 자동 활성화 성공은 `visible && (hasText || controlActive)`를 만족할 때만 인정해야 합니다.
- options 숫자 필드는 canonical number state 와 별도 draft string state 를 유지하고, invalid draft 는 inline field error 로 표시하며 저장을 막아야 합니다.

## 8. 작업 시 주의사항

- popup 이 닫혀도 수집이 멈추면 안 됩니다.
- Selenium / PyQt 구조를 다시 가져오면 안 됩니다.
- `legacy/` 는 로컬 참조용 아카이브일 수 있지만 Git 추적 대상으로 전제하면 안 됩니다.
- storage 실패, observer 실패, frame 접근 실패, selector 미탐색은 크래시 대신 fallback 으로 내려가야 합니다.
- export 는 `offscreen Blob URL` 우선, 실패 시 `data:` URL fallback 을 유지합니다.
- page-world observer bridge, frame forwarding, storage-backed nonce 계층은 재도입하지 않습니다. 자막 DOM 관측 책임은 top frame content script coordinator 하나로 유지합니다.
- 코드 수정 후 가능하면 `lint`, `typecheck`, `test`, `build` 를 모두 확인합니다.

## 9. 관련 문서

- 메인 설명: `README.md`
- 배포 절차: `DEPLOYMENT.md`
- 스토어 권한 문안: `CHROME_WEB_STORE_PERMISSION_JUSTIFICATIONS.md`
- 개인정보 처리 초안: `PRIVACY_POLICY_DRAFT_KO.md`

## Sync Delta (2026-04-03)

When editing this repository, align with the structure and behavior below.

- 위원회명 파싱은 일반 `-`/`|` 절단이 아니라 `src/content/committee-name.ts` 의 보수적 suffix 제거 규칙을 따라야 합니다.
- subtitle visibility 판정은 `display:none`, `visibility:hidden`, `opacity:0`, `hidden`, zero-size 를 공통 helper 기준으로 맞춰야 하며 `subtitle-layer`와 observer가 서로 다른 기준을 가지면 안 됩니다.
- selector profile(`default | committee | plenary`)은 `src/content/subtitle-dom.ts` 를 단일 기준으로 사용해야 하며, probe/observer/fallback 경로가 서로 다른 selector 의미론으로 갈라지면 안 됩니다.
- session store transcript 검색은 `searchSessionsPage()` 를 통해 제공되며, 현재 정책은 correctness-first full scan + case-insensitive substring 입니다.
- 2026-04-03 이후 구조는 facade + internal implementation 분리 기준입니다. 새 기능을 추가할 때는 facade 파일을 다시 비대하게 만들지 말고 해당 하위 모듈 아래로 배치합니다.

## Sync Delta (2026-03-26)

When editing this repository, align with the behavior below.

- 내보내기/복사 기준 데이터는 패널 `수집된 자막` 목록과 동일한 snapshot 경로를 사용해야 합니다.
- `session-store` export 경로에서 `normalizeSessionForExport` 기반 후단 정규화는 사용하지 않습니다.
- `TXT` 내보내기에는 `exportTxtWithoutTimestamps` 옵션이 있으며 기본값은 `true`(타임스탬프 제외)입니다.
- 장시간 세션 대응을 위해 화면/내보내기 데이터는 무제한 유지하고, 내부 state cache만 주기적으로 압축합니다.

## Sync Delta (2026-03-23)

When editing this repository, align with the bug fixes below.

- `ensureSubtitleLayerActive` 반환값이 `layer.visible` 단독 → `layer.visible && (layer.hasText || layer.controlActive)` 로 수정되었습니다. 이 조건은 CLAUDE.md 의 subtitle auto activation 성공 판정 기준과 일치합니다.
- `saveCurrentSessionSnapshot` 에 2단계 빈 저장 guard가 추가되었습니다.
  - pre-flush guard: `entries.length === 0 && !previewText.trim()` 이면 즉시 `저장할 자막이 아직 없습니다.` 반환.
  - post-flush guard: flush 후 `record.entries.length === 0` 이면(noise-only previewText 등) 마찬가지로 저장 차단.
  - popup/패널 저장 가능 여부와 unload 계열 guard는 raw preview 유무가 아니라 prepared snapshot 기준 `canPersistPreparedContent`와 정렬되어야 합니다.
- `tests/content-autosave.test.ts` 에 noise-only previewText flush → entries 0 → `shouldPersistFinalSession` false 회귀 테스트가 추가되었습니다.

## Sync Delta (2026-03-20)

When editing this repository, align with the newly implemented behavior below.

- 본회의(`xcode=10` / `xcgcd=DCM000010...`) container fallback은 `실시간 내용` 누적 원문을 그대로 유지해야 합니다.
- 본회의 fallback capture에서는 structured live row가 비어 있어도 commit된 entry를 `수집된 자막` 목록으로 계속 보여 주어야 합니다.
- `로딩중..`, `로딩 중...`, `Loading...` placeholder는 noise filter 토글과 무관하게 commit/persist/export 대상에서 제외되어야 합니다.

## Sync Delta (2026-04-06)

When editing this repository, align with the newly implemented behavior below.

- top frame content script 가 single-owner capture coordinator 를 유지하고, 접근 가능한 same-origin frame document 를 직접 관측합니다.
- page-world helper 는 activation 전용이며, observer bridge / frame forwarding / nonce 동기화 계층은 더 이상 사용하지 않습니다.
- replay queue는 storage와 memory를 merge 해서 읽고, storage write failure 뒤에도 같은 런타임의 memory queue를 보존해야 합니다.
- options `저장 복구 상태`는 queue write / replay / cleanup 오류를 개별 행으로 노출해야 하며 `lastError`는 요약 필드로만 유지합니다.
- popup 저장 버튼은 persistable content가 있을 때만 활성화되며, 빈 저장 요청은 `저장할 자막이 아직 없습니다.` 피드백으로 일관되게 처리해야 합니다.
- subtitle auto activation 성공은 `visible && (hasText || controlActive)` 조건을 충족할 때만 인정하고, 그 외에는 수동 클릭 안내 notice로 내려가야 합니다.

## Sync Delta (2026-03-12)

When editing this repository, align with the newly implemented behavior below.

- Preview-only runtime text may remain visible in the panel, but save/export/pagehide/beforeunload/stop snapshots must only persist prepared entries.
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

- Top-frame DOM coordinator simplification: completed.
- Activation-only injected helper reduction: completed.
- Unconfirmed fallback consistency: completed.
- Fallback probe backoff + cached frame path: completed.
- Invalidated context shutdown path: completed.
- Offscreen duplicate-create tolerance: completed.
- Subtitle row style-cost tuning: completed.
- Focused regression tests added for probe/bridge paths.

## 2026-03-12 Additional Sync Update

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
- `GET_STATUS` response snapshot is the complete initial payload for popup/options hydration and must include `subtitleCount`, `charCount`, `previewText`, and `recentEntries`.

## 2026-03-16 Sync Update

When editing this repository, align with the newly implemented behavior below.

- `listSessionsPage({ page, pageSize, starredOnly })` now uses store-level paging semantics. When fallback records are absent, the primary path is IndexedDB paging/index based; when fallback records exist, keep correctness-first merged paging behavior.
- Session ordering semantics remain fixed as `starred first -> pinnedAt || updatedAt desc -> updatedAt desc -> id`.
- `deleteAllSessions()` now attempts IndexedDB and fallback cleanup independently and may report partial-failure detail even when one backend was cleared successfully.
- `filenamePattern` validation is now strict: only `{date}`, `{time}`, `{committee}` placeholders are supported, forbidden filename characters are rejected in options, invalid stored values sanitize back to default, and export filename generation performs a final safety sanitize.
- In-page `최근 N줄 복사` must now match history semantics and copy from the prepared cumulative session snapshot, not temporary live-row timestamps.
- History long-running actions now use a busy lock to prevent duplicate execution while backup/import/delete/export/reopen/favorite/note actions are in flight.
- Options numeric-field tests now query accessible field names instead of concatenated label+unit strings.
