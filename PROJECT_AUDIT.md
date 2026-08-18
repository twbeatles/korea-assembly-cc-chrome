# Project Audit

**대상:** `korea-assembly-cc-chrome` (국회 AI 자막 추출 Chrome Extension)  
**감사 일자:** 2026-08-18 (6차 · 기능 구현 관점 재감사)  

> **구현 반영 (2026-08-18)**  
> §5 Fix Plan 1–2단계와 3단계 중 테스트·권한·가드를 코드에 반영했다.  
> - H1: persist 인덱스 mutate 직렬화 + `recoverOrphanedExitPersistRecords` (startup replay 전)  
> - M2: `shouldRunDeferredCaptureStart` + runtime-core 예약 start URL 가드  
> - M1: 롤오버 안전 상한 2048  
> - M4: search metadata-first · startup `status` 인덱스  
> - M6: persist 8 MiB 상한 · `unlimitedStorage`  
> - L1: lineage note 보존  
> - L2: CLAUDE 검증 명령·큐 수치 정리  
> - L3: flush persist 금지 주석  
> - L4: id 128자 · 빈 id write 거부  
> - L5: host command e2e 마커  
> - M3: lock+deferred start 오케스트레이션 테스트 (runtime-core 전면 분해는 후속)  
> - M5: 실중계 스모크는 체크리스트 유지 (자동 실행 불가)  
**배포 버전 기준:** `package.json` / README `1.0.13`  
**Git:** `origin/main` pull 완료 (`Already up to date.`)  
**방법:** `README.md` · `CLAUDE.md` 정독 → CodeGraph MCP로 엔트리·호출 관계·blast radius 분석 → 고위험 경로만 보조 대조 → 구현 후 `npm run test` (**72 files / 389 tests 전부 통과**)

**관련 문서:** 보안·성능·a11y·CI 등 비기능 범위는 `PROJECT_AUDIT_NONFUNCTIONAL.md` 를 본다.

> **이전 감사와의 관계**  
> - 1–3차: lifecycle lock, write 큐, IDB TTL, CSV BOM, messaging, 롤오버 큐, timeRange.  
> - 4차: 발언자 UI/export 정합.  
> - 5차(2026-08-12): 롤오버 128, persist index, SW persist 스키마, `sanitizeSessionId`/`sanitizeQualityStats`, pendingPreviews 회귀, 문서 정합.  
> - **6차:** 5차 권고의 **구현 반영 여부를 코드로 재확인**한 뒤, 남은 기능 위험만 싣는다. 해소된 항목은 §3 하단과 §7에 정리한다.

**주의:** 6차 감사 본문은 코드 변경 없이 작성했고, 위 **구현 반영** 블록 이후 권고를 코드에 넣었다. High-Risk는 실제 코드 근거가 있는 항목만 실었고, 추정은 §4에 분리한다.

---

## 1. Executive Summary

이 제품은 국회 의사중계 AI 자막을 **수집 → 로컬 확정 저장 → History · 다형식 export** 하는 Manifest V3 확장이다. 저장소 성숙도가 높고, 5차에서 지적한 persist 스키마·index·설정 반영·preview 비승격은 **코드상 반영되어 있다**. 단위 테스트는 감사 시점 **69 files · 375 tests**, 권고 구현 후 **72 files · 389 tests** 전부 통과했다.

**전체 위험도: Low–Medium**

| 등급 | 개수 | 요약 |
|------|------|------|
| Critical | 0 | 전손·원격 RCE·의도적 데이터 유출 경로는 확인되지 않음 |
| High | 1 | page-exit persist **인덱스 read-modify-write 경쟁** — 복구 큐 항목이 고아가 되면 replay가 놓칠 수 있음 |
| Medium | 6 | 롤오버 이벤트 드롭, SPA URL 전환 시 지연 auto-start 경합, runtime-core 거대 모듈, 검색/startup 전체 hydrate, `chrome.storage.local` 10MB 한도, 실중계 e2e 공백 |
| Low | 다수 | lineage 병합 시 note 소거, CLAUDE 내부 수치 불일치, persist 메시지 바이트 상한 없음, host command 채널, multi-tab soft split |

**강점 (사실):**

- 수집 의미론이 문서와 대체로 일치: committed entry만 persist/export, `buildPreparedSessionState`가 `pendingPreviews`를 비우고 materialize하지 않음.  
- `captureLifecycleLock` + `enqueueSessionWrite` + IDB soft-disable TTL + fallback memory rollback.  
- page-exit는 queue 후 background persist, startup은 replay → running cleanup 순서.  
- import는 allow-list sanitize + 타임스탬프/버전 검증 + running→saved.  
- export: offscreen Blob 우선, `DOWNLOAD_REQUEST` 2 MiB 한도, CSV UTF-8 BOM, speaker 옵션 연동.  
- 브리지: page-world `postMessage` origin 고정, observer token, frame-forward nonce + mismatch resync.  
- 5차에서 연 구멍(`recentDuplicateMinLength`, visibility+autosave, pageshow, note/entry 길이 캡, `display:block` 강제 제거, SW persist 스키마)은 **현재 코드에서 닫혀 있음**.

