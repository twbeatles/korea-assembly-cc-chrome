# Project Audit

**대상:** `korea-assembly-cc-chrome` (국회 AI 자막 추출 Chrome Extension)  
**감사 일자:** 2026-07-14  
**감사 범위:** 기능 구현 관점 (잠재 결함, 예외/검증, 상태·비동기, 저장소, 보안, 테스트, 문서 정합)  
**방법:** `README.md` / `CLAUDE.md` 정독 → CodeGraph MCP 구조·호출 관계 분석 → 필요 시 소스 교차 확인  

> **구현 반영 (2026-07-14)**  
> 아래 High/Medium 권고 중 핵심 항목을 코드에 반영했습니다.  
> - H-1 저장/export 정규화 분리 · H-2 lifecycle lock · H-3 URL reconcile single-flight  
> - H-4 session write queue · startup debounce · postMessage origin · entry 상한 · 용량 경고 · 문서 동기화  
> 상세 구현 위치는 `src/core/output-normalizer.ts`, `src/content/runtime/capture-lifecycle-lock.ts`, `src/content/runtime/url-reconcile.ts`, `src/storage/session-write-queue.ts` 등을 참고하세요.  
>  
> **구조 리팩터링 (동일 일자 후속)**  
> - `session-store`: `idb/` · `fallback/` · `normalize` · `public-api` 분리  
> - `history`: `HistoryHero` · `SessionListPanel` · `useHistoryLongTask`  
> - `content/runtime`: `orchestrator` · `constants` · `types` facade  
> 본문 §3 High 항목의 “미해결” 서술은 감사 시점 기록이며, 위 반영 이후 코드가 우선입니다.

**주의:** 본 문서 본문은 감사 시점의 분석 기록입니다. 구현 후 상태는 위 구현 반영 블록과 테스트를 우선합니다.

---

## 1. Executive Summary

이 프로젝트는 **Manifest V3 Chrome Extension**으로, 국회 의사중계 플레이어의 AI 자막을 DOM/observer/polling으로 수집하고 IndexedDB(+fallback)에 저장·내보내기하는 제품입니다. 아키텍처는 content runtime → subtitle pipeline → session store → background export/download 로 명확히 분리되어 있고, 단위 테스트 커버리지와 fallback 경로가 비교적 성숙합니다.

**전체 위험도: Medium (중간)**

| 등급 | 요약 |
|------|------|
| Critical | 현재 코드 근거로 확정한 Critical 항목은 없음 |
| High | 저장 경로에서 export용 carry-over 정규화가 재사용되어 확정 자막이 조용히 줄어들 수 있음; 캡처 시작/URL 전환 동시성 가드 부재 |
| Medium | session write load-modify-write 경쟁, 런타임 통합 테스트 공백, SPA 전환 시 상태 꼬임 여지 |
| Low | postMessage `*`, 문서 드리프트, UX 보강 후보 |

강점:
- 자막 commit/preview 분리, unconfirmed 필터, page-exit replay queue, lineage 분할, import allow-list sanitize 등 핵심 의미론이 코드에 실재함.
- 과거 문서화 이슈 중 `recentDuplicateMinLength` 반영, base64 chunking + 2 MiB data URL cap, `display:block` 강제 제거, note 4KB 캡, visibility autosave gating, pageshow/visible resync 는 **현재 구현에서 해결됨**.

남은 핵심 위험은 “DOM 수집 자체”보다 **동시성 제어**, **저장 정규화 범위**, **런타임 통합 테스트 공백** 쪽에 집중됩니다.

---

## 2. Project Understanding

### 2.1 목적

- 지원 사이트: `assembly.webcast.go.kr`, `webcast.assembly.go.kr`
- 홈(`/main`, `/main/`)에서는 패널/진단 UI, 실제 수집은 `main/player*` (및 pressplayer) 에서 수행
- 확정 자막만 저장·export (preview-only / 인식 중 / 로딩 placeholder 제외)
- 형식: TXT / SRT / VTT / JSON / MD / CSV
- History: 검색, 즐겨찾기, 메모, entry 편집·병합·분할, lineage 단위 관리, JSON 백업/복원(25 MiB)

### 2.2 기술 스택

- Vite + `@crxjs/vite-plugin`, React, Vitest
- TypeScript dual-track (typecheck TS7 / ESLint TS6)
- 저장: IndexedDB 우선 → `chrome.storage.local` per-session fallback → 메모리 fallback
- 다운로드: offscreen Blob URL 우선, bounded data URL fallback

