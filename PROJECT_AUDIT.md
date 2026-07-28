# Project Audit

**대상:** `korea-assembly-cc-chrome` (국회 AI 자막 추출 Chrome Extension)  
**감사 일자:** 2026-07-28 (3차 · **최종 · 다른 범위**)  
**감사 범위:** 기능 구현 관점 — **1·2차와 겹치지 않는 축**  
**방법:** `README.md` / `CLAUDE.md` 정독 → CodeGraph MCP 구조·호출 관계 → 필요 시 소스 교차 확인  

> **3차 초점 축**  
> 1. 자막 파이프라인 품질(merge / desync / unconfirmed 판정)  
> 2. page-world observer 브리지·토큰 노출 표면  
> 3. 패널 DOM 안전성 · live row 의미론  
> 4. 대용량 다운로드 Blob 수명 · 스키마 문서 정합  
> 5. 다중 탭·manifest 경계  
>
> **이미 반영·재고발하지 않는 항목 (1·2차):**  
> lifecycle lock · session write 큐 · IDB TTL · CSV BOM · DOWNLOAD_REQUEST 한도 ·  
> messaging permanent vs transient 분리 · 롤오버 큐 64 · timeRange export · fallback memory rollback · 무효화 한국어 안내  
>
> **3차 항목 구현 반영 (2026-07-28 후속):**  
> page-world postMessage origin 고정 · unconfirmed 텍스트 우선 샘플링 · page Blob complete 전 revoke 금지(TTL 10분) · schema version 문서 `"4"` · speaker/fallback merge 경계 · multi-tab soft ownership · panel shadow closed(테스트만 open)
>
> **SOLID 모듈 분할 (v1.0.12):**  
> `orchestrator/` · `subtitle-pipeline/` · `session-store/public-api/` · History `SessionDetailPanel` — 공개 facade 유지, 동작 호환.

**주의:** 본문 High-Risk 서술은 감사 시점 분석 기록이다. 위 구현 반영 블록과 현재 코드를 우선한다. 배포 버전은 `1.0.12`.

---

## 1. Executive Summary

이 제품은 국회 의사중계 AI 자막을 수집·로컬 저장·다형식 내보내기하는 Manifest V3 확장이다. 1·2차 감사에서 지적된 동시성·저장 경로·메시징 분류 등은 코드에 반영된 상태다.

3차는 **수집 품질·브리지 보안 표면·패널/다운로드 수명·문서 스키마 드리프트**를 본다. Critical 전손 경로는 없고, 전체 위험도는 **Low–Medium**이다. 남은 이슈는 “항상 깨짐”보다 **조건 의존 품질 저하·문서 불일치·적대적 페이지 스크립트 모델** 쪽이다.

**전체 위험도: Low–Medium**

| 등급 | 요약 |
|------|------|
| Critical | 없음 |
| High | 없음 (3차 범위에서 확정 High 없음) |
| Medium | page-world `postMessage("*")` + config 이벤트로 브리지 토큰이 페이지에 노출될 수 있음; unconfirmed 판정의 descendant 샘플링 한계; 대형 Blob URL 60초 revoke 레이스; CLAUDE `version="3"` vs 코드 `SESSION_RECORD_VERSION="4"` |
| Low | 다중 탭 동시 수집 제품 모호성; fallback merge 시 화자 경계 약함; 패널 open shadow; chunk digest는 무결성 해시 아님 |

**강점 (사실):**

- 패널/row UI는 `textContent` + Shadow DOM — `innerHTML` 사용 없음 (XSS 삽입 표면 낮음).  
- content script 부트스트랩 멱등 속성, host_permissions 의사중계 도메인 한정.  
- unconfirmed 배경 하이라이트 필터, 6회 streak 후 container fallback, soft resync 임계값이 코드·테스트에 존재.  
- offscreen Blob chunking이 code-point 단위(`for...of`)로 surrogate-safe.  
- entry chunk store(250) + hydrate로 대형 세션 분리 저장.

---

