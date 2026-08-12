# 잠재 이슈 및 보강 후보 목록

이 문서는 현재 저장소(`Chrome Extension MV3 + TypeScript + React + Vite`) 구현을 `CLAUDE.md` / `README.md` / 코드 본체와 대조하면서 식별한 **기능적으로 문제가 될 수 있는 부분**과 **추가 / 강화가 필요한 후보**를 정리한 검토 노트입니다. 최초 작성 기준일은 `2026-05-07` 이며, `2026-06-11` 코드 분할 리팩토링 이후 public facade 경로와 implementation 경로를 함께 봅니다.

> **최신 진행 상태 (2026-08-12 · v1.0.13 + 감사 후속)**
>
> - **권위 있는 기능 감사:** `PROJECT_AUDIT.md` (5차 + 구현 반영).
> - **권위 있는 비기능 감사:** `PROJECT_AUDIT_NONFUNCTIONAL.md` (보안·a11y·CI·성능 등 + 구현 반영).
> - **위협 모델:** `SECURITY.md`. 실중계 체크리스트: `LIVE_CAPTURE_SMOKE_CHECKLIST.md`.
> - 본 파일 본문의 P0/P1 “미해결” 서술은 **역사 기록**이다. 현재 코드와 어긋날 수 있으니 신규 작업 우선순위로 쓰지 말 것.
> - 2026-08-12: 롤오버 진단·persist index·SW 스키마·closed-shadow smoke·CI·History dialog·hidden 폴링 등 감사 권고 반영.
> - 2026-07-28 SOLID 분할 및 1–3차 안정화는 유지 (lifecycle lock, write 큐, IDB TTL, CSV BOM 등).
> - 사용자용 설치·사용법은 `README.md` 를 본다.
>
> **진행 상태 (2026-05-07 기준)**
>
> - **P0 (1-1, 1-2, 1-3) 모두 처리됨** — 회귀 테스트 + 검증 통과.
> - **P1 (2-1 ~ 2-5) 모두 처리됨** — 회귀 테스트 + 검증 통과.
> - **P2 다수 처리됨** — 3-1 / 3-2 / 3-5 / 4-1 / 4-3 / 4-4 / 5-1 / 5-3 / 5-4 / 6-1 / 6-2 적용. 3-3 / 3-4 / 4-2 / 4-5 / 5-2 / 5-5 / 6-3 은 가치 대비 위험·이득이 낮아 의도적으로 보류 (각 항목에 사유 표시).
> - 회귀 검증: `npm run lint` / `npm run typecheck` / `npm run test` (251 tests) / `npm run test:coverage` / `npm run build` 모두 통과.
>
> **추가 진행 상태 (2026-05-10 기준)**
>
> - v4 로컬 메타데이터, 전체 기록 검색, history entry 편집/병합/분할/삭제, MD/CSV export, preset CRUD, 실험형 side panel, DOM fixture, `npm run verify:e2e` smoke 검증이 추가되었습니다.
> - content script는 현재 `src/content/content-script.ts` bootstrap facade, `src/content/app/runtime.ts` public facade, `src/content/app/runtime/implementation.ts` 런타임 조립부로 분리되어 있습니다. 아래 후보의 과거 line-number 참조는 현재 모듈 경계 기준으로 봅니다.
> - `src/storage/session-store.ts`, `src/history/App.tsx`, `src/options/App.tsx`, `src/popup/App.tsx`도 public facade를 유지하며 실제 구현은 각 하위 `implementation.ts` 또는 `app/` 모듈에 있습니다.
> - 현재 기능 범위와 운영 기준은 `README.md`, `CLAUDE.md`, `GEMINI.md`, `DEPLOYMENT.md`, `CAPTURE_RETENTION_AND_STABILITY.md`, 권한/개인정보 문서, 코드와 테스트를 우선합니다.

각 항목은 다음 형식을 따릅니다.