### 2.3 주요 엔트리포인트 (CodeGraph 기준)

```text
content-script.ts
  └─ createContentRuntime() → app/runtime/implementation.ts
       ├─ bootstrap / bind* (port, settings, navigation, url, bridge)
       ├─ startCapture / stopCapture / handleCommand
       ├─ handleTopFrameEvent → live-capture + subtitle-pipeline
       ├─ autosave / page-exit-persist
       └─ inpage-panel UI

background/service-worker.ts
  ├─ DOWNLOAD_SESSION_EXPORT / offscreen Blob
  ├─ frame-forward nonce lifecycle
  └─ startup-persistence (replay → cleanup)

storage/session-store/implementation.ts
  ├─ saveSession / updateRunningSession / upsertSessionRecord
  ├─ updateSessionMetadata / updateSessionContent
  ├─ importSessionRecords / backup export
  └─ closeRunningSessionsOnStartup / replay queue

history / popup / options / sidepanel
  └─ React UI → session-store / chrome messaging
```

### 2.4 핵심 실행 흐름

1. **Bootstrap:** content script idempotent attribute → settings 로드 → frame-forward nonce → observer inject + polling/top fallback
2. **Auto-start:** player 페이지 + `autoStartEnabled` + cooldown 없음 + status ≠ running 이면 `startCapture()`
3. **수집:** injected observer / local polling / top-frame fallback → `NormalizedCaptureEvent` 합류 → live ledger reconcile → pipeline (`applyPreview` / row commit) → noise/unconfirmed 필터 → entries commit
4. **저장:** running autosave debounce, stop 시 최종 저장, pagehide 시 stopped queue + background persist, startup replay 후 running cleanup
5. **Export:** session store payload 조립 → background download → offscreen Blob (실패 시 2 MiB 이하 data URL)

### 2.5 문서 대비 구현 정합 (요약)

| 항목 | 문서 | 현재 구현 | 판정 |
|------|------|-----------|------|
| `recentDuplicateMinLength` 설정 반영 | CLAUDE noise 규칙 | `resolveRecentDuplicateMinLength(settings)` 사용 | 정합 |
| 자막 레이어 `display:block` 강제 | 과거 이슈 | 의도적으로 제거, 수동 클릭 notice | 정합 |
| visibility autosave gating | 과거 이슈 | `respectAutoSaveSetting` + pagehide 예외 | 정합 |
| pageshow / visible resync | 과거 이슈 | `resyncOnReturnToForeground` | 정합 |
| note 길이 캡 | 과거 이슈 | `SESSION_NOTE_MAX_LENGTH = 4096` | 정합 |
| import allow-list + invalid timestamp reject | CLAUDE | `session-backup.ts` sanitize | 정합 |
| export 직전 carry-over 정리 | CLAUDE export 규칙 | **export뿐 아니라 저장 정규화에도 적용** | **어긋남 가능** |
| `POTENTIAL_ISSUES.md` P0 미해결 표기 | 해당 문서 | 현재 코드상 다수 해결 | 문서 스테일 |

---

## 3. High-Risk Issues

### H-1. 저장/업데이트 경로가 export용 carry-over 정규화를 재사용해 확정 entry를 조용히 삭제·수정할 수 있음

* **위치:** `src/storage/session-store/implementation.ts` — `normalizeEntries()` → `normalizeEntriesForOutput()`; 호출: `normalizeSessionRecord()`, `applySessionContentPatch()`, `stopRunningRecord()`
* **문제:** `normalizeEntriesForOutput()`는 export/copy 직전의 carry-over exact duplicate 제거·접두 트림용 로직입니다. 이를 `saveSession` / `updateRunningSession` / `updateSessionContent` / startup `stopRunningRecord` 등 **영속화 경로**에 그대로 연결하면, 메모리上的 확정 자막과 디스크에 남는 자막 집합이 달라질 수 있습니다.
* **영향:**
  * 짧은 간격·동일 문장·동일 `sourceNodeKey` 재등장 시 저장 시점에 entry 감소
  * History entry 편집/병합 후 저장 시 의도치 않은 트림·삭제
  * 패널에 보이던 건수와 저장 후 `subtitleCount` 불일치 → 사용자 신뢰 저하
