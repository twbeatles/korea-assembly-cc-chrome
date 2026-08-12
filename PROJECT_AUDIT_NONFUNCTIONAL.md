# Project Audit — Non-Functional Scope

**대상:** `korea-assembly-cc-chrome` (국회 AI 자막 추출 Chrome Extension)  
**감사 일자:** 2026-08-12  
**배포 버전 기준:** `1.0.13`  
**방법:** `README.md` · `CLAUDE.md` · 권한/개인정보 문서 정독 → CodeGraph MCP 호출 관계·소스 대조 → 보조적으로 grep·파일 실측  
**관계:** 기능·데이터 의미론 감사는 `PROJECT_AUDIT.md` (5차)를 본다. **본 문서는 그와 겹치지 않는 범위**만 다룬다.

| 본 문서 범위 | 제외 (기능 감사 쪽) |
|--------------|---------------------|
| 보안·권한·위협 모델 | 수집 파이프라인 commit/preview 의미론 |
| 개인정보·스토어 운영 | 세션 CRUD 레이스 디테일 (이미 5차) |
| 성능·메모리·타이머 | export 포맷 정합 (4–5차) |
| 접근성(a11y)·UX 품질 | 롤오버 drop / persist index (구현 반영됨) |
| 아키텍처 유지보수성 | — |
| 툴체인·CI·e2e·의존성 | — |
| 테스트 **전략·성숙도** | 개별 기능 회귀 케이스 목록 전부 |

**주의 (원 감사 시점):** 코드는 수정하지 않았다. High-Risk는 코드·설정 근거가 있는 항목만 싣고, 추정은 §4에 분리한다.

> **구현 반영 (2026-08-12)**  
> §5 Fix Plan 핵심 항목을 코드·문서에 반영. 회귀: unit **375 tests 통과**.  
> - H1: light DOM `data-assembly-*` 미러 + `assembly-subtitle-panel-command` · smoke 스크립트 갱신  
> - M1: `.github/workflows/ci.yml` (`npm run verify`)  
> - M5: `sharp` → devDependencies  
> - M4/M3/L4: `SECURITY.md`, privacy 게시 체크리스트, sidePanel 절  
> - L5: `visibility-polling` + runtime 폴링/observer 간격 연동  
> - M6: History accessible confirm dialog (Vitest 는 window.confirm 유지)  
> - L3: coverage 임계에 pipeline·extension-context 경로 추가  
> 남은 대형 작업: runtime-core/History 전면 분해, 스토어용 개인정보 실정보 기입, npm audit 취약점 정리.

---

## 1. Executive Summary

제품은 **로컬 전용·호스트 제한·MV3** 설계로 보안·프라이버시 기본선이 탄탄하다. `src` 전역에 `innerHTML`/`dangerouslySetInnerHTML` 사용이 없고, 패널은 production에서 **closed Shadow DOM**, UI 텍스트는 `textContent` 중심이다. 권한 문안·개인정보 초안이 저장소에 있다.

**전체 위험도 (비기능 축): Low–Medium**

| 등급 | 개수 | 요약 |
|------|------|------|
| Critical | 0 | 원격 코드 실행·외부 전송·무제한 host 는 확인되지 않음 |
| High | 1 | production closed shadow 와 Playwright 스모크의 `host.shadowRoot` 가 충돌 — **e2e 신뢰도 붕괴 가능** |
| Medium | 6 | CI 부재, 거대 모듈 유지보수, 브리지 token 페이지 노출 전제, 개인정보 초안 placeholder, sharp 의존 위치, a11y 보완 여지 |
| Low | 다수 | dual TypeScript, sidePanel 실험 성숙도, 폴링 부하, 커버리지 게이트 없음 |

**강점 (사실):**

- host_permissions / content_scripts matches 가 두 의사중계 도메인·player 경로로 좁음.  
- `web_accessible_resources` 의 `injected-observer.js` 도 동일 호스트 매치.  
- SW `isMessageFromOwnExtension` · DOWNLOAD 본문 한도 · CSV formula neutralize.  
- 패널/팝업에 `aria-live="polite"`, live list `role="log"`, 주요 컨트롤 `aria-label`.  
- invalidation 시 타이머 일괄 정리 (`shutdownForInvalidatedContext`).  
- entry chunk(250) · live ledger prune(`liveLedgerMaxRows=300`) · backup 25 MiB 한도.