**한 줄 결론:** 기능 골격은 안정적이고 Critical 수정은 불필요하다. 지금 손대면 이득이 큰 것은 **exit-persist 인덱스 원자성**(복구 누락 방지)과 **URL 전환 직후 auto-start가 락 큐에서 한 박자 늦게 도는 경합**이다. 나머지는 장시간 수집·대형 라이브러리·실중계 검증 쪽 안정성 과제다.

---

## 2. Project Understanding

### 2.1 목적 (README / CLAUDE)

| 항목 | 내용 |
|------|------|
| 제품 | 국회 의사중계 AI 자막 실시간 수집 · 로컬 저장 · History · TXT/SRT/VTT/JSON/MD/CSV |
| 호스트 | 주 `assembly.webcast.go.kr`, 보조 `webcast.assembly.go.kr` (DNS에 따라 보조는 불가할 수 있음) |
| 수집 범위 | 플레이어(`main/player*`, `pressplayer*`); 홈(`/main`, `/main/`)은 패널·진단만 |
| 스택 | MV3 · TypeScript(7 typecheck / 6 ESLint) · React · Vite · Vitest · IndexedDB(+chrome.storage/memory fallback) |
| 저장 원칙 | 확정(committed) 자막만 persist/export; preview-only 승격 금지 |
| 검증 | `lint` / `typecheck` / `test` / `build` / `verify:e2e` (`verify`에 `check:version` · `build:inject` · `check:injected` 포함) |

### 2.2 주요 실행 흐름 (CodeGraph)

CodeGraph 질의: content bootstrap, `startCapture`/`stopCapture`, `saveSession`, persist, pipeline, page-exit, import, nonce, 롤오버, lock.

확인된 호출 사슬:

```text
content-script bootstrap (멱등)
  └─ createContentRuntime → orchestrator/runtime-core
       ├─ mountInPagePanel
       │    └─ onStartCapture → startCapture → captureLifecycleLock.run("start")
       │                         → startCaptureUnlocked
       ├─ bindBridgeMessages (observer token + frame-forward nonce)
       ├─ startCapturePipeline / startCapture (lock 직렬화)
       │    ├─ injected-observer (page world MutationObserver)
       │    ├─ local-polling / top-frame fallback
       │    ├─ live-capture ledger + subtitle-pipeline (commit/merge)
       │    ├─ scheduleRunningPersist (entries 있을 때만)
       │    └─ segment rollover (persist → continued state + event queue 128)
       ├─ stop / page-exit
       │    → persistQueuedPageExitRecord
       │         → queueExitPersistRecord (+ 실패 시 background QUEUE)
       │         → persistSessionRecordInBackground (PERSIST_SESSION_RECORD)
       └─ export/copy → DOWNLOAD_SESSION_EXPORT / page Blob (History)

background service-worker
  ├─ frame-forward nonce lifecycle
  ├─ startup persistence (guard → replay → close running)
  └─ export download (offscreen Blob → data: ≤2MiB)

session-store
  ├─ mutations: save/updateRunning (write 큐 + preserve metadata)
  ├─ idb open TTL soft disable + tryIndexedDb
  ├─ fallback: chrome.storage + memory rollback
  └─ import-export: normalize + createSessionExportPayload
```

CodeGraph blast radius (직접 covering test 없음으로 표시된 심볼):

| 심볼 | 위치 | 비고 |
|------|------|------|
| `startCapture` / `startCaptureUnlocked` | `runtime-core.ts:2309` / `:2254` | lock 경유. 단위 테스트 없음 |
| `stopCapture` | `runtime-core.ts:2330` | 동일 |
| `captureLifecycleLock` 인스턴스 | `runtime-core.ts:277` | 헬퍼 `capture-lifecycle-lock.test.ts`는 있음 |
| `persistQueuedPageExitRecord` | `page-exit-persist.ts:12` | `tests/page-exit-persist.test.ts` 있음 |
| `saveSession` | `public-api/mutations.ts:161` | write 큐 + `preserveStoredSessionMetadata` |

### 2.3 핵심 모듈 맵

| 영역 | 경로 | 역할 |
|------|------|------|
| Content bootstrap | `src/content/content-script.ts`, `app/runtime/` | facade → runtime-core (~3098줄) |
| Capture lock | `src/content/runtime/capture-lifecycle-lock.ts` | start/stop/clear/export/reconcile 직렬화 |
| Pipeline | `src/core/subtitle-pipeline/*` | extract / commit / history / lifecycle |
| Rows | `src/content/subtitle-rows.ts` | structured rows · multi-span 화자 분할 |
| Session store | `src/storage/session-store/*` | IDB schema 5 · fallback · public API |
| Persist recovery | `src/storage/persist-recovery.ts` | page-exit queue + index |
| Background | `src/background/service-worker*.ts` | export · nonce · startup |
| History / Options / Popup | `src/history/` (~1601줄 App), `options/`, `popup/` | React UI |
| Import sanitize | `src/storage/session-backup.ts` | JSON allow-list, 25 MiB |