* **근거:**
  * `normalizeEntries`가 곧 `normalizeEntriesForOutput` 호출
  * CLAUDE.md는 “**export 직전** carry-over exact duplicate 정리”로 범위 한정
  * 동일 함수가 copy-utils / exporters에서도 사용되어 역할이 혼재
* **권장 수정 방향:**
  * 저장 경로는 structural sanitize(타입·필수 필드·길이)만 수행
  * carry-over dedupe는 `exportSessionData` / copy / lineage export 직전으로 한정
  * 회귀 테스트: “동일 텍스트 2 entry를 12초 내 저장해도 2건 유지” 등
* **우선순위:** High

### H-2. `startCapture()` 비동기 구간 동안 중복 실행 가드가 없음

* **위치:** `src/content/app/runtime/implementation.ts` — `startCapture()`; 가드 헬퍼 `src/content/runtime/capture-start.ts` — `shouldIgnoreStartCapture()`
* **문제:** 중복 시작 판정이 `state.status === "running"` 뿐이며, 그 이전의 `await ensureFailedStoppedSessionResolved` / `await ensureCurrentRunningSessionPreservedBeforeReset` 동안 status는 여전히 running이 아닙니다. 패널 더블클릭·popup 동시 명령·auto-start와 수동 시작 경쟁 시 두 흐름이 인터리브될 수 있습니다.
* **영향:**
  * 이전 세션 저장/삭제와 새 세션 reset이 교차
  * 세션 id/entries 손실 또는 잘못된 저장 스냅샷
  * failed-stopped guard 상태 꼬임
* **근거:**
  * `shouldIgnoreStartCapture`는 status 단일 조건
  * 코드베이스에 `startCaptureInFlight` / command mutex 류 심볼 없음 (검색 결과 0)
  * CodeGraph: `startCapture` / `stopCapture` 직접 커버 테스트 없음
* **권장 수정 방향:**
  * `captureLifecycleInFlight` 플래그 또는 직렬 큐로 start/stop/clear/save 직렬화
  * 진입 즉시 “starting” 가드 또는 promise 재사용
  * 동시 클릭 통합 테스트 추가
* **우선순위:** High

### H-3. URL 전환 reconcile의 `lastKnownUrl` 선반영 + 동시 스케줄로 캡처 파이프라인이 고착될 수 있음

* **위치:** `src/content/app/runtime/implementation.ts` — `reconcileCapturePipelineForCurrentUrl()`, `bindUrlChangeDetection()`
* **문제:**
  1. `lastKnownUrl = currentUrl`을 stop/reset **성공 전**에 갱신한 뒤, `stopCapture()` 실패 시 early return → 이후 동일 URL에서는 `urlChanged === false`라 재시도하지 않음
  2. `pushState` / `replaceState` / `popstate` / 500ms poll이 각각 `setTimeout(0)`으로 reconcile을 스케줄하며 **in-flight 직렬화 없음** → 병렬 stop/start 가능
* **영향:**
  * SPA 회의 전환 후 수집이 재개되지 않는 고착 상태
  * 전환 중 세션 이중 종료/이중 저장
  * auto-start가 기대대로 다시 돌지 않음
* **근거:**
  * 1995–2032행 근처: lastKnownUrl 선반영 + catch return
  * 2712–2753행: 다중 이벤트 → `scheduleReconcile` 병렬 가능
  * `reconcileInFlight` 부재
* **권장 수정 방향:**
  * reconcile single-flight 큐 (latest-wins)
  * `lastKnownUrl`은 stop/reset 성공 후에만 커밋; 실패 시 이전 URL 유지 또는 “dirty reconcile” 플래그
  * URL 전환 실패 notice를 사용자에게 노출
* **우선순위:** High

### H-4. session metadata/content 업데이트의 load-modify-write 경쟁

* **위치:** `src/storage/session-store/implementation.ts` — `updateSessionMetadata()`, `updateSessionContent()`, `updateSessionLineageMetadata()`
* **문제:** `loadSession` → patch 적용 → `writeSessionRecord` 사이에 버전/락이 없습니다. History에서 즐겨찾기 토글과 메모 저장, 또는 lineage 메타 업데이트와 entry 편집이 겹치면 나중에 끝나는 write가 이전 필드를 덮어쓸 수 있습니다.
* **영향:**
  * 즐겨찾기/메모/entry 편집 중 일부 변경 유실
  * 다중 탭 History 동시 편집 시 데이터 손실