**한 줄 결론:** 보안·프라이버시 골격은 양호하다. **지금 손대면 이득이 큰 쪽은 (1) production 스모크/e2e 가시성 모델, (2) 저장소 CI 게이트, (3) runtime-core/History 유지보수 분해, (4) 스토어용 개인정보 문서 완성**이다.

---

## 2. Project Understanding (비기능 관점)

### 2.1 신뢰 경계

```text
[사용자 브라우저]
  ├─ 확장 isolated world (content script, SW, popup/history/options)
  ├─ page world (injected-observer.js) ← 의사중계 페이지와 동일 origin
  └─ 로컬 저장 (IndexedDB / chrome.storage.local / memory fallback)

외부 네트워크: 제품 로직상 자막·설정 서버 전송 없음 (README·PRIVACY 초안).
```

**신뢰 전제 (문서·코드 일치):** 의사중계 호스트 페이지가 악의적이지 않다. 페이지에 임의 스크립트가 이미 주입된 환경은 지원 범위 밖 (README).

### 2.2 권한 맵 (manifest)

| 권한 | 용도 (코드 근거) | 최소성 |
|------|------------------|--------|
| `storage` | 설정·세션·nonce·진단 | 필수 |
| `downloads` | export | 필수 (사용자 동작) |
| `activeTab` | popup 탭 점검 | 합리적 |
| `scripting` | content script 재주입 | 합리적 (호스트 제한과 결합) |
| `offscreen` | Blob URL export | 합리적 |
| `sidePanel` | 실험 보조 UI | 선택적 제품 기능 |

Host: `assembly.webcast.go.kr/*`, `webcast.assembly.go.kr/*` only.

### 2.3 성능·용량 관련 상수 (CodeGraph)

| 항목 | 값 | 위치 |
|------|-----|------|
| live ledger max rows | 300 | `PIPELINE_DEFAULTS.liveLedgerMaxRows` |
| entry IDB chunk | 250 entries | `SESSION_ENTRY_CHUNK_SIZE` |
| library backup hard limit | 25 MiB | `SESSION_LIBRARY_TRANSFER_LIMIT_BYTES` |
| DOWNLOAD_REQUEST / data URL | 2 MiB | SW constants |
| 롤오버 event queue | 128 | `DEFAULT_SEGMENT_ROLLOVER_EVENT_QUEUE_MAX` |
| default polling fallback | 200 ms | settings default |

### 2.4 모듈 규모 (실측)

| 파일 | 대략 줄 수 | 비고 |
|------|------------|------|
| `runtime-core.ts` | ~2800 | 수집 오케스트레이션 집중 |
| `history/app/App.tsx` | ~1459 | UI 상태·핸들러 집중 |
| unit test files | 70 | 기능 커버 넓음 |

### 2.5 툴체인

- Vite + `@crxjs/vite-plugin`, React 18, Vitest, dual TypeScript 6/7.  
- `npm run verify` 로컬 게이트 존재.  
- **`.github/workflows` 없음** (저장소 루트 기준).  
- e2e: `scripts/extension-smoke.mjs`, `tests/e2e-smoke.mjs`.

---

## 3. High-Risk Issues

### H1. Extension smoke가 closed Shadow DOM 과 호환되지 않음 — **구현 반영 (2026-08-12)**

* **위치:** `inpage-panel` light DOM `data-assembly-*` · `PANEL_HOST_COMMAND_EVENT` · `scripts/extension-smoke.mjs`
* **상태:** production closed shadow 유지. 스모크는 host dataset 미러로 텍스트를 읽고, 버튼은 CustomEvent 로 전달.
* **잔여:** 실중계 DOM 과의 완전 동치는 여전히 fixture 한계 (`LIVE_CAPTURE_SMOKE_CHECKLIST.md`).

---

### M1. 저장소에 자동 CI 파이프라인 부재 — **구현 반영 (2026-08-12)**

* **위치:** `.github/workflows/ci.yml`
* **상태:** `main`/`master` 푸시·PR 에서 `npm ci` + `npm run verify` 실행. 원 감사 시점의 “워크플로 없음” 은 해소.
* **잔여:** extension e2e 를 CI headless 로 넣는 것은 선택 (Playwright Chromium + 시간).

---