### 2.4 문서·구현 정합

| 주제 | 정합 |
|------|------|
| committed-only save/export | **일치** — `session-lifecycle`이 `pendingPreviews`만 비움. `flushPendingPreviews`는 persist 경로에서 호출되지 않음 |
| `recentDuplicateMinLength` 설정 반영 | **일치** — `resolveRecentDuplicateMinLength` → commit/extract |
| `maxBufferLength` ↔ recent history 창 | **일치** — `resolveRecentHistoryCompactLength`가 `min(maxBufferLength, 5000)` |
| autosave off 시 visibility 중간 저장 | **일치** — `persistRunningSnapshotForVisibilityChange`가 `runningAutoSaveEnabled`를 봄. `pagehide` 종료 스냅샷은 우회 |
| pageshow / 전경 복귀 | **일치** — `pageshow(persisted)` + `visibility=visible`에서 nonce resync · observer · top probe |
| 세션 note / entry note·text 캡 | **일치** — note 4096, entry note 2048, entry text 50_000 |
| frame nonce · origin postMessage | **일치** |
| CSV BOM · speaker 옵션 · multi-span | **일치** |
| persist queue list의 `get(null)` | **완화됨** — 정상 경로는 index + keyed `get`. `get(null)`은 인덱스 공백 재구성·테스트 리셋만 |
| SW persist 스키마 | **일치** — `isValidPersistSessionRecordPayload` |
| 롤오버 큐 기본값 | **코드 128**. CLAUDE Sync Delta 2026-07-28은 아직 **64**로 남아 문서 내부 모순 |
| CLAUDE §1 기본 검증 5개 | README/`verify`는 `check:version`·`check:injected`를 포함. §1 목록은 축약 |
| 선택 export SRT/VTT 시간 | **일치** — `exportSrt`가 `session.startedAt` 기준 상대 시간. timeRange 필터는 entry 절대 ISO (`filterEntriesByTimeRange`) — 역할이 다름 |
| `isSupportedAssemblyUrl("/main/")` | **의도적 false** — 홈은 사이트 URL, 수집/sourceUrl은 플레이어만 |
| 보조 호스트 | README에 주/보조·DNS 한계 명시. 코드는 양쪽 hostname allow |

---

## 3. High-Risk Issues

---

### H1. page-exit persist 인덱스의 read-modify-write 경쟁 → replay 누락 가능

* **위치:**  
  - `src/storage/persist-recovery.ts` — `addSessionIdToExitPersistIndex`, `removeSessionIdFromExitPersistIndex`, `listQueuedExitPersistRecords`, `rebuildExitPersistIndexFromStorage`  
  - 호출: `queueExitPersistRecord` → content `persistQueuedPageExitRecord` / SW `QUEUE_EXIT_PERSIST_RECORD`  
  - 소비: `replayQueuedExitPersistRecords` (`public-api/startup.ts`)
* **문제:** 인덱스 갱신이 `read → 배열 수정 → write`이며 **직렬화 락이 없다**. 레코드 자체는 세션별 키(`assembly-subtitle-exit-persist:{id}`)로 쓰이지만, list/replay는 **인덱스에 있는 id만** keyed `get` 한다. 인덱스가 비어 있지 않으면 prefix 전체 스캔으로 복구하지 않는다.
* **영향:** 두 탭이 거의 동시에 페이지를 닫으면 인덱스에서 한쪽 `sessionId`가 덮어써질 수 있다. 해당 레코드는 storage에 남아도 replay가 보지 못한다. **직접 persist(`PERSIST_SESSION_RECORD`)가 성공하면 데이터는 이미 저장소에 있으므로 무해**하다. 위험한 경우는 SW persist가 실패한 채 큐만 남은 상황 — 바로 page-exit 안전망이 필요한 순간이다.
* **근거:**

```47:53:src/storage/persist-recovery.ts
async function addSessionIdToExitPersistIndex(sessionId: string): Promise<void> {
  const current = await readExitPersistIndex();
  if (current.includes(sessionId)) {
    return;
  }
  await writeExitPersistIndex([...current, sessionId]);
}
```

  `listQueuedExitPersistRecords`는 `index.length === 0`일 때만 `rebuildExitPersistIndexFromStorage()`(`get(null)`)를 탄다. 부분 손실된 인덱스는 재구성하지 않는다. CodeGraph: `persistQueuedPageExitRecord`는 content runtime 3곳에서 호출.
