# Project Audit

**대상:** `korea-assembly-cc-chrome` (국회 AI 자막 추출 Chrome Extension)  
**감사 일자:** 2026-08-12 (5차 · **전 기능 구현 관점** 재감사)  
**배포 버전 기준:** `package.json` / README `1.0.13`  
**방법:** `README.md` · `CLAUDE.md` 정독 → CodeGraph MCP로 엔트리·호출 관계·blast radius 분석 → 고위험 경로 보조 대조 → `npm run test` (감사 시 361 passed)  

**관련 문서:** 보안·성능·a11y·CI·아키텍처 비용 등 **비기능 범위**는 `PROJECT_AUDIT_NONFUNCTIONAL.md` 를 본다.

> **구현 반영 (2026-08-12, 감사 직후)**  
> §5 Fix Plan 1–3단계 핵심 항목을 코드에 반영했다. 회귀: **68 files / 372 tests 통과**.  
> - M1: 롤오버 큐 128, 시작 시 큐 비우기 제거, 진단 `segmentRollover` + options UI  
> - M2: exit-persist **index** 키로 list 시 `get(null)` 회피(마이그레이션 1회 스캔)  
> - M3/L5: `segment-rollover-diagnostics` 추출, multi-span·normalize·SW·prepare 테스트 보강  
> - M4: README 주/보조 호스트 안내  
> - M5: `LIVE_CAPTURE_SMOKE_CHECKLIST.md`  
> - L1/L2: SW persist 스키마 검증, `sanitizeSessionId`/`sanitizeQualityStats`  
> - L4: pendingPreviews 회귀 테스트 강화  
> - 설정: `exportSpeakerEnabled` → `txtExportSpeakerEnabled` alias  
> 남은 대형 작업: `runtime-core` 전면 분해, History App 추가 분리, 실중계 수동 스모크 실행.  

> **5차 범위**  
> 수집 파이프라인, 영속화(IDB/fallback/queue), page-exit 복구, export/download, import sanitize,  
> 브리지/nonce 보안, 비동기·race, 설정 반영, 문서-구현 정합, 테스트 공백.  
>
> **이전 감사와의 관계**  
> - 1–3차: lifecycle lock, write 큐, IDB TTL, CSV BOM, messaging, 롤오버 큐, timeRange 등 기반 안정화.  
> - 4차(2026-08-10): 발언자 UI/export 정합 중심.  
> - **5차 확인:** 4차 Medium 다수는 코드상 **이미 해소**됨 (아래 §1·§3 “해소된 항목”). 본 문서는 **현재 코드 기준 잔존 위험**만 고위험으로 싣는다.

**주의:** 코드는 수정하지 않았다. High-Risk는 실제 코드 근거가 있는 항목만 싣고, 추정은 §4에 분리한다.

---

## 1. Executive Summary

이 제품은 국회 의사중계 AI 자막을 **수집 → 로컬 확정 저장 → History · 다형식 export** 하는 Manifest V3 확장이다. 저장소 성숙도가 높고(큐·락·fallback·replay·import allow-list·export 한도 등), 단위/통합 테스트 **66 files · 361 tests 전부 통과**했다.

**전체 위험도: Low–Medium**

| 등급 | 개수(5차 잔존) | 요약 |
|------|----------------|------|
| Critical | 0 | 전손·원격 RCE·의도적 데이터 유출 경로는 확인되지 않음 |
| High | 0 | 확정 High 없음 |
| Medium | 5 | 롤오버 중 이벤트 드롭, storage 전체 스냅샷 비용, runtime 거대 모듈 회귀, 보조 호스트 DNS, 실사이트 e2e 공백 |
| Low | 다수 | SW 메시지 스키마 방어 심화, qualityStats 정규화 약함, multi-tab soft split, 일부 심볼 직접 테스트 부재 |

**강점 (사실):**