### M2. `runtime-core` · History App 거대 모듈 — 유지보수·회귀 비용

* **위치:**  
  - `src/content/app/runtime/orchestrator/runtime-core.ts` (~2800 lines)  
  - `src/history/app/App.tsx` (~1459 lines)
* **문제:** 비기능 관점에서 **변경 반경(blast radius)** 이 커서 리뷰·온보딩·부분 테스트가 어렵다. 기능 감사 M3 와 동일 축이지만, 여기서는 “제품 기능 버그”가 아니라 **엔지니어링 리스크**로 기록한다.
* **영향:** 소규모 UX 수정이 캡처/저장 경로와 결합 실패할 확률 상승. 리뷰 시간·에이전트 컨텍스트 비용 증가.
* **근거:** 라인 수 실측; CodeGraph 상 start/stop/bind 다수 “direct covering tests 약함”.
* **권장 수정 방향:** 이미 facade/helpers 분리 방향 — capture pipeline service, bridge binding, history long-task/export 핸들러 파일 분리. 한 PR 한 경계.
* **우선순위:** Medium

---

### M3. page-world 브리지 token 이 CustomEvent detail 로 페이지에 전달됨

* **위치:** `runtime-core.ts` — `dispatchObserverConfig` → `OBSERVER_CONFIG_EVENT` detail.token  
  수신: `injected-observer` (page world)
* **문제:** token 은 확장 isolated world 과 page world 간 위조 방지를 위해 필요하나, **페이지 스크립트가 동일 origin 에서 이벤트를 가로채면 token 을 알 수 있다.** 제품 threat model 은 “신뢰 호스트”이므로 의도된 트레이드오프다.
* **영향:** 호스트 페이지 XSS 또는 악의적 주입이 있으면 가짜 subtitle 이벤트를 content script 로 넣을 수 있다. 원격 서버 공격은 아님. 수집 무결성 훼손.
* **근거:** CodeGraph `dispatchObserverConfig` detail.token; README 신뢰 전제.
* **권장 수정 방향:** 문서에 threat model 을 더 명시. 장기: shared Worker / chrome.runtime 전용 채널만 사용 (page world 최소화) 은 사이트 제약상 어려울 수 있음. 단기: token 회전 주기·mismatch 로그 강화.
* **우선순위:** Medium (모델 수용 시 Low 로 격하 가능)

---

### M4. 개인정보처리방침 초안이 스토어 게시 미완성

* **위치:** `PRIVACY_POLICY_DRAFT_KO.md`
* **문제:** `[운영자명]`, `[문의 이메일]`, `[시행일]` placeholder 가 남아 있다. 기술 동작 설명은 상세하나 **법적 게시물로는 미완**.
* **영향:** Chrome Web Store 개인정보 정책 URL 제출·심사 지연 또는 반려 리스크. 코드 취약점은 아님.
* **근거:** 파일 상단·§1 운영자 정보 플레이스홀더.
* **권장 수정 방향:** 실제 운영자 정보 기입 후 공개 URL 게시. 발언자 옵션·진단 필드 등 최신 기능을 한 줄 동기화.
* **우선순위:** Medium (출시 운영)

---

### M5. `sharp` 가 production `dependencies` 에 있음

* **위치:** `package.json` dependencies — `sharp`
* **문제:** 아이콘 리사이즈 스크립트용으로 보이며 확장 런타임 번들에는 필요 없을 가능성이 높다. 런타임 의존으로 두면 install 표면·네이티브 바이너리 이슈·감사 범위가 커진다.
* **영향:** `npm install` 실패 환경(일부 CI/OS), 불필요한 공급망 면적. 확장 사용자 런타임 직접 영향은 제한적 (private 패키지).
* **근거:** package.json; `scripts/resize-icons.js` 존재 (관례상 dev 용).
* **권장 수정 방향:** `devDependencies` 로 이동. 런타임 번들에 sharp 가 안 들어가는지 build 산출물 확인.
* **우선순위:** Medium (공급망·DX)

---

### M6. 접근성: 파괴적 확인이 `window.confirm` · 키보드/포커스 트랩 미흡 가능

* **위치:**  
  - `runtime-core.ts` — `confirmSessionClear` 등 `window.confirm`  
  - History helpers — delete confirm 동일 패턴  
  - 패널: 다수 버튼은 있으나 모달 포커스 관리·Esc 일관 패턴 문서화 부족