* **권장 수정 방향:**  
  1) 인덱스 갱신을 단일 큐로 직렬화하거나, `chrome.storage.local`의 세션 키 목록을 startup replay 때 **항상 1회 prefix 스캔**해 인덱스와 병합.  
  2) 인덱스 없이 “알려진 prefix + memory merge”만으로 list (비용은 startup 1회로 한정).  
  3) 회귀 테스트: 두 세션을 동시에 `queueExitPersistRecord` 한 뒤 list에 **둘 다** 있는지.
* **우선순위:** High

---

### M1. 세그먼트 롤오버 중 bounded event queue 드롭 → 자막 누락 가능

* **위치:**  
  - `src/content/runtime/segment-event-queue.ts` — `DEFAULT_SEGMENT_ROLLOVER_EVENT_QUEUE_MAX = 128`  
  - `src/content/app/runtime/orchestrator/runtime-core.ts` — `queueSegmentRolloverEvent`, `rollOverRunningSessionSegment`
* **문제:** 롤오버 persist가 진행 중일 때 observer 이벤트는 최대 128개만 버퍼한다. 초과 시 **가장 오래된 이벤트부터 폐기**하고 누적 `droppedTotal`만 진단에 남긴다. 5차에서 64→128로 완화됐으나 **드롭 자체는 유지**된다.
* **영향:** 장시간·고밀도 자막 + 느린 IDB write 시 세그먼트 전환 구간에서 확정 자막이 일부 유실될 수 있다. 복구 UI는 없다.
* **근거:** `enqueueBoundedSegmentEvent`의 `nextQueue.slice(-safeMaxSize)`. `rollOverRunningSessionSegment`는 persist `await` 동안 `segmentRolloverInFlight`를 유지. CodeGraph: rollover 본체는 covering test 없음 (`segment-event-queue.test.ts`는 큐 헬퍼만).
* **권장 수정 방향:** 롤오버 중에도 ledger/state에 직접 반영하거나, persist 완료 전 수신 이벤트를 드롭 없이 누적하고 persist 후에 flush. 통합 테스트(대량 이벤트 + slow persist mock).
* **우선순위:** Medium

---

### M2. URL reconcile 안의 지연 `start`가 다음 주소와 엇갈릴 수 있음

* **위치:**  
  - `runtime-core.ts` — `startCapturePipelineForCurrentPage` (~2087), `performUrlReconcile` (~2112)  
  - `src/content/runtime/url-reconcile.ts` — latest-URL coalescing
* **문제:** auto-start는 reconcile **락 안에서** `startCaptureUnlocked()`를 직접 부르지 않고, 같은 `captureLifecycleLock`에 `"start"`를 **fire-and-forget으로 예약**한다(중첩 deadlock 방지용). reconcile A가 끝난 뒤 큐에는 `start(A)`가 남는다. 그사이 URL이 B로 바뀌면 flush가 `reconcile(B)`를 넣지만, 락 순서상 **`start(A)`가 `reconcile(B)`보다 먼저** 실행될 수 있다. `startCaptureUnlocked`는 `window.location.href`(이미 B)로 세션을 만든다.
* **영향:** SPA로 회의를 빠르게 바꾸면 짧은 세션이 한 번 생겼다가 곧 stop되거나, B 페이지에서 잠깐 수집된 줄이 앞 세션으로 저장될 수 있다. 빈 세션은 persist 대상이 아니라 피해가 작을 수 있으나, 자막이 이미 commit된 뒤에는 **세션 분열**이 난다.
* **근거:** 주석 그대로 “동일 큐에 start를 예약만 하고 await 하지 않는다”. lock은 FIFO. `url-reconcile.test.ts`는 컨트롤러 coalescing만 검증하고, **lock + auto-start 예약 순서**는 테스트하지 않는다.
* **권장 수정 방향:** 예약된 start가 실행될 때 `isCapturePage()`와 “reconcile이 본 목표 URL”이 같은지 검사하고, 다르면 no-op. 또는 start를 reconcile 작업의 마지막에 **같은 락 턴 안에서** URL 스냅샷과 함께 수행.
* **우선순위:** Medium

---

### M3. `runtime-core.ts` 거대 모듈 + start/stop/rollover 직접 테스트 공백

* **위치:** `src/content/app/runtime/orchestrator/runtime-core.ts` (**3098줄**)  
  CodeGraph: `startCapture` / `stopCapture` / `startCaptureUnlocked` / 인스턴스 `captureLifecycleLock` — “⚠️ no covering tests found”
* **문제:** 수집 상태·타이머·패널·persist·롤오버·URL reconcile·ownership heartbeat가 한 클로저에 있다. 헬퍼 단위 테스트는 풍부하나 오케스트레이션 경로 회귀는 `content-runtime.test.ts` 등에 부분적으로만 의존한다.
* **영향:** 작은 변경이 캡처 전체 의미론을 깨도 늦게 발견될 위험. 현재 확정 버그라기보다 **회귀·유지보수 위험**.
* **근거:** 라인 수 실측 3098. 패널 콜백이 `void startCapture().catch(...)`. History App도 `app/App.tsx` 1601줄로 유사 부채.
* **권장 수정 방향:** capture session / bridge / rollover를 순수 서비스로 추가 분리. fake timers + mock store로 start→commit→rollover→URL 변경→stop 시나리오 통합 테스트.
* **우선순위:** Medium