## 2. Project Understanding

### 2.1 목적

| 항목 | 내용 |
|------|------|
| 제품 | 국회 의사중계 AI 자막 실시간 수집 · 저장 · History · export |
| 호스트 | `assembly.webcast.go.kr`, `webcast.assembly.go.kr` |
| 수집 | 플레이어 페이지; 홈은 패널만 |
| 스택 | MV3 · TS · React · Vite · Vitest · IDB |

### 2.2 엔트리포인트 (CodeGraph)

```text
content-script (멱등 bootstrap)
  └─ orchestrator
       ├─ inject page-world injected-observer (token via CustomEvent)
       ├─ bridge message (token 검증) → live-capture + pipeline
       ├─ unconfirmed / fallback commit / segment rollover
       └─ in-page panel (Shadow DOM, textContent)

background SW
  ├─ persist / download / offscreen Blob / nonce / startup
  └─ revoke blob on download complete (same SW generation)

storage
  ├─ entry-chunks hydrate · lineage merge
  └─ export-payload (+ timeRange filter)

history / popup / options / sidepanel(popup surface)
```

### 2.3 수집 파이프라인 의미 (3차 초점)

1. page-world MutationObserver/polling → `postMessage` (+ token)  
2. content: token 일치 시 top 합류 / child는 frame-forward nonce  
3. structured rows → live ledger reconcile → `commitLiveRow`  
4. fallback raw → 안정 관측 후 materialize  
5. unconfirmed 배경 → row 제외; 연속 차단 시 container fallback 일시 허용  
6. desync/ambiguous 카운트 초과 → soft resync  

### 2.4 문서 정합 (3차)

| 항목 | 문서 | 구현 | 판정 |
|------|------|------|------|
| session record version | CLAUDE `version = "3"` | `SESSION_RECORD_VERSION = "4"` | **어긋남** |
| liveLedgerMaxRows=300 | CLAUDE | constants + panel-live-rows | 정합 |
| 확정 자막만 저장 | README/CLAUDE | unconfirmed 필터 + fallback 안정 관측 | 정합(샘플링 한계는 별도) |
| timeRange export | CLAUDE | 2차에서 구현됨 | 정합 |
| 호스트 한정 | README | manifest host_permissions | 정합 |

---

## 3. High-Risk Issues

### H-1. page-world 브리지: `postMessage("*")` + config 이벤트에 token 전달

* **위치:**  
  * `src/content/injected-observer.ts` — `emit()` → `window.postMessage(..., "*")`  
  * `src/content/app/runtime/orchestrator.ts` — `OBSERVER_CONFIG_EVENT` CustomEvent detail에 `token: observerBridgeToken`  
  * 수용측: `bindBridgeMessages` — `data.token !== observerBridgeToken` 이면 drop
* **문제:**  
  1. 페이지 스크립트가 브리지 메시지를 origin 무관하게 관찰 가능(`*`).  
  2. 설정 CustomEvent로 **bridge token이 page world에 전달**되므로, 동일 페이지의 임의 스크립트가 토큰을 가로채 위조 `subtitle:update` 를 보낼 수 있는 모델이 성립한다.  
  content는 token 일치만 검증하고 payload 텍스트를 신뢰한다.
* **영향:**
  * **정상 의사중계 페이지**에서는 현실 위험이 낮음(1st-party 신뢰).  
  * 페이지 스크립트 주입·XSS·확장 충돌 시 **가짜 자막 주입·수집 오염** 가능.  
  * 자막 원문이 같은 페이지의 다른 스크립트에 노출(기밀성).
* **근거:** CodeGraph emit/installBridge/config dispatch; token 검증은 존재하나 token 비밀성이 page 공유.
* **권장 수정 방향:**
  * page→content 채널을 `CustomEvent` + 확장 전용 경로 또는 `chrome.runtime` 이 가능한 구조로 재검토(제약 있음).  
  * 최소: `postMessage` targetOrigin을 `location.origin`으로 고정(관찰은 줄이지 못해도 관례 개선).  
  * token 회전 주기 단축·config 이벤트 가로채기 완화(document 캡처 리스너 경쟁은 완전 방어 어려움 — 문서화).  
  * 적대적 페이지를 위협 모델에 **명시적으로 포함/제외**.