- 수집 의미론이 문서와 대체로 일치: committed entry만 persist/export, preview-only 비승격 (`buildPreparedSessionState`가 `pendingPreviews` 비움).  
- `captureLifecycleLock` + `enqueueSessionWrite` + IDB soft-disable TTL + fallback memory rollback.  
- page-exit queue merge · startup replay-before-cleanup · diagnostics.  
- import는 `session-backup` allow-list + 타임스탬프/버전 검증, running→saved 정규화.  
- export: offscreen Blob 우선, `DATA_URL`/`DOWNLOAD_REQUEST` 2 MiB 한도, CSV UTF-8 BOM, speaker 옵션 포맷 연동.  
- 브리지: page-world `postMessage` origin 고정, observer token, frame-forward nonce + mismatch resync.  
- 4차 지적(TXT 접두 불일치, MD/CSV 옵션 무시, estimate speaker 미반영, multi-span 미분할, speakerChanged 미설정 등)은 **1.0.13 코드에서 대체로 수정됨**.

**한 줄 결론:** 기능 골격은 안정적이고 Critical 수정은 불필요하다. 남은 과제는 **장시간 수집 중 롤오버 버퍼 손실 완화**, **storage 전체 읽기 비용**, **runtime-core 분해·통합 테스트**, **실중계 e2e**, **보조 호스트/문서 운영 정리**다.

---

## 2. Project Understanding

### 2.1 목적 (README / CLAUDE)

| 항목 | 내용 |
|------|------|
| 제품 | 국회 의사중계 AI 자막 실시간 수집 · 로컬 저장 · History · TXT/SRT/VTT/JSON/MD/CSV |
| 호스트 | `assembly.webcast.go.kr`, `webcast.assembly.go.kr` |
| 수집 범위 | 플레이어(`main/player*`, `pressplayer*`); 홈(`/main`)은 패널·진단만 |
| 스택 | MV3 · TypeScript(7 typecheck / 6 ESLint) · React · Vite · Vitest · IndexedDB(+chrome.storage/memory fallback) |
| 저장 원칙 | 확정(committed) 자막만 persist/export; preview-only 승격 금지 |
| 검증 | `lint` / `typecheck` / `test` / `build` / `verify:e2e` (`verify`에 check:version·injected 포함) |

### 2.2 주요 실행 흐름 (CodeGraph)

```text
content-script bootstrap (멱등)
  └─ createContentRuntime → orchestrator/runtime-core
       ├─ mountInPagePanel
       ├─ bindBridgeMessages (observer token + frame-forward nonce)
       ├─ startCapturePipeline / startCapture (captureLifecycleLock)
       │    ├─ injected-observer (page world MutationObserver)
       │    ├─ local-polling / top-frame fallback
       │    ├─ live-capture ledger + subtitle-pipeline (commit/merge)
       │    ├─ scheduleRunningPersist (entries 있을 때만)
       │    └─ segment rollover (persist → continued state + event queue)
       ├─ stop / page-exit → prepared snapshot → persist + queue replay
       └─ export/copy → DOWNLOAD_SESSION_EXPORT / page Blob (History)

background service-worker
  ├─ frame-forward nonce lifecycle (tab loading rotate / remove clear)
  ├─ startup persistence (debounce guard → replay → close running)
  └─ export download (offscreen Blob → data: ≤2MiB)

session-store
  ├─ mutations: save/updateRunning (write 큐 + preserve metadata)
  ├─ idb open TTL soft disable + tryIndexedDb
  ├─ fallback: chrome.storage + memory rollback on quota/fail
  └─ import-export: normalize + createSessionExportPayload
```

### 2.3 핵심 모듈 맵

| 영역 | 경로 | 역할 |
|------|------|------|
| Content bootstrap | `src/content/content-script.ts`, `app/runtime/` | facade → runtime-core |
| Capture lock | `src/content/runtime/capture-lifecycle-lock.ts` | start/stop/clear/export 직렬화 |
| Pipeline | `src/core/subtitle-pipeline/*` | extract / commit / history / lifecycle |
| Rows | `src/content/subtitle-rows.ts` | structured rows · multi-span 화자 분할 |
| Session store | `src/storage/session-store/*` | IDB · fallback · public API |
| Persist recovery | `src/storage/persist-recovery.ts` | page-exit queue |
| Background | `src/background/service-worker*.ts` | export · nonce · startup |
| History / Options / Popup | `src/history/`, `options/`, `popup/` | React UI |
| Import sanitize | `src/storage/session-backup.ts` | JSON allow-list |