---

### M4. History 검색·startup cleanup이 IndexedDB 전체 hydrate

* **위치:**  
  - `src/storage/session-store/public-api/queries.ts` — `searchSessions`가 `listAllIndexedDbSessions()`  
  - `src/storage/session-store/public-api/startup.ts` — `closeRunningSessionsOnStartup`도 `listAllIndexedDbSessions()`  
  - IDB에는 이미 `status` 인덱스가 있음 (`idb/database.ts`)
* **문제:** 목록 페이징은 store-level인데, **전체 기록 검색**과 **시작 시 running 정리**는 세션 전체를 메모리로 올린다. CLAUDE는 History 목록의 임의 cap preload를 금지하지만, search는 사실상 전체 스캔이다.
* **영향:** 세션·엔트리가 많은 라이브러리에서 History 검색 지연, 확장 시작 시 SW 응답 악화 **가능**. 데이터 손상 직접 원인은 아님.
* **근거:** `searchSessions` L379–382. startup L199–202. `status` 인덱스는 만들어 두고 running 조회에 쓰지 않음.
* **권장 수정 방향:** startup은 `status="running"` 인덱스만 hydrate. 검색은 metadata-first + 필요 id만 hydrate, 또는 전용 검색 인덱스. 대량 픽스처로 시간 상한 회귀.
* **우선순위:** Medium

---

### M5. 실중계 런타임 e2e 공백 (사이트 DOM 계약 회귀)

* **위치:** 수집 경로 전반 (`subtitle-rows`, `injected-observer`, `dom-probe`, `subtitle-layer`)  
  참고: `SITE_COMPATIBILITY_REVIEW_2026-08-10.md` §1.2, `LIVE_CAPTURE_SMOKE_CHECKLIST.md`
* **문제:** 정적 HTML·셀렉터·화자색 계약은 검토됐으나, 생중계 중 WebSocket/`.smi_word` 제자리 갱신·미확정→확정 전환은 오프라인에서 최종 검증 불가. 로컬 테스트는 fixture·jsdom 중심.
* **영향:** 국회 사이트 배포 후 수집 품질 급변 시 자동 감지 어려움. **추정 아님 — 호환 문서가 한계를 명시.**
* **근거:** 호환 문서 “런타임 스모크는 중계 재개 후 권장”. `tests/e2e-smoke.mjs` / extension smoke는 확장 로드·페이지 수준.
* **권장 수정 방향:** 체크리스트 실행(structured / fallback / multi-span / 본회의 raw). 가능하면 Playwright 녹화 픽스처 갱신.
* **우선순위:** Medium (품질 잔여 리스크)

---

### M6. page-exit 큐가 `chrome.storage.local`에 세션 전문을 넣고 `unlimitedStorage`가 없음

* **위치:**  
  - `manifest.json` permissions: `storage`만 (`unlimitedStorage` 없음)  
  - `persist-recovery.ts` — `queueExitPersistRecord`가 세션 전체 clone을 local에 set  
  - content `persistSessionRecord`는 세션 전체를 `PERSIST_SESSION_RECORD` 메시지로 SW에 전달
* **문제:** MV3 기본 `storage` 할당은 약 **10 MB**. 큐는 IDB 성공 여부와 무관하게 종료 스냅샷을 local에 한 번 더 넣는다. capacity preset은 세그먼트당 최대 4000줄·24만 자. persist 메시지에는 **엔트리 개수 상한(5만)만** 있고 바이트 상한은 없다 (`DOWNLOAD_REQUEST`만 2 MiB).
* **영향:** 대형 세션 page-exit + fallback 잔존 + 설정/nonce가 겹치면 quota로 큐 write가 실패할 수 있다. 메모리 큐는 남지만 **프로세스가 곧 죽으면** 복구 불가. 일상적인 위원회 세션(수 MB 미만)에서는 잘 안 드러날 가능성이 크다.
* **근거:** manifest 권한 목록. `queueExitPersistRecord` L283–287. `isValidPersistSessionRecordPayload`는 `entries.length > 50_000`만 reject. `saveFallbackRecord`는 quota 시 memory rollback을 하지만, 큐 경로는 storage 실패를 throw하고 메모리 Map은 유지.
* **권장 수정 방향:** 큐에는 metadata+entry 요약 또는 IDB에 먼저 쓰고 local에는 id/updatedAt만 남기기. 필요 시 `unlimitedStorage`와 스토어 권한 문안 갱신. persist 메시지에 바이트 상한 + 초과 시 “세션 id만 보내고 SW가 content port로 청크” 설계.
* **우선순위:** Medium

---

### L1. lineage 병합 뷰/export에서 세션 `note`가 빈 문자열로 고정