* **우선순위:** Medium (위협 모델 의존; 정부 사이트 1st-party 가정 시 Low–Medium)

### H-2. unconfirmed 판정의 descendant 샘플링(최대 48)으로 오판 가능

* **위치:** `src/content/subtitle-rows.ts` — `CONFIRMATION_DESCENDANT_SAMPLE_LIMIT = 48`, `collectConfirmationCheckTargets`, `isConfirmedSubtitleNode`
* **문제:**  
  노드 하위 요소가 많을 때 일부만 샘플링해 배경 하이라이트(인식 중)를 검사한다. 하이라이트가 샘플 밖 자손에만 있으면 **미확정을 확정으로 오인**하거나, 반대로 구조에 따라 필터가 들쭉날쭉할 수 있다.
* **영향:**
  * 인식 중 자막이 조기 commit → 이후 보정·중복 엔트리 품질 저하  
  * 또는 과도 차단 후 streak fallback 의존
* **근거:** 샘플 한도 상수 + step 샘플링 루프; CLAUDE는 “하늘색 등 불투명 배경 = 미확정 제외”를 요구.
* **권장 수정 방향:**
  * 의미 있는 텍스트를 가진 leaf 우선 전수 검사, 또는 상한을 높이되 비용 측정  
  * 오판 시 diagnostics에 `sampledConfirmation=true` 플래그  
  * fixture HTML로 deep tree 회귀 테스트
* **우선순위:** Medium

### H-3. 대형 page Blob 다운로드: resolve 직후·60초 타임아웃 revoke 레이스

* **위치:** `src/history/page-blob-download.ts` — `DEFAULT_REVOKE_TIMEOUT_MS = 60_000`, `settleResolve` 가 download **시작** 직후 resolve, cleanup은 complete/interrupted 또는 60초
* **문제:**  
  1. `chrome.downloads.download` 콜백에서 즉시 `settleResolve` — 호출자는 완료를 기다리지 않음(설계상 가능).  
  2. 60초 타이머는 complete 리스너와 경합; 느린 디스크·사용자 saveAs 대화상자 지연 시 **다운로드 진행 중 URL revoke** 가능.  
  3. downloads API 없는 환경의 anchor fallback도 resolve 후 60초 revoke.
* **영향:** 전체 JSON 백업 등 대형 파일에서 간헐적 다운로드 실패 (**추정 빈도 낮음, 영향 큼**)
* **근거:** page-blob-download 소스; 테스트는 단위 수준.
* **권장 수정 방향:**
  * complete 전에는 revoke 금지; 타임아웃을 수 분으로 연장 또는 download state 폴링  
  * saveAs 대화상자 시간을 고려한 최소 TTL  
* **우선순위:** Medium

### H-4. CLAUDE session record version 문서 드리프트 (`"3"` vs `"4"`)

* **위치:**  
  * `CLAUDE.md` §7.2 — `version = "3"`  
  * `src/shared/constants.ts` — `SESSION_RECORD_VERSION = "4"`  
  * 다수 테스트 fixture는 여전히 `"3"` (import 시 normalize로 덮일 수 있음)
* **문제:** 에이전트/기여자가 스키마 기대를 잘못 잡음. 런타임은 normalize 시 현재 버전으로 맞출 가능성이 높으나 문서가 구식.
* **영향:** 잘못된 마이그레이션 가정, 리뷰 혼선 (직접 데이터 손실은 낮음)
* **근거:** 상수 vs CLAUDE 문구 불일치
* **권장 수정 방향:** CLAUDE를 `"4"` 및 변경 필드로 갱신; 테스트 fixture 점진 정렬
* **우선순위:** Medium (문서) / Low (런타임)

### H-5. fallback 경로에서 화자/구조 경계 없는 merge로 문장 합침 가능