- **위치 / 증거**: 코드 위치 또는 spec 위치
- **현상 / 위험**: 어떤 상황에서 문제가 되는지
- **권장 조치**: 추천 수정 방향 (P0 = 즉시 수정 권장, P1 = 다음 사이클, P2 = 백로그 / nice-to-have)

---

## 1. 명확한 결함 (P0)

### 1-1. `recentDuplicateMinLength` 사용자 설정이 파이프라인에 반영되지 않음

- **위치**: [src/core/subtitle-pipeline.ts:259](src/core/subtitle-pipeline.ts:259)
- **증거**:
  - `extractIncrementalTextFromHistory()`가 `PIPELINE_DEFAULTS.recentDuplicateMinLength` 상수(8)를 직접 참조합니다.
  - 옵션 화면 public facade [src/options/App.tsx](src/options/App.tsx) / 구현 [src/options/app/App.tsx](src/options/app/App.tsx) / settings-store / sanitize / storage / 테스트 모두에서 `recentDuplicateMinLength`를 노출/저장하지만, 정작 `applyPreview()` → `extractIncrementalTextFromHistory()` 경로는 settings 인자를 무시합니다.
  - `CLAUDE.md` "noise filtering 규칙"에는 “중복 차단 최소 길이 설정 키는 `recentDuplicateMinLength` 입니다.”라고 명시되어 있어 spec과 구현이 어긋납니다.
- **현상 / 위험**:
  - 사용자가 옵션에서 값을 변경해도 동작이 바뀌지 않습니다. 옵션 노출이 “위약 효과”에 머무릅니다.
  - 짧은 자막이 많은 본회의 영상에서 중복 차단 임계값을 낮추거나 높이고 싶을 때 우회 방법이 없습니다.
- **권장 조치 (P0)**:
  - `extractIncrementalTextFromHistory()`에 `settings` (또는 `recentDuplicateMinLength`) 인자를 받도록 시그니처를 확장하고, 호출부(`applyPreview`, `commitLiveRow`)에서 `settings.recentDuplicateMinLength`를 전달.
  - 설정값이 `undefined`/0일 때만 `PIPELINE_DEFAULTS.recentDuplicateMinLength`로 폴백.
  - 회귀 테스트로 “설정값 16 → 15자 동일 문장은 통과 / 16자 이상 동일 문장은 차단” 케이스 추가.

### 1-2. 단일 세션 export `data:` URL 폴백의 메모리/속도 폭탄 가능성

- **위치**: [src/background/service-worker.ts:92](src/background/service-worker.ts:92) `bytesToBase64`
- **증거**:
  ```ts
  function bytesToBase64(bytes: Uint8Array): string {
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  }
  ```
  `8 MiB` 경고선까지 허용되는 단일 세션 JSON export(`SINGLE_SESSION_EXPORT_WARNING_BYTES`) + Blob URL 생성 실패 시 이 경로가 호출됩니다.
- **현상 / 위험**:
  - 8 MiB 텍스트를 한 글자씩 `+=` 해 1바이트 String을 누적 → V8 rope/heap 부담이 커집니다. `data:` URL 자체도 base64로 약 11 MiB가 되어 download API/메모리에서 추가 부담.
  - Service worker 컨텍스트라 GC 회수도 다른 컨텍스트보다 어렵습니다.
- **권장 조치 (P0)**:
  - chunk 단위(`fromCharCode(...slice)`)로 누적하거나 `FileReader.readAsDataURL(new Blob([content]))`을 offscreen에서 한 번 더 시도하고, 그래도 실패할 때만 `bytesToBase64`로 내려가도록 단계화.
  - 8 MiB 초과 export는 spec상 사용자 확인을 거치지만, base64 폴백 한도(예: 2 MiB)에 도달하면 다른 안내 문구로 거부.

### 1-3. `injected-observer.ts`의 `layer.style.display = "block"` 강제 변경