* **위치:** `src/core/session-lineage.ts` — `mergeSessionSegments`  
  사용: History `displaySession`, `exportSessionLineageData`
* **문제:** 여러 세그먼트를 합칠 때 `note: ""`를 강제한다. 목록/상세의 메모 편집은 `updateSessionLineageMetadata`로 세그먼트에 남지만, **라인리지 JSON/문서 export 본문에는 메모가 빠진다.**
* **영향:** “연속 캡처 전체 내보내기”를 한 사용자가 메모가 사라졌다고 느낄 수 있다. 저장소의 세그먼트 note는 유지.
* **근거:** `mergeSessionSegments` L93 `note: ""`. History는 `lineageViewEnabled`일 때 이 객체를 `displaySession`으로 쓴다.
* **권장 수정 방향:** 공통 note가 있으면 유지, 다르면 첫 세그먼트 note 또는 이어 붙이기. lineage JSON에 `segments[].note`를 남기는 편이 더 안전.
* **우선순위:** Low

---

### L2. CLAUDE.md 내부 수치·검증 명령 불일치

* **위치:** `CLAUDE.md` Sync Delta 2026-07-28 vs 2026-08-12; §1 검증 명령 vs README `verify`
* **문제:** 같은 파일에 롤오버 큐 기본값이 **64**와 **128**로 같이 있다. §1은 `lint/typecheck/test/build/verify:e2e`만 적고, 이후 delta와 README는 `check:version`·`check:injected`를 게이트에 포함한다.
* **영향:** 후속 에이전트가 구 수치(64)나 축약 게이트를 기준으로 구현할 수 있다. 런타임 버그는 아님.
* **근거:** CLAUDE L511 vs L542; §1 L15–20 vs README `npm run verify`.
* **권장 수정 방향:** 최신 delta만 남기거나 구 수치에 “superseded” 표시. §1 검증 목록을 `verify`와 맞추기.
* **우선순위:** Low

---

### L3. `flushPendingPreviews` API가 persist 경로 밖에 남아 있음

* **위치:** `src/core/subtitle-pipeline/commit.ts` — `flushPendingPreviews`  
  대비: `session-lifecycle.ts`는 `pendingPreviews = []`만 수행
* **문제:** 현재 저장 경로는 flush를 쓰지 않아 CLAUDE와 일치. 다만 public export가 남아 있어 이후 호출이 재도입되면 preview-only가 저장될 수 있다.
* **영향:** 현재 기본 경로 버그 아님. 회귀 함정.
* **근거:** 저장소 전역 `flushPendingPreviews` 참조는 facade re-export와 정의뿐. `tests/session-lifecycle.test.ts`가 prepare 후 pending 비승격을 고정.
* **권장 수정 방향:** deprecated/제거 또는 “persist에서 호출 금지” 테스트를 유지.
* **우선순위:** Low

---

### L4. persist 페이로드·세션 id 방어가 최소 수준

* **위치:**  
  - `isValidPersistSessionRecordPayload` — id/status/updatedAt/entries 배열·개수만  
  - `sanitizeSessionId` — trim만, 길이 상한 없음  
  - `enqueueSessionWrite("")`는 **큐를 건너뛰고** 즉시 실행
* **문제:** 확장 내부 발신만 받으므로 외부 페이지 직접 공격은 어렵다. 손상된 content·테스트 더블이 빈 id·거대 id·기형 entry를 넣으면 write 큐가 무력화되거나 저장소 키가 비대해질 수 있다. History JSON import 정상 경로는 `sanitizeStoredSessionRecord`가 빈 id를 거른다.
* **영향:** 정상 UI 경로 영향은 작음. 방어 심화 이슈.
* **근거:** `session-write-queue.ts` L12–14. `normalize.ts` `sanitizeSessionId`. SW validator L34–60.
* **권장 수정 방향:** 빈 id reject, id 길이 캡(예: 128), persist 바이트 상한. import와 동일한 entry sanitize를 SW 경계에서 한 번 더.
* **우선순위:** Low

---

### L5. 페이지 world host command로 수집 제어 가능 (문서화된 전제)

* **위치:** `src/content/inpage-panel/controller/render.ts` — `PANEL_HOST_COMMAND_EVENT`  
  `start` / `stop` / `save` / `clear` / `click-button`
* **문제:** production shadow는 closed이지만, 호스트 light DOM에서 CustomEvent로 시작·중지·저장을 부를 수 있다. `clear`만 `window.confirm`을 탄다.
* **영향:** 의사중계 페이지 XSS가 있으면 수집을 원격 조작 가능. `SECURITY.md`가 신뢰 호스트 전제로 명시. 제품 범위 밖이지만 기능 표면으로는 남아 있다.
* **근거:** `types.ts` command union. SECURITY.md §5.
* **권장 수정 방향:** 유지 가능. 강화 시 e2e 전용 빌드 플래그로 명령을 끄기.
* **우선순위:** Low (알려진 위협 모델)

---