### 2.4 문서·구현 정합 (요약)

| 주제 | 정합 |
|------|------|
| committed-only save/export | 일치 (`buildPreparedSessionState` clears `pendingPreviews`) |
| `recentDuplicateMinLength` 설정 반영 | 일치 (`resolveRecentDuplicateMinLength` → extract) |
| autosave empty running 금지 | 일치 (`hasPersistableRunningContent` = running && entries>0) |
| frame nonce · origin postMessage | 일치 |
| CSV BOM · speaker 옵션 · multi-span | 일치 (1.0.13 / CLAUDE Sync Delta 2026-08-10) |
| `panelSpeakerHighlightEnabled` 기본값 | 일치 (`false` in `DEFAULT_EXTENSION_SETTINGS`) |
| 보조 호스트 `webcast.assembly.go.kr` | 문서·manifest 지원 vs 실측 DNS 실패 가능 (사이트 호환 문서 참고) |
| 4차 감사 문서 일부 | **구식** (MD/CSV always speaker, TXT plain 등 현재 코드와 불일치 → 본 5차가 대체) |

---

## 3. High-Risk Issues

Critical / High 는 없다. 아래는 근거 있는 Medium·Low.

---

### M1. 세그먼트 롤오버 중 bounded event queue 드롭 → 자막 누락 가능

* **위치:**  
  - `src/content/runtime/segment-event-queue.ts` — `DEFAULT_SEGMENT_ROLLOVER_EVENT_QUEUE_MAX = 64`, `enqueueBoundedSegmentEvent`  
  - `src/content/app/runtime/orchestrator/runtime-core.ts` — `queueSegmentRolloverEvent`, `rollOverRunningSessionSegment`
* **문제:** 롤오버 persist가 진행 중일 때 들어오는 observer 이벤트는 최대 64개만 버퍼한다. 초과 시 **가장 오래된 이벤트부터 폐기**하고 패널 notice만 남긴다.
* **영향:** 장시간·고밀도 자막 + 느린 IDB write 시, 세그먼트 전환 구간에서 확정 자막이 일부 유실될 수 있다. 사용자에게 드롭 건수는 안내되나 **복구 불가**.
* **근거:** `nextQueue.slice(-safeMaxSize)` 로 drop; `segmentRolloverInFlight` 동안 이벤트가 큐에만 쌓임; CodeGraph blast: `rollOverRunningSessionSegment` 직접 covering test 약함.
* **권장 수정 방향:**  
  1) 롤오버 중 수신 이벤트를 메모리 state에 직접 반영(큐 없이 ledger 갱신)하거나,  
  2) 큐 상한을 설정화·동적 확장하고 drop 시 진단 카운터를 options에 영속화,  
  3) 롤오버 통합 테스트(대량 이벤트 + slow persist mock).
* **우선순위:** Medium

---

### M2. page-exit replay 목록이 `chrome.storage.local.get(null)` 전체 스냅샷에 의존

* **위치:** `src/storage/persist-recovery.ts` — `listQueuedExitPersistRecords`  
  (유사 패턴: fallback clear 경로 `fallback/storage.ts` 의 `get(null)`)
* **문제:** 큐 레코드 접두 키만 필요해도 storage **전체**를 읽는다. fallback 레코드·다운로드 URL 맵·설정·nonce 등이 커지면 읽기 비용·메모리 피크가 커진다.
* **영향:** 확장 재시작·startup maintenance 지연, 저사양 환경에서 SW 수명/응답 악화 **가능**. 데이터 손상 직접 원인은 아님.
* **근거:** `const snapshot = await chrome.storage.local.get(null)` 후 prefix 필터.
* **권장 수정 방향:** 전용 index 키(세션 ID 목록)를 유지하거나, 알려진 prefix 키 목록을 별도 index에 두고 `get(keys)` 로 제한. 회귀 테스트로 대량 키 시나리오.
* **우선순위:** Medium