* **문제:** native confirm 은 스크린 리더 동작이 브라우저 의존적이고, SPA/확장 페이지에서 포커스 복귀가 어색할 수 있다. 패널 closed shadow 는 **페이지 쪽 AT 가 내부를 못 읽는 경우**가 있어 확장 UI 접근 경로는 브라우저/OS 조합에 따라 다르다.
* **영향:** 시각·운동·스크린 리더 사용자 경험 저하. 수집 자체 실패는 아님.
* **근거:** confirm 사용 코드; builders 에 aria-live 는 양호, 커스텀 dialog 없음.
* **권장 수정 방향:** 확장 페이지(History/Options)부터 accessible modal 패턴. 패널은 role/name 점검 + 키보드로 접기/주요 동작 가능 여부 체크리스트.
* **우선순위:** Medium (a11y)

---

### L1. content_scripts `all_frames: true` + WAR 스크립트 주입

* **위치:** `manifest.json` content_scripts; `injectObserverScript`
* **문제:** 모든 동일 호스트 프레임에 content script 가 로드된다. 필요 기능(iframe 자막)이나, 프레임 수가 많으면 메모리·초기화 비용 증가.
* **영향:** 성능 소폭·공격면 소폭 확대 (동일 호스트 한정).
* **권장:** 유지 가능. 프레임 수 진단 지표만 선택 추가.
* **우선순위:** Low

---

### L2. TypeScript dual-track (6 + 7) 운영 복잡도

* **위치:** `package.json`, `TYPESCRIPT_7_MIGRATION_REVIEW.md`, `scripts/run-tsc.mjs`
* **문제:** typecheck 7 / ESLint API 6 분리는 정당하나 기여자 혼란·이중 실패 모드.
* **영향:** DX. 런타임 무관.
* **권장:** README 개발 섹션에 한 표로 고정 (이미 일부 존재). typescript-eslint 가 7 지원 시 단일화 로드맵.
* **우선순위:** Low

---

### L3. 커버리지 게이트·임계값 없음

* **위치:** `npm run test:coverage` 존재, verify 내 fail-under 설정 미확인·CI 미연동
* **문제:** 커버리지 리포트는 가능하나 품질 게이트로 쓰이지 않음.
* **영향:** 테스트 없는 신규 모듈 유입 용이 (부분적으로 이미 unit 풍부).
* **권장:** 핵심 경로(session-store, pipeline, SW commands) 라인 임계만 선택 도입.
* **우선순위:** Low

---

### L4. sidePanel 실험 기능 성숙도

* **위치:** manifest `side_panel`; `src/sidepanel/main.tsx`
* **문제:** 권한·문안은 있으나 메인 UX 는 in-page panel. side panel 이 얇은 래퍼일 경우 스토어 심사에서 “권한 대비 기능” 질문이 나올 수 있다.
* **영향:** 심사 커뮤니케이션. 보안 위험 낮음.
* **권장:** 기능 패리티 명시 또는 실험 플래그/문서화.
* **우선순위:** Low

---

### L5. 폴링 기본 200ms · 다프레임

* **위치:** `pollingFallbackIntervalMs` default 200
* **문제:** observer 실패 시 폴링이 프레임마다 돌 수 있다.
* **영향:** CPU/배터리 (저사양·백그라운드 탭). 수집 품질과는 trade-off.
* **권장:** 백그라운드 탭 visibility 시 폴링 감속 (Page Visibility API) — **추정 이득 큼**.
* **우선순위:** Low–Medium (성능 최적화)

---

## 4. Potential Gaps (비기능 · 추정 분리)

| 항목 | 상태 | 설명 |
|------|------|------|
| 명시적 extension CSP 커스터마이즈 | 기본 MV3 의존 | 추가 완화 가능하나 필수 아님 |
| 의존성 취약점 정기 스캔 | **추정** 수동 | `npm audit` CI 미연동 |
| i18n (chrome.i18n) | 미사용 | UI 한국어 고정 — 제품 결정 |
| 고대비/강제 색 모드 | **추정** 미검증 | CSS 변수 테마 부재 가능 |
| History 가상 스크롤 | 미구현 | 초대형 세션 entry UI 성능 **추정** 한계 |
| Service worker idle kill 중 long export | 완화됨 | offscreen 사용; 잔여 타임아웃 **추정** |
| 암호화 at-rest | 없음 | 브라우저 프로필 보호에 위임 — 로컬 전용 제품으로 타당 |
| 원격 원격 설정/feature flag | 없음 | 공격면 감소에 유리 |
| 스토어 스크린샷·프로모 일관성 | 운영 | 코드 밖 |