### L6. multi-tab capture는 soft ownership — 기록이 둘로 갈라질 수 있음

* **위치:** `src/content/runtime/capture-ownership.ts` (호출: `startCaptureUnlocked`)
* **문제:** 하드 블록이 아니라 경고. README에도 안내된 제품 동작.
* **영향:** 같은 회의 다중 탭 시 lineage 분기·중복 기록. 데이터 손상은 아님.
* **우선순위:** Low (알려진 제품 한계)

---

### 5차 항목 중 6차에서 해소된 것으로 확인한 것

| 5차 ID | 요약 | 6차 상태 |
|--------|------|----------|
| M2 (구) | persist list `get(null)` | **완화** — 정상 list는 index. 남은 문제는 **인덱스 RMW**(본 문서 H1) |
| L1 (구) | SW persist 스키마 없음 | **해소** — `isValidPersistSessionRecordPayload` + 테스트 |
| L2 (구) | qualityStats / id 정규화 | **해소** — `sanitizeQualityStats` / `sanitizeSessionId` |
| L4 (구) | flush가 persist에 쓰일 위험 | **경로상 해소**, API 잔존은 L3 |
| L5 (구) | multi-span 테스트 | **개선** — `subtitle-rows.test.ts` 7 tests |
| POTENTIAL 1-1 | `recentDuplicateMinLength` 미반영 | **해소** |
| POTENTIAL 1-2 | `bytesToBase64` 한글자 += | **완화** — 32KB 청크 |
| POTENTIAL 1-3 | `display:block` 강제 | **해소** — 코드가 명시적으로 하지 않음 |
| POTENTIAL 2-2 / 2-3 | pageshow · autosave+visibility | **해소** |
| POTENTIAL 2-5 | note 길이 없음 | **해소** — 4096 + UI `maxLength` |

---

## 4. Potential Functional Gaps

확실하지 않은 항목은 **추정**으로 표시한다.

| 항목 | 상태 | 설명 |
|------|------|------|
| 롤오버 중 드롭된 자막 재합성 | 갭 (사실: drop only) | M1. 사용자 복구 UI 없음 |
| persist index 원자성 | 갭 | H1. 동시 종료 탭에서 고아 레코드 가능 |
| 실중계 자동 e2e | 갭 | M5 |
| WebVTT `<v Speaker>` 표준 화자 | 미구현 | cue 텍스트 접두만 (의도적일 수 있음) |
| 외국어 noise filter 확대 | 문서상 범위 외 | 필터 off 권장 — README/CLAUDE 일치 |
| 사이드 패널 | 부분 구현 (사실) | `sidepanel/main.tsx`가 popup을 그대로 렌더. 메인 UX는 in-page |
| History 검색 전문 색인 | 미구현 | `searchSessions` 전체 hydrate — M4 |
| 프리셋에 발언자 옵션 | 없음 | 수요는 **추정** 낮음 |
| 라인리지 export의 세션 메모 | 갭 (사실: `note: ""`) | L1 |
| persist 메시지 청크 | 없음 | M6. 대형 세션은 SW 메시지 한 방에 의존 |
| `txtExportSpeakerEnabled` 키 이름 | 레거시 | TXT+SRT+VTT+MD+CSV+복사. alias `exportSpeakerEnabled` 있음 |
| 진단에 롤오버 drop 누적 | 부분 | 패널/options `segmentRollover.droppedTotal`은 있음. 영속 지표는 **추정** 약함 |
| 같은 탭에서 멈춘 뒤 재진입 auto-start | 의도+쿨다운 | `autostart-cooldown` 있음. “멈췄는데 다시 모임” 체감은 제품 설명 이슈 |
| `confirmSessionClear`가 `window.confirm` 부재 시 true | 사실 | 자동화/비정상 환경에서 확인 없이 비움. 브라우저 정상 경로에서는 confirm 존재 |
| 4차·POTENTIAL_ISSUES 본문 | 문서 부채 | 권위는 본 파일. POTENTIAL 상단도 이를 가리킴 |

---

## 5. Recommended Fix Plan

### 1단계 — 즉시 (복구 누락·세션 분열 방지)

1. **exit-persist 인덱스 원자성 (H1):** 인덱스 mutate 직렬화, 또는 startup replay 시 prefix 스캔으로 고아 레코드 병합. 동시 queue 테스트 추가.  
2. **URL 전환 start 가드 (M2):** start 실행 시 목표 URL/`isCapturePage()` 불일치면 no-op. lock+reconcile+auto-start 순서 테스트.  
3. **문서 정합 (L2):** CLAUDE 롤오버 큐 64 문구를 128로 정리, §1 검증 명령을 `verify`와 맞추기.

### 2단계 — 안정성