- **위치**: [src/content/injected-observer.ts:155](src/content/injected-observer.ts:155), [src/content/subtitle-layer.ts:286](src/content/subtitle-layer.ts:286)
- **증거**: 모든 활성화 경로(button click, page function 호출)가 실패하면 `#viewSubtit` 노드의 인라인 `display:block`을 직접 강제합니다.
- **현상 / 위험**:
  - 페이지가 자체적으로 자막 레이어를 닫는 로직(`smi_mode_act(0)`, CSS 토글 등)을 다시 실행할 때 인라인 스타일이 우선해 레이어가 “닫히지 않는 상태”로 남을 수 있습니다.
  - 페이지가 검사 결과로 “레이어가 떠 있는데 컨트롤은 OFF”라고 판단해 사용자가 수동 토글을 한 번 더 누르도록 만들 수 있고, 이 클릭은 `tryDomSubtitleActivation`의 `controlActive` 검사 회로를 흔들 수 있습니다.
  - 페이지의 a11y 처리(스크린리더 hidden 토글 등)와 어긋나면 접근성 회귀가 됩니다.
- **권장 조치 (P0)**:
  - 이미 `visible && (hasText || controlActive)` spec이 있으므로, 활성화 시 강제 inline style 대신 “수동 클릭 안내 notice”로만 내려가도록 정책을 좁히고, fallback inline style은 명시적 옵션이나 `data-` 마커가 있을 때만 사용.
  - 레이어 inline style을 강제 적용한 경우 이를 기록해 두고, 세션 종료 / `OBSERVER_STOP_EVENT` 시점에 원복.

---

## 2. 사양과 어긋나거나 일관성이 깨진 부분 (P1)

### 2-1. `maxBufferLength` 설정이 일부 history compact 길이에만 적용됨

- **위치**: [src/core/subtitle-pipeline.ts:160](src/core/subtitle-pipeline.ts:160), [src/core/subtitle-pipeline.ts:521](src/core/subtitle-pipeline.ts:521), [src/core/output-normalizer.ts:121](src/core/output-normalizer.ts:121)
- **증거**: `confirmedCompactMaxLength` 산정에는 `settings.maxBufferLength`가 반영되지만, `recentHistoryCompactLength` (5000)와 `recentHistoryEntries` 같은 부속 상수는 settings를 받지 않습니다.
- **현상 / 위험**:
  - 사용자가 `maxBufferLength = 1000`(최소값)으로 줄여도 recent history 비교는 여전히 5000자 윈도우에서 일어나기 때문에, 설정의 의도와 실제 동작이 어긋나 desync/중복 판정 결과가 사용자가 기대한 대로 달라지지 않습니다.
- **권장 조치 (P1)**:
  - `recentHistoryCompactLength = min(maxBufferLength * factor, 5000)` 형태로 settings에 비례 / 캡 처리하거나, 별도 옵션으로 분리.
  - 설명 텍스트(`getFieldDescription`)에서 “이 값은 최근 비교 윈도우와 별개”임을 명시.

### 2-2. `popup` / `options`의 visibility 처리가 “돌아왔을 때”를 다루지 않음

- **위치**: [src/content/app/runtime.ts](src/content/app/runtime.ts) facade / [src/content/app/runtime/implementation.ts](src/content/app/runtime/implementation.ts), [src/popup/App.tsx](src/popup/App.tsx) facade / [src/popup/app/App.tsx](src/popup/app/App.tsx)
- **증거**: `document.addEventListener("visibilitychange")`는 `hidden`일 때만 page-exit 스냅샷을 호출하고, `visible` 복귀 시 별도 핸들러가 없습니다.
- **현상 / 위험**:
  - 탭이 백그라운드에 있을 때 자막 DOM이 일시 정지되거나 BFCache로 들어갔다 돌아올 경우, observer 재설치/nonce 재동기화/패널 갱신이 늦어질 수 있습니다.
  - `pagehide`(persisted=true)는 처리하지만 대응되는 `pageshow` 핸들러가 없어 BFCache 복귀 시 재초기화가 누락됩니다.