---

### M3. `runtime-core.ts` 거대 모듈 + start/stop/rollover 직접 테스트 공백

* **위치:** `src/content/app/runtime/orchestrator/runtime-core.ts` (~2800 lines)  
  CodeGraph: `startCapture` / `stopCapture` / `rollOverRunningSessionSegment` / `bindBridgeMessages` / `scheduleRunningPersist` — “⚠️ no covering tests found” (헬퍼 단위 테스트는 존재)
* **문제:** 수집 상태·타이머·패널·persist·롤오버·URL reconcile이 한 모듈 클로저에 집중. 단위 헬퍼 테스트는 풍부하나 **오케스트레이션 경로 회귀**는 `content-runtime` 등에 부분적으로만 의존.
* **영향:** 작은 변경이 캡처 전체 의미론을 깨뜨려도 늦게 발견될 위험. 기능 버그라기보다 **회귀·유지보수 위험**.
* **근거:** 라인 수 실측 ~2800; CodeGraph blast radius 다수 no covering tests; 패널 콜백이 `void startCapture().catch(...)` fire-and-forget.
* **권장 수정 방향:**  
  1) capture lifecycle / rollover / bridge bind를 순수 서비스로 추가 분리,  
  2) fake timers + mock store 로 start→commit→rollover→stop 시나리오 통합 테스트,  
  3) “수집 중 URL 변경 시 stop+persist” 계약 고정 테스트.
* **우선순위:** Medium

---

### M4. 보조 호스트 `webcast.assembly.go.kr` 도달 불안정 vs “지원 사이트” 표기

* **위치:** `src/shared/constants.ts` · `manifest.json` · `README.md`  
  근거 문서: `SITE_COMPATIBILITY_REVIEW_2026-08-10.md` (감사 시점 DNS 실패 기록)
* **문제:** 제품·권한은 두 호스트를 동등 지원으로 노출하지만, 실측상 보조 호스트가 DNS 실패할 수 있다. 코드 버그는 아니나 **사용자 기대·스토어 설명**과 어긋날 수 있다.
* **영향:** 보조 호스트 접속 실패 시 확장 “미동작” 오인. 주 호스트만으로 핵심 기능은 유지.
* **근거:** 사이트 호환 문서 §2 “DNS 해석 실패”; 코드는 양쪽 hostname allow.
* **권장 수정 방향:** README에 “주 호스트 권장, 보조는 네트워크 상태에 따라 불가할 수 있음” 명시. 장기: 실 DNS 모니터링 후 manifest 정리 여부 결정.
* **우선순위:** Medium (운영/문서)

---

### M5. 실중계 런타임 e2e 공백 (사이트 DOM 계약 회귀)

* **위치:** 수집 경로 전반 (`subtitle-rows`, `injected-observer`, `dom-probe`, `subtitle-layer`)  
  참고: `SITE_COMPATIBILITY_REVIEW_2026-08-10.md` §1.2 한계
* **문제:** 정적 HTML·셀렉터·화자색 계약은 검토됐으나, 생중계 중 WebSocket/`.smi_word` 제자리 갱신·미확정→확정 전환은 오프라인 시 최종 검증 불가. 로컬 테스트는 fixture·jsdom 중심.
* **영향:** 국회 사이트 배포 후 수집 품질 급변 시 자동 감지 어려움. **추정 아님 — 호환 문서가 한계를 명시.**
* **근거:** 호환 문서 “런타임 스모크는 중계 재개 후 권장”; `tests/e2e-smoke.mjs` / extension smoke는 확장 로드 수준.
* **권장 수정 방향:** 중계 재개 시 체크리스트( structured / fallback / multi-span / plenary raw ) 수동 또는 Playwright 녹화 픽스처 갱신. DOM contract 스냅샷 테스트 유지.
* **우선순위:** Medium (품질 잔여 리스크)