1. **롤오버 중 이벤트 손실 축소 (M1):** 상태 직접 반영 또는 persist 중 무제한 버퍼 + 백프레셔 notice.  
2. **storage 할당 (M6):** 큐를 얇게 만들거나 persist 바이트 상한. quota 실패를 options 복구 상태에 명확히.  
3. **검색/startup 부분 hydrate (M4):** `status` 인덱스 사용, search metadata-first.  
4. **lineage note 보존 (L1).**  
5. **실중계 스모크 (M5):** `LIVE_CAPTURE_SMOKE_CHECKLIST.md` 실행.

### 3단계 — 구조 개선

1. **`runtime-core` 분해 (M3):** session service / bridge / rollover.  
2. **History App 추가 분리:** long-task·export·draft를 훅 밖으로.  
3. **persist 메시지 청크** (M6 장기).  
4. **e2e:** 녹화 픽스처 + 선택적 실사이트 프로브.

---

## 6. Test Recommendations

### 현재 상태 (사실)

- `npm run test` (2026-08-18, 권고 구현 후): **72 files, 389 tests, 전부 통과**.  
- 커버가 두꺼운 영역: session-store, pipeline, persist-recovery 헬퍼, frame nonce, export formats, settings sanitize, autosave, page-exit 헬퍼, ownership, SW command 스키마.  
- 얇은 영역: `runtime-core` start/stop/rollover/URL+auto-start 오케스트레이션, persist **인덱스 동시성**, 실사이트 DOM.

### 추가·보강 권장

| 테스트 | 목적 | 관련 |
|--------|------|------|
| 동시에 `queueExitPersistRecord` 두 sessionId | list/replay에 둘 다 존재 | H1 |
| 인덱스에 id가 없고 레코드 키만 있는 고아 | startup replay가 복구 | H1 |
| reconcile(A) 중 location=B + 예약된 start | start no-op 또는 B만 수집 | M2 |
| rollover persist hang + 200 이벤트 | drop 수·남은 큐·notice | M1 |
| start → structured commit → rollover → stop | runtime 오케스트레이션 | M3 |
| `searchSessions` / startup이 running만 읽는지 (spy) | 전체 hydrate 회귀 방지 | M4 |
| `mergeSessionSegments` note 보존 | lineage export | L1 |
| persist payload 빈 id / 과대 entries | SW reject | L4 |
| `buildPreparedSessionState` + non-empty `pendingPreviews` | entry 증가 없음 (유지) | L3 |
| 실중계 수동/반자동 checklist | DOM 계약 | M5 |

### 검증 게이트 (변경 시)

```bash
npm run check:version
npm run check:injected
npm run lint
npm run typecheck
npm run test
npm run build
# 의미 있는 배포 전
npm run verify
# 또는
npm run verify:e2e
```

---

## 7. Appendix: CodeGraph 관찰 요약

| 관찰 | 의미 |
|------|------|
| `bootstrap` → `mountInPagePanel` → `startCapture` | 패널이 수집 시작의 UI 진입점 |
| `startCapture` = `captureLifecycleLock.run("start", startCaptureUnlocked)` | 락 우회 직접 호출은 auto-start 예약 한 곳. unlocked는 reconcile stop에 사용 |
| `saveSession` / write 큐 / preserve metadata | 메타·본문 경쟁 완화됨 |
| `persistQueuedPageExitRecord` | queue 실패 시 background QUEUE 재시도 후 persist fire-and-forget |
| start/stop/rollover 직접 테스트 공백 | M3 근거 |
| 테스트 375 통과 | 현재 회귀 기준선 양호 |

---

## 8. Appendix: 감사 범위별 점검 결과

| 범위 | 결과 |
|------|------|
| 잠재 기능 결함 | H1(인덱스 경쟁), M1(롤오버 드롭), M2(URL+start 경합)이 실코드 근거 있음 |
| 누락된 예외 처리 | persist/queue/import는 대체로 catch. `confirm` 부재 시 clear가 true (L 수준) |
| 사용자 입력 검증 | 설정 숫자는 draft 검증. filename 금지문자. import allow-list. persist 바이트·id 길이는 약함 |
| 상태/데이터 흐름 | committed-only는 유지. lineage merge note 소거. search 전체 hydrate |
| 비동기·race | write 큐·lifecycle lock은 있음. **persist index와 reconcile-start 예약**이 빈틈 |
| 경로·인코딩·OS | CSV BOM+CRLF. filename sanitize 전역. Windows 개발 환경에서 테스트 통과 |
| DB/캐시/설정 | IDB schema 5, record version 4, TTL disable. local 10MB + 큐 전문 저장 |
| 보안 | host XSS는 범위 밖(SECURITY.md). persist는 자체 확장만. innerHTML 없음 |
| 테스트 | 단위 375 통과. 오케스트레이션·동시성·실사이트 공백 |
| 문서 어긋남 | CLAUDE 64 vs 128, §1 검증 목록 축약. 기능 의미론은 대체로 일치 |

---

*본 문서는 기능 구현 감사 결과이며, 코드 변경 없이 작성되었다. 후속 작업 시 §5 Fix Plan을 우선순위로 쓰면 된다.*