- **권장 조치 (P1)**:
  - `visible` 전환 시 `dispatchObserverConfig()` + `requestFrameForwardNonceResync(true)` + `triggerImmediateTopFallbackProbe()`를 한 번 트리거.
  - `pageshow` 이벤트에서 `event.persisted`이면 nonce를 강제 갱신하고 패널 상태 재합류.

### 2-3. running autosave 비활성 상태에서도 visibility 스냅샷이 항상 저장됨

- **위치**: [src/content/app/runtime.ts](src/content/app/runtime.ts) facade / [src/content/app/runtime/implementation.ts](src/content/app/runtime/implementation.ts) `persistRunningSnapshotForVisibilityChange`
- **증거**: `canPersistCurrentRunningState()`는 `state.status === "running" && entries.length > 0`만 검사하고 `settings.runningAutoSaveEnabled`는 보지 않습니다.
- **현상 / 위험**:
  - 사용자가 “수집 중 자동 저장”을 끈 상태에서도 탭을 잠깐 가리면 백그라운드 저장이 일어나 의도와 다른 동작이 됩니다.
  - 사양(README, CLAUDE.md)에는 “Stop 시 최종 저장은 항상 유지”까지만 보장하고, 중간 visibility hidden 저장은 명시 보장 외 동작입니다.
- **권장 조치 (P1)**:
  - autosave가 꺼져 있을 때 `persistRunningSnapshotForVisibilityChange`는 호출 자체를 스킵하거나, `pagehide` 직전 마지막 한 번만 허용.
  - 단, `pagehide` 종료 시 stopped 스냅샷은 spec대로 유지.

### 2-4. `autoStartEnabled` 기본값 ON + `all_frames` 자동 시작이 “명시적 stop” 의도를 넘어섬

- **위치**: [src/shared/constants.ts](src/shared/constants.ts) `autoStartEnabled: true`, [src/content/app/runtime/implementation.ts](src/content/app/runtime/implementation.ts), [src/content/runtime/autostart-cooldown.ts](src/content/runtime/autostart-cooldown.ts)
- **현상 / 위험**:
  - 사용자가 `멈추기` → 페이지 이동 / 새로고침 시 다음 페이지에서 다시 자동 시작합니다. spec에는 “page navigation = 새 세션” 의미가 있어 의도된 동작일 수 있지만, 사용자 입장에서 “멈췄는데 또 모은다”라는 착각을 줄 수 있고, AI 자막 레이어를 자동으로 강제 활성화하므로 라이브 시청 UX와 충돌할 수 있습니다.
  - 또한 자동 활성화에 사용되는 `clickActivationControl` 등은 페이지 측 이벤트 핸들러를 트리거하므로 분석 추적, A/B 등에 의도치 않은 클릭이 들어갈 수 있습니다.
- **권장 조치 (P1)**:
  - 옵션 라벨 / 설명에 “페이지 진입 시 자동 시작” + “자막 레이어를 자동으로 켭니다” 동의를 명시.
  - 자동 시작 직후 한 번 발생한 명시적 사용자 stop을 세션 단위로 기억해, 같은 탭의 같은 sessionStorage 영역에서는 다음 navigate까지 자동 시작을 건너뜀(짧은 cooldown).

### 2-5. 세션 메모(`note`)와 entry text에 길이 캡이 없음

- **위치**: [src/storage/session-store.ts](src/storage/session-store.ts) facade / [src/storage/session-store/implementation.ts](src/storage/session-store/implementation.ts), [src/core/subtitle-models.ts](src/core/subtitle-models.ts)
- **현상 / 위험**:
  - `note`는 길이 검증이 없어 사용자가 매우 긴 메모를 붙여 넣으면 IndexedDB write가 비대해지고, fallback `chrome.storage.local` 단일 키 8KB / 전체 5MB 한도와 충돌해 `버퍼 사용량` 영향이 큼.
  - 단일 세션 entries도 무제한 누적 가능. 24시간 회의 등에서 IndexedDB 저장 / `25 MiB` 백업 한도와 충돌 가능.