---

### L1. Background `PERSIST_SESSION_RECORD` / `QUEUE_EXIT_PERSIST_RECORD` 페이로드 스키마 검증 약함

* **위치:** `src/background/service-worker-commands.ts` — `handleBackgroundCommand`  
  후속: `saveSession` → `normalizeSessionRecord`
* **문제:** 확장 자체 발신(`isMessageFromOwnExtension`)만 검사하고 `message.record` 구조 스키마는 없다. 정상 경로는 content가 prepared record를 보내며 `saveSession`이 normalize한다. 방어 심화 관점에서는 거대·기형 객체가 SW에 들어올 여지.
* **영향:** 외부 웹 페이지 직접 공격은 어렵다(확장 ID 경계). 손상된 content context·버그 시 저장소에 비정상 레코드 유입 가능. import allow-list 수준은 아님.
* **근거:** case 분기에서 `message.record` 즉시 전달; `normalizeSessionRecord`는 `id` 타입 강제·`qualityStats` 깊은 sanitize 없이 shallow copy.
* **권장 수정 방향:** SW 경계에서 `sanitizeStoredSessionRecord` 또는 최소 id/entries/updatedAt 검증 후 reject. 크기 상한.
* **우선순위:** Low

---

### L2. `normalizeSessionRecord`의 `qualityStats` · `id` 검증 불완전

* **위치:** `src/storage/session-store/normalize.ts` — `normalizeSessionRecord`
* **문제:**  
  - `qualityStats`는 object면 `{ ...session.qualityStats }` 만 수행 (`session-backup.sanitizeQualityStats`와 불일치).  
  - `id`가 비문자열이어도 그대로 통과 (import 경로는 사전 sanitize).
* **영향:** History JSON import 정상 경로는 안전. 다른 호출부·손상 데이터에서 메타 오염. 기능 핵심 경로 영향은 작음.
* **근거:** normalize L109–118 vs `session-backup.ts` `sanitizeQualityStats` / `sanitizeStoredSessionRecord`.
* **권장 수정 방향:** normalize에서 `sanitizeQualityStats` 재사용, `id`는 non-empty string 강제.
* **우선순위:** Low

---

### L3. multi-tab capture는 soft ownership — 기록이 둘로 갈라질 수 있음

* **위치:** `src/content/runtime/capture-ownership.ts` (호출: `startCaptureUnlocked` multiTab 경고 notice)
* **문제:** 하드 블록이 아니라 경고. 의도된 제품 동작(README에도 안내).
* **영향:** 같은 회의 다중 탭 시 lineage 분기·중복 기록. 데이터 손상은 아니나 UX 혼란.
* **근거:** soft claim + 패널 안내 문구; CLAUDE Sync Delta multi-tab soft ownership.
* **권장 수정 방향:** 유지 가능. 강화 시 옵션 “다른 탭 수집 시 시작 차단”.
* **우선순위:** Low (알려진 제품 한계)

---

### L4. `flushPendingPreviews`는 여전히 preview를 entry로 materialize 가능

* **위치:** `src/core/subtitle-pipeline/commit.ts` — `flushPendingPreviews`  
  대비: `src/content/session-lifecycle.ts` — `buildPreparedSessionState` 는 `pendingPreviews = []` 만 수행
* **문제:** 현재 저장 경로는 flush를 쓰지 않아 CLAUDE 의미론과 일치. 다만 flush API가 남아 있어 향후 호출 재도입 시 preview-only가 저장될 위험.
* **영향:** 현재 기본 경로 버그 아님. 회귀 함정.
* **근거:** CodeGraph: prepared path clears only; flush applies `applyPreview` per pending.
* **권장 수정 방향:** flush를 deprecated/제거하거나 “export 전용 아님” 주석 + 호출 금지 테스트(prepare 후 pending 비어 있고 entry 증가 없음).
* **우선순위:** Low