* **근거:**
  * 각 함수가 독립 load 후 전체 record put
  * `preserveStoredSessionMetadata`는 save/updateRunning 경로의 starred/note 보호용이며 concurrent content patch 보호는 아님
* **권장 수정 방향:**
  * `updatedAt`/revision 비교 후 stale write reject
  * 또는 필드 단위 트랜잭션(메타만 / entries만) 강화
  * 동시 업데이트 통합 테스트
* **우선순위:** Medium

### H-5. `startCapture` / `stopCapture` / `handleCommand` / navigation guard 통합 테스트 공백

* **위치:** `src/content/app/runtime/implementation.ts` (CodeGraph blast radius: ⚠️ no covering tests found)
* **문제:** 단위 모듈 테스트(pipeline, autosave helper, page-exit-persist, frame-coordinator 등)는 풍부하나, 실제 상태 머신을 소유하는 runtime implementation의 핵심 액션에 대한 직접 테스트가 부족합니다.
* **영향:**
  * H-2, H-3 같은 동시성/전환 회귀가 CI에서 잡히지 않음
  * 리팩터링 시 facade/implementation 분리 경계에서 의미론 깨짐 위험
* **근거:** CodeGraph blast radius 경고 + `tests/content-runtime.test.ts`는 helper 수준 위주
* **권장 수정 방향:**
  * runtime을 테스트 가능한 서비스 경계로 더 추출하거나, implementation 공개 훅에 대한 시나리오 테스트 추가
  * “start 중 재진입”, “URL 변경 중 stop 실패”, “pagehide 후 pageshow resync” 시나리오
* **우선순위:** Medium

### H-6. frame-forward `postMessage(..., "*")` 와 메시지 표면

* **위치:** `src/content/frame-coordinator.ts` — `forwardFrameEvent()`
* **문제:** child → top 전달 시 targetOrigin이 `"*"`입니다. top 수용은 storage-backed nonce로 제한되지만, 동일 페이지의 다른 스크립트가 메시지를 관찰하거나(기밀성은 낮음) 잘못된 origin 관례를 남깁니다.
* **영향:** 보안 민감도는 낮~중간(자막 텍스트 로컬 유출 가능성, nonce 추측 어려움). 호스트 페이지 협력 공격 모델에서는 이론상 이벤트 위조 시도 가능하나 nonce 없이는 드롭됩니다.
* **근거:** `window.top?.postMessage(payload, "*")` + top의 nonce mismatch → resync/drop
* **권장 수정 방향:**
  * 가능하면 `window.location.origin`으로 targetOrigin 고정
  * sender origin 검증 강화(이미 event.source 검사 일부 존재)
* **우선순위:** Low ~ Medium

### H-7. (해결됨) 과거 P0 항목 — 재발 방지 목적 기록

아래는 `POTENTIAL_ISSUES.md`에 남아 있을 수 있으나 **현재 코드에서는 해결된 상태**입니다. 회귀 테스트 유지가 중요합니다.

| 과거 이슈 | 현재 근거 |
|-----------|-----------|
| `recentDuplicateMinLength` 미반영 | `resolveRecentDuplicateMinLength` + `applyPreview` 전달 |
| `bytesToBase64` 1바이트 누적 | chunk size `0x8000` + join |
| data URL 대용량 | `DATA_URL_FALLBACK_MAX_BYTES = 2 MiB` |
| `display:block` 강제 | subtitle-layer / injected-observer 모두 명시적 회피 |
| note 무제한 | `SESSION_NOTE_MAX_LENGTH = 4096` |
| visibility autosave 무시 | `respectAutoSaveSetting` |
| pageshow 미처리 | `pageshow` + `visibilitychange` visible 분기 |

* **우선순위:** (회귀 관점) Medium — 문서/테스트 동기화

---

## 4. Potential Functional Gaps

확실하지 않은 항목은 **추정**으로 표기합니다.

### 4.1 기능 보완 후보

1. **entryNote / 단일 entry text 길이 캡**  
   세션 note는 4KB 캡이 있으나 entryNote·text 자체 상한은 import sanitize 외 약한 편입니다. 장문 붙여넣기 시 storage 팽창 가능. (**부분 사실 + 추정 영향**)

2. **History dirty note `beforeunload` 미보호**  
   새로고침/필터 전환 시 discard 확인은 있으나, 탭 닫기에는 가드가 없습니다. (`POTENTIAL_ISSUES` 4-4와 동일, **현재도 추정 유지**)