- **권장 조치 (P1)**:
  - `note`는 4–8KB 정도로 캡(또는 옵션화).
  - 단일 세션 entries 누적이 일정 임계 (예: 1만 건, 1 MiB 텍스트)에 도달하면 `notice`로 분할 저장 안내.
  - export 시점이 아니라 수집 중에도 “세션 크기 알림” diagnostics를 `persistabilityHint` 옆에 추가.

---

## 3. 안전성 / 견고성 강화 후보 (P1~P2)

### 3-1. `frame-forward nonce` 폴백 무작위성 강화

- **위치**: [src/background/service-worker.ts](src/background/service-worker.ts), [src/content/app/context.ts](src/content/app/context.ts), [src/content/app/runtime.ts](src/content/app/runtime.ts)
- **현상 / 위험**: `crypto.randomUUID`가 없을 때 `${Date.now()}_${Math.random().toString(16).slice(2)}`를 사용. 동일 ms 동안 두 frame 가 같은 nonce를 만들 확률은 매우 낮지만, observer bridge token / nonce / sessionId 모두에서 같은 패턴을 사용해 단일 fallback 결함이 여러 곳을 동시에 약화시킵니다.
- **권장 조치 (P2)**: 공통 `createRandomToken(byteLen = 16)` helper로 통합하고, `crypto.getRandomValues` 우선 사용 + `Math.random` fallback 조합으로 충돌 가능성 추가 감소. nonce는 어디까지나 deduplication용이라 보안 critical은 아니지만 일관성 가치가 큼.

### 3-2. `closeRunningSessionsOnStartup`이 `onStartup` + `onInstalled` 양쪽에서 실행됨

- **위치**: [src/background/service-worker.ts:405](src/background/service-worker.ts:405)
- **현상 / 위험**: 브라우저 부팅 + 자동 업데이트가 겹치면 두 번 연속 실행됩니다. `bumpSessionLibraryRevision`이 두 번 호출되어 history 페이지가 두 번 refetch되거나 진행 중인 사용자 작업이 1회 더 흔들릴 수 있습니다.
- **권장 조치 (P2)**: 이벤트 핸들러를 합치거나, in-flight guard로 직렬화. `runStartupPersistenceMaintenance` 내부에 `lastRunAt` (5초 이내 재실행 무시)을 두는 식.

### 3-3. `recordPageExitPersistAttempt` write storm

- **위치**: [src/storage/persist-recovery.ts:237](src/storage/persist-recovery.ts:237)
- **현상 / 위험**: 종료 직전 background persist 실패가 retry로 반복되면 매 attempt마다 diagnostics를 storage에 다시 기록. 페이지 종료 직전인 점을 감안하면 race가 잦지는 않지만, replay queue write 실패 시에는 무한 루프와 결합 가능.
- **현재 보강**: `persistQueuedPageExitRecord()` 는 diagnostics attempt 실패를 best-effort 로 분리해 queue/background persist 자체가 중단되지 않게 되었습니다. 다만 diagnostics 기록 자체의 throttle/merge 정책은 아직 별도 과제로 남아 있습니다.
- **권장 조치 (P2)**: 실패 메시지 변화가 없을 때 마지막 timestamp만 갱신하는 합치기 정책, 또는 `requestIdleCallback` 류로 throttle.

### 3-4. `sessionStorage` 기반 cooldown / debounce 부재

- **현상 / 위험**: `topFallbackMissStreak`, `localPollingUnconfirmedFallbackBlockStreak`, `lastSubtitleActivationAttemptAt` 모두 module-local 변수입니다. 같은 페이지에서 SPA 라우팅으로 “다른 player 탭처럼 보이는 컨텍스트”로 전환하면 streak이 바로 0이 아닌 상태에서 다른 selector를 쓰며 오작동할 수 있습니다.
- **권장 조치 (P2)**: 페이지 url 변경 감지(`history pushState` listener) 시 streak / activation timestamp 초기화.

### 3-5. `bindSettingsChanges`에서 변경된 settings로 streak 재설정 안 됨