* **위치:** `src/core/subtitle-pipeline.ts` — `appendOrMergeEntry`  
  structured boundary는 `sourceNodeKey` 가 양쪽 있을 때만 동작. merge gap 5초·max chars 조건.
* **문제:** container fallback 엔트리는 `sourceNodeKey` 가 비는 경우가 많아, 짧은 간격의 서로 다른 발화가 **한 entry로 병합**될 수 있다.
* **영향:** 회의록 가독성·SRT 큐 타이밍 왜곡 (데이터 “유실”보다는 품질)
* **근거:** canMerge 조건에 speakerChannel 비교 없음; fallback commit 경로 존재
* **권장 수정 방향:** speakerChannel/color 변경 시 forceNewEntry; fallback 전용 더 짧은 merge gap
* **우선순위:** Low–Medium

### H-6. 다중 탭 동시 수집 시 세션 충돌은 “제품 미정의”

* **위치:** content runtime은 탭 단위 모듈 상태; storage는 session id 단위 큐만 존재
* **문제:** 같은 회의를 두 탭에서 동시에 수집하면 서로 다른 session/lineage가 생기고, 저장소만 공유된다. 충돌 방지·탭 단일화 UX 없음.
* **영향:** 사용자 혼란·중복 기록 (**추정** 사용 패턴)
* **근거:** 탭 간 캡처 락 심볼 없음; 설계상 탭 로컬 상태
* **권장 수정 방향:** 동시 running 세션 diagnostics 경고 또는 “이미 다른 탭에서 수집 중” 알림 (**추정 구현 비용 Medium**)
* **우선순위:** Low

### H-7. (참고) 패널 open Shadow DOM · 페이지 간섭

* **위치:** `inpage-panel/dom/builders.ts` — `attachShadow({ mode: "open" })`, `textContent` 만 사용
* **문제:** open 모드라 페이지가 `shadowRoot`에 접근 가능. 텍스트 삽입은 textContent라 XSS 위험은 낮으나 UI 변조는 가능.
* **영향:** 낮은 보안/UX; closed mode 전환 검토 가치
* **우선순위:** Low

### H-8. 1·2차 해결 항목 (재발 방지)

| 영역 | 상태 |
|------|------|
| lifecycle / write 큐 / IDB TTL / CSV BOM | 해결 |
| messaging permanent vs transient | 해결 |
| 롤오버 큐·timeRange·fallback rollback | 해결 |

---

## 4. Potential Functional Gaps

1. **적대적 페이지 위협 모델 문서화 부재** — H-1. **추정: 제품은 1st-party 신뢰**  
2. **deep unconfirmed tree fixture 부족** — H-2 회귀 방지. **사실(테스트 공백 추정 포함)**  
3. **resolvePanelLiveRows가 structuredRows를 무시** — 항상 committed entry 윈도우. CLAUDE “live ledger 누적”과 표현이 다를 수 있으나 committed 기준이면 의도적일 수 있음. **추정: 의도적 단순화**  
4. **chunk digest 32-bit FNV류** — 충돌 시 불필요 rewrite 또는 스킵 오류 가능. **Low 추정**  
5. **soft resync** 시 과거 문장 재추출 품질 — 임계 기반 설계. **품질 이슈, 버그 단정 아님**  
6. **side panel = popup surface** — 패리티 양호, 독립 UX 미흡 **추정**  
7. **E2E가 smoke 수준** — pipeline 품질·브리지 위조는 자동 검증 약함  

---

## 5. Recommended Fix Plan

### 1단계 — 즉시 (품질·문서·다운로드 안정)

1. **H-4** CLAUDE `SESSION_RECORD_VERSION` / 스키마 설명 `"4"`로 정합  
2. **H-3** page Blob revoke 정책: complete 전 유지 · TTL 연장  
3. **H-2** unconfirmed 검사 샘플 전략 개선 + deep fixture 테스트  

### 2단계 — 안정성·위협 모델