3. **`subtitle:health`만 오는 구간의 title/sourceUrl 갱신**  
   SPA 중 health 이벤트만 오면 메타가 stale일 수 있음. (**추정**, 과거 노트 5-3)

4. **autoStart 기본 ON + 자막 레이어 자동 클릭의 사용자 기대 불일치**  
   구현은 의도적이나 README “알려진 한계”에 부수 효과 설명이 부족할 수 있음. (**UX 갭**)

5. **startup maintenance 중복 실행**  
   `onStartup` + `onInstalled` 동시 트리거 시 replay/cleanup 이중 실행 가능. 치명적이진 않으나 History revision refetch 흔들림. (**추정 Medium/Low**)

6. **외국어 자막**  
   noise filter 한글/영문 중심은 README/CLAUDE와 일치. 추가 언어 지원은 제품 확장 과제.

7. **실험형 side panel**  
   존재하나 주 UX는 in-page panel. 기능 패리티/완성도 차이는 **추정**.

8. **대형 세션(24h) 운영 UX**  
   lineage 분할은 있으나 수집 중 “곧 분할됩니다” 선제 안내·용량 경고 UI는 약할 수 있음. (**추정**)

### 4.2 문서 드리프트

* `POTENTIAL_ISSUES.md`의 P0 “미해결” 서술과 현재 코드 불일치 → 신규 기여자/에이전트가 잘못된 우선순위를 잡을 위험
* `CLAUDE.md` 검증 명령 목록과 `package.json`의 `verify` / `verify:e2e` / `test:e2e:extension` 매핑이 문서마다 표현이 다름 (기능 버그는 아니나 운영 혼선)

### 4.3 보안 표면 (기능 인접)

* injected page-world에서 `window.smi_*` 호출: 가시성 재검사로 완화됨. 페이지 함수 위조 시 부작용 가능하나 성공 판정은 레이어 visible 기준
* background openHistory/options 메시지는 extension 내부 메시지; 추가 sender.id 검사는 방어 심화 수준

---

## 5. Recommended Fix Plan

### 1단계 — 즉시 수정 (데이터 정확성 / 동시성)

1. **저장 경로에서 `normalizeEntriesForOutput` 분리 (H-1)**  
   - structural sanitize 전용 함수 도입  
   - export/copy에만 carry-over 정리 유지  
   - 저장 전후 entry 수 불변 회귀 테스트

2. **캡처 라이프사이클 직렬화 (H-2)**  
   - start/stop/clear/save 공통 mutex  
   - 중복 start는 기존 in-flight promise 반환 또는 명시적 ignore

3. **URL reconcile single-flight + lastKnownUrl 커밋 시점 수정 (H-3)**  
   - 실패 시 재시도 가능 상태 유지  
   - 사용자 notice: “페이지 전환 후 수집 재개 실패”

### 2단계 — 안정성 개선

4. session update optimistic concurrency (H-4)  
5. runtime implementation 시나리오 테스트 보강 (H-5)  
6. startup maintenance debounce/in-flight guard  
7. entryNote 길이 상한 + History dirty beforeunload  
8. frame postMessage origin 고정 (H-6)

### 3단계 — 구조·문서·UX

9. `POTENTIAL_ISSUES.md`를 현재 코드 기준으로 재작성하거나 “Resolved” 섹션 분리  
10. CLAUDE/README 검증 명령·export 정규화 범위 문구 동기화  
11. autoStart/자막 자동 활성화 부수 효과를 옵션 설명·알려진 한계에 명시  
12. 장시간 세션 용량 경고·분할 예고 UI  
13. (선택) runtime implementation 모듈을 더 작은 테스트 가능 서비스로 분할

---

## 6. Test Recommendations

### 6.1 최우선 추가 테스트

| 영역 | 시나리오 | 기대 |
|------|----------|------|
| session-store | 동일 텍스트·동일 sourceNodeKey·12초 이내 2 entry를 `saveSession` | **2건 모두 유지** (export 시에만 1건으로 줄어들 수 있음) |
| session-store | `updateSessionContent`로 사용자가 의도적으로 비슷한 문장 2줄 저장 | 둘 다 유지 |
| content-runtime | `startCapture` 중 재호출 | 두 번째 호출 no-op 또는 동일 promise, 세션 1개 |
| content-runtime | running 중 URL 변경 + stop 실패 모킹 | lastKnownUrl/재시도, 파이프라인 고착 없음 |
| content-runtime | pushState 연속 2회 빠른 호출 | reconcile 1회 직렬, 이중 stop 없음 |
| session-store | 병렬 `updateSessionMetadata(starred)` + `updateSessionMetadata(note)` | 최종 레코드에 두 필드 모두 반영 또는 명시적 conflict error |
| page-exit | autosave OFF + visibility hidden | running snapshot **미기록**; pagehide stopped는 기록 |
| export | 2 MiB 초과 content의 data URL fallback | 명시적 거부/안내, SW OOM 없음 |