- **위치**: [src/content/app/runtime.ts](src/content/app/runtime.ts)
- **현상 / 위험**: 사용자가 옵션에서 `filterUnconfirmedEnabled`를 토글하면 polling/observer 재시작은 일어나지만 `localPollingUnconfirmedFallbackBlockStreak`는 그대로라, 한쪽 설정 변경 후 streak 카운터가 바로 0/임계 상태로 리셋되지 않으면 “동일 페이지에서 6회째까지 차단” 동작이 갑자기 변할 수 있습니다.
- **권장 조치 (P2)**: settings 변경 시 streak / lastSubtitleActivationAttemptAt 등 “옵션 영향을 받는 휴리스틱 상태”를 명시적으로 초기화.

---

## 4. UX / spec 보강 후보 (P2)

### 4-1. `panel`의 빈 자막 상태 안내 사이클이 너무 점잖음

- **위치**: [src/content/subtitle-event-handler.ts](src/content/subtitle-event-handler.ts) (참조), 패널 notice 우선순위 spec
- **현상**: 본회의 fallback이 차단된 streak 동안 사용자에게는 “정상 수집 중” 메시지가 그대로 보입니다(diagnostics만 `unstable_only` 등을 표시). spec상 panel notice 우선순위는 “오류 → 자동 조정 → preview-only → idle” 순이지만, “6회 streak 동안 비어 있음” 상태도 사용자에게는 “수집되고 있는 것처럼” 보입니다.
- **권장**: streak ≥ 3일 때 “자막이 일시적으로 잡히지 않습니다” 같은 hint를 patternlibrary에 추가하고 `persistabilityHint`와 분리해 노출.

### 4-2. `복사할 자막이 아직 없습니다.` 와 `저장할 자막이 아직 없습니다.` 분기 명료화

- **위치**: [src/content/app/runtime.ts](src/content/app/runtime.ts)
- **현상**: spec(`hasPersistableContent`) 기준 일관성은 유지되나, “preview만 있고 commit이 없는 상태”에서 사용자는 “화면에 보이는데 저장도 복사도 안 됨”의 이유를 직관적으로 알기 어렵습니다.
- **권장**: 패널 notice 메시지에 `persistabilityHint`를 그대로 노출. 예: “현재 자막은 아직 확정 전이라 저장되지 않습니다. 확정될 때까지 기다리거나 noise filter를 끄고 다시 시도하세요.”

### 4-3. `download` 실패 메시지의 사용자 가이드

- **위치**: [src/shared/download-errors.ts](src/shared/download-errors.ts), [src/content/app/runtime.ts](src/content/app/runtime.ts)
- **현상**: `mapDownloadErrorMessage`가 `single-session` / `history-partial` / `library-backup` 등을 구분하지만, `runtime message length exceeded` / `invalid data URL` 케이스에서 사용자가 “선택 export로 우회”를 인지하기 어렵습니다.
- **권장**: 사용자 메시지에 “저장된 기록 화면 → 선택 export”로의 직접 링크/단축키 안내 추가.

### 4-4. `note` 미저장 dirty draft → 페이지 닫힘 시 보호 없음

- **위치**: [src/history/App.tsx](src/history/App.tsx) facade / [src/history/app/App.tsx](src/history/app/App.tsx), `confirmDiscardUnsavedNote`
- **현상**: spec에 새로고침 / 즐겨찾기 필터 전환은 폐기 확인을 띄우지만, 브라우저 탭을 직접 닫는 경우는 막지 않습니다(history는 일반 web page).
- **권장**: `beforeunload` 가드(`window.addEventListener("beforeunload")`)를 dirty 상태일 때만 등록.

### 4-5. 본회의 fallback의 “preview tail” 의미 표시

- **위치**: [src/content/fallback-preview.ts](src/content/fallback-preview.ts), `formatFallbackPreviewText`
- **현상**: 패널 preview는 `400자/3줄 tail`로 잘리지만, 사용자에게는 “원문이 더 있을 수 있다”라는 안내가 없습니다.
- **권장**: tail이 잘렸을 때 `… (본문 확인 권장)` 같은 1회성 indicator를 preview 카드 모서리에 표시.