---

## 5. Recommended Fix Plan

### 1단계 — 즉시 (신호·운영)

1. **H1:** extension smoke 를 closed shadow 와 맞게 수정하거나 테스트 빌드 플래그 문서화.  
2. **M1:** `verify` 를 돌리는 CI 워크플로 추가.  
3. **M4:** 개인정보 정책 placeholder 채우고 공개 URL 확정.  
4. **M5:** `sharp` → devDependencies 이동 + install/build 확인.

### 2단계 — 안정성·품질

1. **M2:** runtime-core / History 경계를 이슈 단위로 분리 (기능 변경 없이 이동).  
2. **M6:** History 삭제 confirm 을 accessible dialog 로 교체 (패널은 후순위).  
3. **L5:** `document.visibilityState === "hidden"` 일 때 폴링 백오프.  
4. **L3:** 핵심 패키지 coverage 임계 (예: session-store ≥ 기존 수준 유지).

### 3단계 — 구조·제품

1. **M3:** threat model 을 `SECURITY.md` 또는 README 보안 절로 고정.  
2. **L4:** sidePanel 제품 위치 결정 (정식 / 실험 / 제거).  
3. **L2:** TS 단일화 로드맵.  
4. 선택: Playwright extension e2e 를 fixture + CDP 기반으로 재설계.

---

## 6. Test Recommendations (비기능)

| 테스트 | 목적 | 관련 |
|--------|------|------|
| Smoke: closed shadow 에서 패널 존재·상태 텍스트 검증 | H1 수정 검증 | e2e |
| CI job dry-run (`verify`) | M1 | Actions |
| `npm ls sharp` / production bundle 에 sharp 미포함 | M5 | build |
| a11y: History 삭제 버튼 키보드 only + 포커스 복귀 | M6 | RTL + 수동 |
| Performance: 10k entries hydrate 시간 상한 (unit/bench) | 대용량 | session-store |
| Visibility: hidden 탭에서 polling interval 증가 | L5 | content unit |
| Manifest matches snapshot | 권한 회귀 | constants.test 확장 |
| WAR URL 이 assembly 외 origin 에서 로드 불가 | 보안 회귀 | 수동/문서 |

### 기존 강점 유지

- 단위 테스트 70파일대, 기능 경로 넓음.  
- `verify` 로컬 게이트.  
- permission justification · privacy draft 존재.

---

## 7. Cross-Reference

| 문서 | 역할 |
|------|------|
| `PROJECT_AUDIT.md` | 기능·데이터 무결성·race·export |
| **본 문서** | 보안 경계, a11y, 성능, CI, 운영·스토어, 아키텍처 비용 |
| `LIVE_CAPTURE_SMOKE_CHECKLIST.md` | 실중계 수동 품질 |
| `CHROME_WEB_STORE_PERMISSION_JUSTIFICATIONS.md` | 심사 문안 |
| `PRIVACY_POLICY_DRAFT_KO.md` | 개인정보 (미완 필드 주의) |
| `SITE_COMPATIBILITY_REVIEW_2026-08-10.md` | 사이트 DOM 계약 |

---

## 8. Appendix — CodeGraph / 실측 메모

- `src` 내 `innerHTML` / `outerHTML` / `dangerouslySetInnerHTML`: **0건** (grep).  
- 패널 UI: `textContent` + closed shadow (production).  
- `injectConfiguredContentScripts`: manifest 에 선언된 js 파일만 `chrome.scripting.executeScript`.  
- 외부 `fetch` 로 자막 서버에 올리는 경로: 제품 핵심 플로우에서 확인되지 않음 (로컬 저장·다운로드 중심).  
- extension-smoke: page context `shadowRoot` 의존 — H1.  
- CI workflows: **없음**.

---

*본 문서는 비기능 범위 감사 결과이며 코드 변경 없이 작성되었다. 수정 착수 시 §5 1단계를 권장한다.*