### 6.2 회귀 유지 (이미 있거나 강화 권장)

* `recentDuplicateMinLength` 설정 16 vs 8 (`subtitle-pipeline.test.ts` 존재 — 유지)
* note 4KB clamp (`session-store.test.ts` 존재 — 유지)
* unconfirmed fallback 6회 허용
* import invalid timestamp / unsupported wrapper version reject
* lineage merge/export split
* frame-forward nonce mismatch → resync

### 6.3 E2E / 스모크

* 기존 `npm run verify` + `npm run verify:e2e` / `test:e2e:extension` 유지
* **추가 권장 수동/반자동 시나리오:**
  1. player A 수집 중 → SPA로 player B 전환 → 저장·재시작 확인  
  2. 수집 중 탭 백그라운드/포그라운드 왕복 후 nonce·자막 연속성  
  3. 저장 실패 유도 후 재시작 시 discard 확인 플로우  
  4. History에서 lineage 즐겨찾기 + 메모 동시 편집

### 6.4 테스트 인프라 메모

* CodeGraph가 표시하는 “no covering tests”는 심볼 직접 참조 기준이라, helper 단위 테스트만 있는 모듈은 과소평가될 수 있습니다. 그래도 **runtime implementation 본체**는 실질적 공백으로 보는 것이 타당합니다.
* `fake-indexeddb` 기반 store 테스트는 강점. content script DOM + chrome API mock 통합 레이어를 한 단계 올리는 편이 ROI가 큽니다.

---

## Appendix A. 감사 범위 체크리스트

| 감사 항목 | 결과 요약 |
|-----------|-----------|
| 기능 구현 잠재 문제 | H-1 저장 정규화 범위, H-2/H-3 동시성 |
| 누락된 예외 처리 | stopCapture는 대체로 swallow; reconcile 실패 재시도 부족 |
| 사용자 입력 검증 | import sanitize 양호; entryNote/text 상한·session id 직접 경로 약함 |
| 상태/데이터 흐름 | preview vs commit 분리는 양호; 저장 시 재정규화가 흐름 왜곡 가능 |
| 비동기/race | startCapture·reconcile·session update |
| 경로/인코딩/OS | Chrome 전용, UTF-8 TextEncoder 사용 — 큰 이슈 없음 |
| DB/캐시/설정 | IndexedDB+fallback 설계 성숙; concurrent write·fallback 용량 한계 |
| 보안 | 호스트 제한·nonce·token 양호; postMessage `*` 개선 여지 |
| 테스트 | 단위 풍부 / runtime 통합 약함 |
| 문서 정합 | 핵심 스펙 대체로 일치; POTENTIAL_ISSUES 스테일, export 정규화 문구 주의 |
| 추가 기능 후보 | beforeunload note, 용량 경고, autoStart 설명 |

## Appendix B. 참고 문서·심볼

* 문서: `README.md`, `CLAUDE.md`, `POTENTIAL_ISSUES.md`, `CAPTURE_RETENTION_AND_STABILITY.md`
* CodeGraph 초점 심볼: `startCapture`, `stopCapture`, `reconcileCapturePipelineForCurrentUrl`, `applyPreview`, `normalizeSessionRecord`, `importSessionRecords`, `downloadExportWithFallback`, `persistQueuedPageExitRecord`, `runStartupPersistenceMaintenance`
* 검증 권장 명령:

```bash
npm run check:version
npm run check:injected
npm run lint
npm run typecheck
npm run test
npm run build
# 또는
npm run verify
```

---

*본 감사는 정적 코드/문서/그래프 분석 기반이며, 실기기 국회 사이트 라이브 DOM 변경에 대한 런타임 관측은 포함하지 않습니다. 사이트 DOM 변경에 따른 selector 깨짐은 제품 본질적 외부 리스크로 README “알려진 한계”와 동일합니다.*