---

## 5. 코드 정리 / 리팩터링 후보 (P2)

### 5-1. `prepareSessionState` / `prepareSessionRecord`가 사실상 no-op

- **위치**: [src/content/session-lifecycle.ts:11](src/content/session-lifecycle.ts:11)
- **현상**: 함수는 `cloneState`만 수행하고 `settings`, `now` 인자를 모두 `void`로 무시합니다. 호출부(`buildPreparedSessionState`/`Record`)와 그냥 `cloneState`/`toSessionRecord`의 차이가 없습니다.
- **권장**: 의도가 “미래의 prepare hook 자리”라면 주석/`TODO`로 명시. 그렇지 않다면 호출부를 직접 `cloneState`/`toSessionRecord`로 단순화.

### 5-2. `bootstrap()`이 `document.title`을 두 번 읽음

- **위치**: [src/content/app/runtime.ts](src/content/app/runtime.ts)
- **현상**: `getSettings()` 호출 전후에 같은 값을 두 번 대입. 의도(예: 설정 로드 중 SPA 타이틀 변경 대응)라면 주석으로 명시.

### 5-3. `subtitle:health` 이벤트가 sourceUrl/title 갱신을 트리거하지 않음

- **위치**: [src/content/app/runtime.ts](src/content/app/runtime.ts)
- **현상**: 호스트 페이지가 SPA로 navigate하더라도 `health`만 수신하면 `state.sourceUrl`/`state.title`이 stale로 남습니다.
- **권장**: `health` 이벤트에 `sourceUrl`이 포함될 때 `state.sourceUrl`/`title` 갱신 로직 추가, 또는 별도 `popstate`/`pushState` 가드.

### 5-4. `cleanupPersistedBlobDownloadUrls`가 새 offscreen에 대해 revoke 메시지를 보냄

- **위치**: [src/background/service-worker.ts:73](src/background/service-worker.ts:73)
- **현상**: 이전 service worker가 만든 Blob URL은 새 offscreen 문서에서 무효이지만, 그래도 `OFFSCREEN_REVOKE_BLOB_URL`을 보냅니다. offscreen은 `activeBlobUrls`에 없는 URL이면 no-op이므로 안전하지만, 무의미한 round-trip이 발생.
- **권장**: 직전 SW 상태에서 만든 URL은 그냥 storage에서 제거하고 메시지는 생략.

### 5-5. `sanitizeFilenameBasename`이 trim 후 사용자가 의도한 공백을 잃을 수 있음

- **위치**: [src/shared/filename-pattern.ts:40](src/shared/filename-pattern.ts:40)
- **현상**: replaceAll `{committee}` 등 후 `trim()`을 사용하는데, 사용자가 일부러 `_` 사이 공백 패턴을 넣은 경우 의도하지 않은 양 끝 trim이 일어남.
- **권장**: 한 번 더 명시적으로 “선두/말미 공백 제거”를 옵션화하거나 README에 동작 명시.

---

## 6. 보안 / 권한 표면 (P2)

### 6-1. injected observer가 `window.smi_*` 함수를 임의 호출

- **위치**: [src/content/injected-observer.ts:130](src/content/injected-observer.ts:130)
- **현상**: 페이지 컨텍스트의 `smi_mode_act`, `smi_on`, `layerSubtit`을 함수면 그대로 호출. 페이지가 같은 이름으로 별도 함수를 바인딩하면 의도와 다른 동작이 가능. 또한 `try/catch`로 결과를 삼키므로 페이지 측 에러 발생 시에도 “성공”으로 처리.
- **권장**: 호출 후 `isSubtitleLayerVisible()` 검사로만 “성공”을 인정(현재도 함수 호출 후 곧바로 `return true`라 약간 약함). 함수 시그니처/이름 매칭 정확도를 높이거나, 호출 결과 + 1프레임 대기 + 재검사로 통일.