4. **H-1** postMessage origin 고정 · 위협 모델 README/PRIVACY에 명시 · token 노출 완화 방안 검토  
5. **H-5** fallback merge에 speaker 경계  
6. 브리지 위조·deep tree 단위/통합 테스트  

### 3단계 — 구조·제품

7. 다중 탭 running 감지 알림 (H-6)  
8. 패널 shadow `closed` 검토 (H-7)  
9. orchestrator에서 bridge/pipeline seam 추가 추출로 품질 테스트 용이화  

---

## 6. Test Recommendations

### 6.1 최우선

| 영역 | 시나리오 | 기대 |
|------|----------|------|
| subtitle-rows | 자손 100+ + 샘플 밖 highlight | 미확정으로 차단 (H-2 수정 후) |
| page-blob-download | download complete 전 61초 경과 시뮬 | URL 유지 또는 안전하게 재생성 |
| injected-observer / bridge | 잘못된 token 메시지 | drop; 올바른 token만 수용 |
| pipeline | fallback 연속 두 문장 다른 speakerColor 5초 이내 | 분리 entry (H-5 수정 후) |
| docs/check | SESSION_RECORD_VERSION 상수와 CLAUDE 문구 | 일치 검사 스크립트 가능 |

### 6.2 유지 회귀

* unconfirmed 6회 fallback 허용  
* soft resync 임계  
* export timeRange · CSV BOM · write queue  
* transient messaging 비-permanent  
* offscreen chunk surrogate-safe  

### 6.3 수동 / E2E

1. 인식 중(하이라이트) 구간 긴 회의 — 조기 commit 여부  
2. 전체 JSON 백업 saveAs 1분 이상 대기 — 다운로드 성공 여부  
3. 개발자 도구에서 위조 postMessage — token 없으면 무시  
4. 같은 회의 탭 2개 동시 수집 — 기록 중복 양상 확인  

---

## Appendix A. 3차 체크리스트

| 항목 | 요약 |
|------|------|
| 기능 잠재 문제 | unconfirmed 샘플링, fallback merge, Blob revoke |
| 예외 처리 | 대체로 양호; revoke 타이밍 개선 여지 |
| 입력 검증 | import/settings 양호; 브리지는 token만 |
| 상태 흐름 | pipeline 의미론 풍부; soft resync 존재 |
| 비동기 | Blob/download 수명, 다중 탭 미정의 |
| 인코딩/OS | 1·2차 정합 |
| DB | chunk hydrate 양호; 문서 version 드리프트 |
| 보안 | 패널 XSS 낮음; page-world token 표면 Medium |
| 테스트 | 품질/위협 시나리오 보강 여지 |
| 문서 | version 3 vs 4 |

## Appendix B. 1·2·3차 범위 분리

| 회차 | 초점 |
|------|------|
| 1차 | lifecycle, write 큐, IDB, CSV, DOWNLOAD_REQUEST |
| 2차 | messaging 분류, 롤오버 overflow, timeRange, fallback rollback |
| **3차 (본 문서)** | **pipeline 품질, page-world 브리지, Blob 수명, 스키마 문서, 다중 탭** |

## Appendix C. 주요 파일 (3차)

| 경로 | 역할 |
|------|------|
| `src/content/injected-observer.ts` | page-world observer · postMessage |
| `src/content/subtitle-rows.ts` | unconfirmed · row key |
| `src/core/subtitle-pipeline.ts` | preview/row commit · merge · resync |
| `src/content/inpage-panel/dom/builders.ts` | Shadow panel · textContent |
| `src/history/page-blob-download.ts` | 대형 백업 Blob 수명 |
| `src/shared/constants.ts` | SESSION_RECORD_VERSION · PIPELINE_DEFAULTS |
| `manifest.json` | 권한 · matches · WAR |

---

*정적 분석·CodeGraph 기반. 실 Chrome 장시간 회의·적대적 페이지 스크립트 재현은 포함하지 않았다. 코드 변경 없이 리포트만 작성했다.*