---

### L5. `collectMultiSpeakerSegments` 직접 단위 테스트 약함

* **위치:** `src/content/subtitle-rows.ts` — `collectMultiSpeakerSegments` (CodeGraph no covering tests)
* **문제:** multi-span 분할은 구현됐으나 심볼 단위 테스트가 약하면 span 구조 변경 시 회귀 감지 지연.
* **영향:** 화자 정확도 저하 가능. 수집 전체 실패로 이어지진 않음.
* **근거:** CodeGraph blast; `subtitle-rows.test.ts` / fixtures는 존재하나 multi-color 분기 커버 여부는 추가 확인 권장.
* **권장 수정 방향:** 서로 다른 color의 child span fixture로 row 개수·`nodeKey#suffix`·channel 단언.
* **우선순위:** Low

---

## 4. Potential Functional Gaps

확실하지 않은 항목은 **추정**으로 표시한다.

| 항목 | 상태 | 설명 |
|------|------|------|
| 롤오버 중 드롭된 자막 재합성 | 갭 (사실: drop only) | M1. 사용자 복구 UI 없음 |
| storage queue index | 갭 | M2. 전체 get 대신 전용 index 부재 |
| 실중계 자동 e2e | 갭 | M5. 중계 재개 후 권장 |
| WebVTT `<v Speaker>` 표준 화자 | 미구현 | cue 텍스트 접두만 (의도적일 수 있음) |
| 외국어 noise filter 확대 | 문서상 범위 외 | 필터 off 권장 — README/CLAUDE 일치 |
| 사이드 패널 실험 기능 완성도 | **추정** 부분 구현 | 메인 UX는 in-page panel |
| History 검색 전문 색인 | 미구현 | 페이지·필터 기반 — 대형 라이브러리 **추정** 성능 한계 |
| 프리셋에 발언자 옵션 | 없음 | 위원회별 기본값 수요는 **추정** 낮음 |
| 손상 entry 1건 시 세션 전체 import 거부 | 엄격 정책 | 부분 import 허용은 제품 결정 사항 |
| `txtExportSpeakerEnabled` 키 이름 | 레거시 | 의미는 TXT+SRT+VTT+MD+CSV+복사 — rename은 선택 |
| 진단에 롤오버 drop 누적 / unknown 화자 비율 | 부분 | 패널 notice만; options 영속 지표는 약함 **추정** |
| Service worker 수명 중 long export | 완화됨 | offscreen + 한도. 초대형 lineage split UI 의존 |
| 4차 감사 문서 잔존 독자 | 문서 부채 | 본 5차가 대체; POTENTIAL_ISSUES는 PROJECT_AUDIT 참조 중 |

---

## 5. Recommended Fix Plan

### 1단계 — 즉시(작은 비용 · 손실/혼란 방지)

1. **롤오버 드롭 가시성 강화 (M1 단기):** drop 누적을 diagnostics snapshot에 기록, options “수집 진단”에 노출.  
2. **문서 정합 (M4):** README 지원 호스트 주석, 4차 감사 구식 문장 정리(본 문서가 권위).  
3. **`normalizeSessionRecord` id · qualityStats 강화 (L2):** import와 동일 sanitize 재사용.  
4. **prepare 경로 회귀 테스트 (L4):** `pendingPreviews` 가 persist snapshot에 절대 entry화되지 않음 단언 고정.

### 2단계 — 안정성

1. **롤오버 중 이벤트 처리 개선 (M1):** 큐 drop 최소화 설계(상태 직접 반영 또는 상한·백프레셔).  
2. **persist queue storage 읽기 제한 (M2):** index 키 도입.  
3. **SW persist 메시지 스키마 검증 (L1).**  
4. **multi-span · rollover 통합 테스트 (L5, M1).**  
5. **중계 재개 시 실사이트 스모크 체크리스트 실행 (M5).**

### 3단계 — 구조 개선