### 6-2. `openHistoryPage` / `openOptionsPage` / `openDiagnosticsPage`가 동일 가드 없이 인지된 모든 sender에서 호출 가능

- **위치**: [src/background/service-worker-commands.ts:138](src/background/service-worker-commands.ts:138)
- **현상**: 페이지가 sandboxed iframe에서 `chrome.runtime.sendMessage`로 위 명령을 호출할 수는 없지만, 다른 확장이 host_permissions를 우회해 동일 메시지를 시도하는 경우는 있을 수 있습니다(드물지만).
- **권장**: sender.id가 `chrome.runtime.id`와 일치하는지 한 번 더 확인. 비용 거의 0.

### 6-3. `chrome.tabs.onUpdated` 처리 규모

- **위치**: [src/background/service-worker.ts:401](src/background/service-worker.ts:401)
- **현상**: 모든 탭의 onUpdated를 받아 `handleFrameForwardNonceTabUpdated`에 위임. 평소엔 OK이지만 사용자가 수십 개 탭을 빠르게 navigate할 때 storage write가 일부 spike. spec(2026-03-19)이 명시한 동작이지만 메트릭은 없음.
- **권장**: 디버그 옵션 enabled일 때 `loading` 이벤트 카운트를 기록해 진단.

---

## 7. 테스트 / 회귀 보강 후보

- **`recentDuplicateMinLength` 사용자 설정 회귀**: 설정값 16에서 15자 동일 raw 통과, 16자 이상 동일 raw 차단(현재 1-1 수정 전후로 함께 추가).
- **autosave OFF + tab hidden** 시 storage write가 발생하지 않는지(`runningAutoSaveEnabled = false` 케이스).
- **`pageshow` BFCache 복귀**: nonce 재동기화와 panel state 합류가 일어나는지.
- **`bytesToBase64` 8 MiB stress**: data URL 폴백 경로에 대해 Node 환경에서 메모리/시간 회귀 측정.
- **`clearSessionAndReset` 직후 즉시 재시작**: failed-stopped guard / running guard / queue diagnostic 모두 클리어되었는지 확인.
- **`subtitle:health`만 도달하는 stale 시간 동안의 panel notice**: idle/preview-only/오류로 잘못 분기하지 않는지.

---

## 8. 문서 / spec 업데이트 후보

- `CLAUDE.md`의 “noise filtering 규칙” 섹션에 `recentDuplicateMinLength`가 “설정 키이지만 현재 파이프라인에서 무시된다”는 사실을 일단 명시(혹은 1-1을 고친 뒤 “이제 settings에서 받습니다”로 갱신).
- `README.md`의 “알려진 한계”에 다음을 추가하는 것이 정확한 기대치 설정에 도움이 됨.
  - 단일 세션 export `8 MiB` 경고 / 하드 폴백 한도 동작.
  - autoStart의 자동 자막 레이어 활성화 부수 효과.
  - autosave OFF 상태에서도 visibility hidden 시 저장이 일어남(2-3 수정 전 한정).

---

## 9. 우선순위 요약

| 우선순위 | 항목                                                                                                                                            |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | 1-1 `recentDuplicateMinLength` 미반영, 1-2 base64 폴백 메모리, 1-3 `display:block` 강제                                                         |
| P1       | 2-1 maxBufferLength 부분 적용, 2-2 visible/pageshow 미처리, 2-3 visibility autosave gating, 2-4 autoStart 동의/cooldown, 2-5 note/entry 길이 캡 |
| P2       | 3-1~3-5 안전성 강화, 4-1~4-5 UX 보강, 5-1~5-5 정리/리팩터링, 6-1~6-3 보안 표면 정리, 7 테스트 보강, 8 문서 업데이트                             |

---

## 10. 검증 절차 권장

각 항목 수정 후 spec(`README.md` "검증 기준")에 따라 다음 명령을 모두 통과해야 합니다.

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

대규모 수정(특히 1-1, 1-2, 2-3)은 `npm run test:coverage`까지 실행해 회귀를 함께 확인해 주세요.