1. **`runtime-core` 분해 (M3):** capture session service / bridge / rollover 모듈.  
2. **History App 상태 축소:** 이미 섹션 분리됨 — long-task·export 핸들러 추가 추출.  
3. **설정 키 rename 검토** (`exportSpeakerEnabled` alias).  
4. **e2e:** 녹화 기반 fixture + 선택적 Playwright 실사이트 프로브.

---

## 6. Test Recommendations

### 현재 상태 (사실)

- `npm run test`: **66 files, 361 tests, 전부 통과** (2026-08-12).  
- 커버가 두꺼운 영역: session-store, pipeline extract/commit, persist-recovery, frame nonce, export formats, settings sanitize, autosave helpers, page-exit, ownership soft claim 등.

### 추가·보강 권장

| 테스트 | 목적 | 관련 |
|--------|------|------|
| Rollover + 100 events while `persist` hangs | drop 수·notice·남은 큐 의미론 | M1 |
| `listQueuedExitPersistRecords` with N unrelated storage keys | 전체 get 없이/또는 성능 회귀 상한 | M2 |
| start → structured commit → rollover → stop (fake clock + mock store) | runtime 오케스트레이션 | M3 |
| multi-span different colors → 2 rows, `#suffix` keys | 화자 분할 | L5 |
| `buildPreparedSessionRecord` with non-empty `pendingPreviews` | entry 증가 없음 | L4 |
| `normalizeSessionRecord` invalid qualityStats / non-string id | 저장 정규화 방어 | L2 |
| SW `PERSIST_SESSION_RECORD` malformed record | reject or sanitize | L1 |
| format × `txtExportSpeakerEnabled` matrix (export-payload) | 1.0.13 회귀 고정 | 유지·확장 |
| `estimateSessionExportBytes(..., speaker=true)` | speaker 옵션 반영 유지 | 유지 |
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

## 7. Appendix: 4차 감사 항목 상태 (1.0.13 코드 대조)

| 4차 ID | 요약 | 5차 상태 |
|--------|------|----------|
| M1 | 옵션 vs MD/CSV/JSON 동작 | **해소** — `export-payload`가 md/csv에 `includeSpeaker` 전달, off 시 열 생략 |
| M2 | TXT plain vs 복사 bracket | **해소** — `exportTxt`가 `formatSpeakerPrefix` 사용 |
| M3 | estimate 바이트 speaker 미반영 | **해소** — `estimateSessionExportBytes(..., txtExportSpeakerEnabled)` |
| L1 | multi-span 미분할 | **해소** — `collectMultiSpeakerSegments` + `#span` nodeKey |
| L2 | `speakerChanged` 미설정 | **해소** — `appendOrMergeEntry`에서 설정 |
| L3 | speakerColor 인라인 비검증 | **해소** — `sanitizeSpeakerColorForCss` |
| L4 | 문서 미반영 | **대부분 해소** (README/CLAUDE Sync Delta 2026-08-10); 보조 호스트는 M4 |
| L5 | export-payload 테스트 | **개선** — `tests/export-payload.test.ts` 존재 |

---

## 8. Appendix: CodeGraph 관찰 요약

| 관찰 | 의미 |
|------|------|
| `saveSession` / write 큐 / preserve metadata | 메타·본문 경쟁 완화됨 |
| `tryIndexedDb` + TTL disable | open 실패 soft recovery |
| `saveFallbackRecord` memory rollback | quota 실패 시 메모리 오염 방지 |
| bridge: origin 고정 + token + nonce | 신뢰 호스트 전제 하에 합리적 |
| `hasPersistableContent` = entries.length > 0 | popup/panel 저장 게이트 일치 |
| start/stop/rollover 직접 테스트 공백 | M3 근거 |
| 테스트 361 통과 | 현재 회귀 기준선 양호 |

---

*본 문서는 기능 구현 감사 결과이며, 코드 변경 없이 작성되었다. 후속 작업 시 이 파일의 §5 Fix Plan을 우선순위로 사용하면 된다.*
