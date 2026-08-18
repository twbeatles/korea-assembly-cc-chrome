# Project Audit — Non-Functional Scope

**대상:** `korea-assembly-cc-chrome` (국회 AI 자막 추출 Chrome Extension)  
**감사 일자:** 2026-08-18 (비기능 2차 · 전 범위 재감사)

> **구현 반영 (2026-08-18)**  
> §5 1–2단계 핵심을 코드·CI·문서에 반영했다.  
> - M1: light DOM 미러 e2e 마커 게이트 + 스모크 attach 직후 마커  
> - M2/L2: PRIVACY 권한 표(`unlimitedStorage`·`sidePanel`), SECURITY §5 게이트 문구  
> - M4: `src/shared/accessible-confirm.ts` — 패널·History 공유 alertdialog  
> - M5: CI coverage + TS6 typecheck + prod audit  
> - L1: `sender.id === chrome.runtime.id` 필수  
> - L7: `runInvalidationTimerCleanup` + 단위 테스트  
> - M3: confirm / 미러 / shutdown 을 공유·헬퍼로 추출 (runtime-core 전면 분해는 후속)  
> - A11Y 수동 체크리스트: `A11Y_CHECKLIST.md`  
> 운영자 placeholder 는 실제 스토어 게시 정보가 없어 비워 두었다.  
**배포 버전 기준:** `package.json` / README `1.0.13`  
**Git:** `origin/main` pull 완료 (`Already up to date.`)  
**방법:** `README.md` · `CLAUDE.md` · `SECURITY.md` · 권한/개인정보 문서 정독 → CodeGraph MCP로 보안·메시징·타이머·권한 경로 분석 → 고위험 경로만 보조 대조  
**관계:** 기능·데이터 의미론은 `PROJECT_AUDIT.md` (6차 + 2026-08-18 구현 반영)를 본다. **본 문서는 그와 겹치지 않는 범위**만 다룬다.

| 본 문서 범위 | 제외 (기능 감사 쪽) |
|--------------|---------------------|
| 보안 경계·권한·위협 모델 | 수집 commit/preview, persist race, export 포맷 |
| 개인정보·스토어 운영 | 세션 CRUD 의미론 |
| 성능·메모리·타이머 | 롤오버 drop / persist index (기능 6차에서 다룸) |
| 접근성(a11y)·UX 품질 | — |
| 아키텍처 유지보수성 | — |
| 툴체인·CI·e2e·의존성 | — |
| 테스트 **전략·성숙도** | 개별 기능 회귀 케이스 목록 |

**주의:** 코드는 수정하지 않았다. High-Risk는 코드·설정 근거가 있는 항목만 싣고, 추정은 §4에 분리한다.

> **이전 비기능 감사(2026-08-12)에서 이미 해소된 것**  
> H1 closed-shadow 스모크, M1 CI, M5 `sharp`→devDependencies, M6 History accessible dialog, L3 coverage 경로 임계, L5 hidden 탭 폴링 ×4, `SECURITY.md` 신설.  
> **2026-08-18 기능 후속과 겹치는 보안 보강:** persist 8 MiB·id 128자, host command `data-assembly-e2e="1"` 게이트, `unlimitedStorage`.

---

## 1. Executive Summary

제품은 **로컬 전용·호스트 제한·MV3** 설계로 보안·프라이버시 기본선이 탄탄하다. `src` 전역에 `innerHTML` / `dangerouslySetInnerHTML` 이 없고, 패널 production은 **closed Shadow DOM**, UI는 `textContent` 중심이다. CI가 `verify`와 같은 게이트를 돌리고, 프로덕션 의존성(`react` / `react-dom`) `npm audit --omit=dev` 는 **0 vulnerabilities** 였다.

**전체 위험도 (비기능 축): Low–Medium**

| 등급 | 개수 | 요약 |
|------|------|------|
| Critical | 0 | 원격 RCE·외부 전송·무제한 host 는 확인되지 않음 |
| High | 0 | 확정 High 없음 (구 H1 스모크 충돌은 해소) |
| Medium | 5 | 운영 중 light DOM 자막 미러, 개인정보 placeholder, 거대 모듈, 패널 confirm, 문서·CI 공백 |
| Low | 다수 | sender.id 없는 메시지 허용, closed shadow AT, TS dual-track, sidePanel 얇음, CI에 coverage/e2e 없음 |

**강점 (사실):**

- host_permissions / content_scripts 가 두 의사중계 도메인·`/main`·player 경로로 좁음.  
- `web_accessible_resources` 의 `injected-observer.js` 도 동일 호스트. `externally_connectable` 없음.  
- SW `isMessageFromOwnExtension` · DOWNLOAD 2 MiB · persist 8 MiB · CSV formula neutralize · speaker 색 화이트리스트.  
- page-world `postMessage` 는 `location.origin` 고정 (fallback `*` 는 origin 부재 시에만).  
- 패널 `aria-live` · live list `role="log"` · History accessible `alertdialog`.  
- invalidation 시 타이머 일괄 정리 (`shutdownForInvalidatedContext`).  
- hidden 탭 폴링 ×4. entry chunk 250 · live ledger 300 · backup 25 MiB.  
- host command 는 e2e 마커가 있을 때만 동작.

**한 줄 결론:** 비기능 골격은 양호하고 2026-08-12 권고의 대부분은 닫혀 있다. 지금 손대면 이득이 큰 쪽은 **(1) production light DOM 자막 미러를 e2e 전용으로 좁히기, (2) 개인정보·권한 문서와 `unlimitedStorage` 정합, (3) 패널 파괴 확인 a11y, (4) runtime-core / History 유지보수 분해** 이다.

---

## 2. Project Understanding (비기능 관점)

### 2.1 신뢰 경계 (CodeGraph + SECURITY.md)

```text
[사용자 브라우저]
  ├─ 확장 isolated world (content script, SW, popup/history/options)
  ├─ page world (injected-observer.js) ← 의사중계 페이지와 동일 origin
  └─ 로컬 저장 (IndexedDB / chrome.storage.local / memory fallback)

외부 네트워크: 제품 로직상 자막·설정 서버 전송 없음 (README·PRIVACY 초안).
```

**신뢰 전제:** 의사중계 호스트가 악의적이지 않다. 페이지에 임의 스크립트가 이미 있으면 token·DOM 자막·light DOM 미러를 읽을 수 있다 (README·SECURITY §1).

CodeGraph 호출 관계:

```text
content / popup
  └─ sendRuntimeMessage (2회 재시도, permanent invalidation만 전역 승격)
       └─ SW handleBackgroundCommand
            ├─ isMessageFromOwnExtension
            ├─ persist / queue / download / open pages
            └─ frame-forward nonce get/rotate/clear (tab loading / remove)
```

### 2.2 권한 맵 (manifest 현재)

| 권한 | 용도 | 최소성 |
|------|------|--------|
| `storage` | 설정·세션·nonce·진단 | 필수 |
| `unlimitedStorage` | page-exit 큐·대형 fallback (2026-08-18 추가) | 정당화됨. 스토어 심사에서 설명 필요 |
| `downloads` | 사용자 export | 필수 |
| `activeTab` | popup 탭 점검 | 합리적 |
| `scripting` | content 재주입 | 합리적 (호스트 제한과 결합) |
| `offscreen` | Blob export | 합리적 |
| `sidePanel` | 실험 보조 UI (`sidepanel/main.tsx` = popup 재사용) | 선택 |

Host: `assembly.webcast.go.kr/*`, `webcast.assembly.go.kr/*` only.

### 2.3 성능·용량 상수

| 항목 | 값 | 위치 |
|------|-----|------|
| live ledger max rows | 300 | `PIPELINE_DEFAULTS.liveLedgerMaxRows` |
| entry IDB chunk | 250 | `SESSION_ENTRY_CHUNK_SIZE` |
| library backup | 25 MiB | `SESSION_LIBRARY_TRANSFER_LIMIT_BYTES` |
| DOWNLOAD_REQUEST / data URL | 2 MiB | SW |
| persist 메시지 | 8 MiB · entry 5만 · id 128자 | SW (2026-08-18) |
| 롤오버 안전 상한 | 2048 (진단 기준 128) | `segment-event-queue.ts` |
| hidden 탭 폴링 | base × 4 | `visibility-polling.ts` |
| default polling | 200 ms | settings |

### 2.4 모듈 규모 (2026-08-18 실측)

| 파일 | 줄 수 | 비고 |
|------|-------|------|
| `runtime-core.ts` | 3113 | 수집 오케스트레이션 집중 |
| `history/app/App.tsx` | 1601 | UI 상태·핸들러 집중 |
| unit tests | 70 files / 385 tests | 기능 커버 넓음 |

### 2.5 툴체인·CI

- Vite + `@crxjs/vite-plugin`, React 18, Vitest, dual TypeScript 6/7.  
- `.github/workflows/ci.yml`: `main`/`master` 푸시·PR, Node 20, `TZ=UTC`, inject → version → lint → typecheck → test → build.  
- CI에 **coverage job / extension e2e / `npm audit` 없음**. 로컬 `vitest` 경로별 임계는 있음.  
- `sharp` 는 **devDependencies**. 프로덕션 의존성은 React만. `npm audit --omit=dev` → 0.

---

## 3. High-Risk Issues

Critical / High 는 없다. 아래는 근거 있는 Medium·Low.

---

### M1. production light DOM 이 자막 미리보기를 항상 미러함

* **위치:** `src/content/inpage-panel/controller/render.ts` — `host.dataset.assemblyPreview` / `assemblyLiveText` / `assemblyNotice` (각 400자)  
  명령 게이트: `panel-host-command.ts` — `data-assembly-e2e === "1"` 일 때만 start/stop/save
* **문제:** 2026-08-18에 **쓰기 명령**은 e2e 마커로 막혔다. 그러나 **읽기 미러는 매 렌더마다 무조건** light DOM에 기록된다. closed shadow를 우회해 페이지 스크립트가 실시간 자막·공지를 읽을 수 있다.
* **영향:** 신뢰 호스트 전제에서는 허용된 트레이드오프. 호스트 XSS가 있으면 자막 본문이 페이지 월드로 새는 표면이 커진다. 외부 서버 유출은 아님.
* **근거:** `update()` 가 마커 검사 없이 `dataset.assemblyPreview` 등을 설정. 스모크는 이 미러를 읽는다 (`scripts/extension-smoke.mjs`).
* **권장 수정 방향:** 미러 기록도 `data-assembly-e2e="1"` (또는 빌드 플래그) 일 때만 수행. 스모크는 지금처럼 마커를 먼저 켠다. SECURITY §5에 “읽기 미러도 동일 게이트”를 명시.
* **우선순위:** Medium

---

### M2. 개인정보 초안 placeholder · 권한 목록 정합

* **위치:** `PRIVACY_POLICY_DRAFT_KO.md` — `[운영자명]`, `[문의 이메일]`, `[시행일]`  
  §7 권한 목록에 `unlimitedStorage` · `sidePanel` 없음
* **문제:** 기술 설명은 상세하나 스토어 게시물로는 미완. 2026-08-18에 추가된 `unlimitedStorage` 가 방침·권한 표에 빠져 있다.
* **영향:** Chrome Web Store 개인정보 URL·권한 심사 지연 또는 반려 가능. 코드 취약점은 아님.
* **근거:** 파일 상단 체크리스트 “미기입”. §7 목록 vs `manifest.json` permissions.
* **권장 수정 방향:** 운영자 정보 기입 후 공개 URL. `unlimitedStorage`(로컬 복구 큐 한도), `sidePanel`(실험 보조 UI) 한 줄 추가. `SECURITY.md` 보고 절의 문의 이메일도 같은 값.
* **우선순위:** Medium (출시 운영)

---

### M3. `runtime-core` · History App 거대 모듈 (엔지니어링 리스크)

* **위치:**  
  - `src/content/app/runtime/orchestrator/runtime-core.ts` (**3113줄**)  
  - `src/history/app/App.tsx` (**1601줄**)
* **문제:** 변경 반경이 커서 리뷰·온보딩·부분 테스트가 어렵다. 기능 감사 M3와 같은 축이나, 여기서는 **제품 버그가 아니라 유지보수 비용**으로 기록한다. 2026-08-18에 lock+deferred start 테스트는 추가됐으나 모듈 자체는 더 커졌다.
* **영향:** 작은 UX 수정이 캡처/저장과 결합 실패할 확률·리뷰 시간 증가.
* **근거:** 라인 수 실측. CodeGraph: `shutdownForInvalidatedContext` “⚠️ no covering tests found”.
* **권장 수정 방향:** 기능 변경 없이 capture pipeline / bridge / persist / History long-task·export 를 파일로 이동. 한 PR 한 경계.
* **우선순위:** Medium

---

### M4. in-page 파괴 확인이 여전히 `window.confirm`

* **위치:** `runtime-core.ts` — `confirmSessionClear`, `confirmFailedStoppedSessionDiscard`  
  대비: History는 `confirm-dialog.ts` 의 `role="alertdialog"` (Vitest만 `window.confirm`)
* **문제:** 패널·페이지 위 파괴 동작은 native confirm. 스크린 리더·포커스 복귀가 브라우저 의존적이다. closed shadow 안 AT 경로는 OS/브라우저 조합에 따라 다르다.
* **영향:** 접근성 저하. 수집 실패는 아님.
* **근거:** runtime-core L291–305. History `confirmDestructiveAction` 은 이미 교체됨.
* **권장 수정 방향:** 패널에도 동일한 accessible dialog (shadow 내부). Esc·포커스 트랩·복귀를 History와 맞추기.
* **우선순위:** Medium (a11y)

---

### M5. CI가 로컬 `verify`보다 얇고, coverage/e2e/audit 이 없음

* **위치:** `.github/workflows/ci.yml`  
  로컬: `npm run verify` = version + inject + lint + typecheck + test + **build** (동일에 가깝음)  
  없음: `npm run test:coverage` 임계 강제, `test:e2e:extension`, `npm audit`
* **문제:** 단위 테스트와 빌드는 PR에서 돈다. 커버리지 임계는 `vitest.config.ts`에만 있어 CI가 깨지 않는다. Playwright 확장 스모크·의존성 감사도 CI 밖이다.
* **영향:** 커버리지 후퇴·확장 로드 회귀·dev 의존성 취약을 PR에서 놓칠 수 있음. 프로덕션 의존성 감사는 현재 0건.
* **근거:** workflow 스텝 목록. vitest thresholds 주석 “경로별 임계”. CI에 coverage/e2e/audit 문자열 없음.
* **권장 수정 방향:**  
  1) CI에서 `npm run test:coverage` (또는 verify에 포함)  
  2) 선택 job으로 `EXTENSION_E2E_HEADLESS=1 npm run test:e2e:extension`  
  3) `npm audit --omit=dev --audit-level=high`
* **우선순위:** Medium (품질 게이트)

---

### L1. `isMessageFromOwnExtension` 이 `sender.id` 부재를 허용

* **위치:** `service-worker-commands.ts` L181–190
* **문제:** `!chrome.runtime.id` 이면 true, `!sender.id` 이면 true. 외부 페이지는 `externally_connectable` 이 없어 이 리스너에 못 들어오는 것이 정상이라 **실공격면은 작다**. 방어 심화로는 sender.id 필수화가 더 엄격하다.
* **영향:** 확장 내부 발신만 가정. 잘못된 테스트 더블·미래 메시지 경로에서 검증이 느슨해질 수 있음.
* **근거:** `return !sender.id || sender.id === chrome.runtime.id`.
* **권장 수정 방향:** 운영 빌드에서 `sender.id === chrome.runtime.id` 만 허용. 테스트는 runtime.id 를 심는다.
* **우선순위:** Low

---

### L2. SECURITY.md §5 와 현재 host-command 게이트가 어긋남

* **위치:** `SECURITY.md` §5 “이 명령 채널은 지원 호스트 페이지에서 호출 가능하다”  
  코드: `isPanelHostCommandEnabled` — `data-assembly-e2e="1"` 필수
* **문제:** 명령은 막혔는데 문서가 예전 표면을 설명한다. 읽기 미러(M1)는 문서에도 코드에도 “항상 켜짐”으로 남아 있다.
* **영향:** 후속 기여자가 게이트를 되돌리거나, 심사 질문에 오래된 답을 할 수 있다.
* **권장:** §5를 “명령은 e2e 마커, 미러는 (권고) 동일 마커”로 고친다.
* **우선순위:** Low (문서)

---

### L3. closed shadow 와 스크린 리더

* **위치:** production `attachShadow({ mode: "closed" })`  
  light DOM 미러는 상태 일부만 (M1)
* **문제:** 페이지 AT가 shadow 내부를 못 읽는 조합이 있다. 확장 자체 UI(팝업·History)는 일반 DOM이라 영향이 적다.
* **영향:** 의사중계 페이지 위 패널을 AT로 쓸 때 공백. **추정:** Chrome 확장 패널은 브라우저가 shadow를 읽는 경우가 많음.
* **권장:** 수동 AT 체크리스트. 미러를 e2e 전용으로 좁히면 AT용 읽기 경로는 별도 `aria` 를 host에 최소로 둘지 결정.
* **우선순위:** Low

---

### L4. TypeScript dual-track (6 + 7)

* **위치:** `package.json`, `scripts/run-tsc.mjs`, CI는 typecheck 7만
* **문제:** ESLint는 TS 6 API. 기여자 혼란·이중 실패 모드. CI는 7만 돌려 TS 6 회귀를 놓칠 수 있다.
* **영향:** DX. 런타임 무관.
* **권장:** typescript-eslint가 7을 지원하면 단일화. 그 전엔 `typecheck:ts6` 를 주기적으로 또는 CI weekly.
* **우선순위:** Low

---

### L5. sidePanel 실험 성숙도

* **위치:** manifest `side_panel`; `src/sidepanel/main.tsx` 가 popup을 그대로 렌더
* **문제:** 권한 대비 기능이 얇다. 스토어에서 “왜 sidePanel이 필요한가” 질문이 나올 수 있다. 문안은 justification에 있음.
* **영향:** 심사 커뮤니케이션. 보안 위험 낮음.
* **권장:** 실험임을 README/스토어 설명에 유지하거나, 패리티를 올리거나, 제거.
* **우선순위:** Low

---

### L6. content_scripts `all_frames: true`

* **위치:** `manifest.json`
* **문제:** 동일 호스트의 모든 프레임에 content script가 붙는다. iframe 자막에는 필요.
* **영향:** 프레임이 많으면 메모리·초기화 비용. 공격면은 동일 호스트 한정.
* **권장:** 유지. 선택적으로 프레임 수 진단.
* **우선순위:** Low

---

### L7. `shutdownForInvalidatedContext` 직접 테스트 공백

* **위치:** `runtime-core.ts:387` (CodeGraph: no covering tests)
* **문제:** 타이머·ownership 해제는 중요 비기능 경로인데 오케스트레이션 테스트가 없다. 헬퍼 `extension-context.test.ts` 는 있다.
* **영향:** invalidation 회귀 시 폴링이 남을 **가능**.
* **권장:** 타이머 clear를 순수 목록으로 추출해 단위 테스트.
* **우선순위:** Low

---

### 2026-08-12 항목 상태 (이번 재감사)

| 구 ID | 요약 | 2026-08-18 상태 |
|-------|------|-----------------|
| H1 | smoke vs closed shadow | **해소** — light DOM 미러 + CustomEvent. 잔여 읽기 미러는 본 문서 M1 |
| M1 | CI 없음 | **해소** — `.github/workflows/ci.yml` |
| M2 | 거대 모듈 | **유지** — 줄 수 3113 / 1601 (본 문서 M3) |
| M3 | page-world token | **수용** — SECURITY.md에 명시. 신뢰 호스트 전제 |
| M4 | 개인정보 placeholder | **유지** (본 문서 M2) + unlimitedStorage 누락 |
| M5 | sharp in dependencies | **해소** — devDependencies |
| M6 | History window.confirm | **History 해소** / 패널은 잔존 (본 문서 M4) |
| L3 | coverage 임계 없음 | **로컬 해소** / CI 미연동 (본 문서 M5) |
| L5 | hidden 폴링 | **해소** — `resolvePollingIntervalMs` ×4 |

---

## 4. Potential Gaps (비기능 · 추정 분리)

| 항목 | 상태 | 설명 |
|------|------|------|
| 명시적 extension CSP | MV3 기본 | 커스터마이즈 없음. 필수 아님 |
| 의존성 취약점 정기 스캔 | 수동 | 프로덕션 audit 0. CI 미연동 |
| i18n (`chrome.i18n`) | 미사용 | UI 한국어 고정 — 제품 결정 |
| 고대비/강제 색 | **추정** 미검증 | CSS 변수 테마 부재 가능 |
| History 가상 스크롤 | 미구현 | 초대형 entry UI 성능 **추정** 한계 |
| SW idle 중 long export | 완화 | offscreen. 잔여 타임아웃 **추정** |
| 암호화 at-rest | 없음 | 브라우저 프로필 위임 — 로컬 전용으로 타당 |
| 원격 설정/feature flag | 없음 | 공격면 감소에 유리 |
| `data-assembly-*` 에 자막 본문 | 사실 (M1) | e2e 편의 vs 최소 노출 |
| 스토어 스크린샷·프로모 | 운영 | 코드 밖 |
| CI `format` / `typecheck:ts6` | 없음 | prettier는 로컬 스크립트만 |

---

## 5. Recommended Fix Plan

### 1단계 — 즉시 (노출·문서·심사)

1. **M1:** light DOM 자막/공지 미러를 e2e 마커가 있을 때만 기록. 스모크는 마커를 먼저 설정 (이미 명령용으로 함).  
2. **M2 / L2:** 개인정보·SECURITY에 `unlimitedStorage` / host-command 게이트를 맞추고, 운영자 placeholder는 게시 전에 채운다.  
3. **M5 단기:** CI에 `npm audit --omit=dev --audit-level=high` 한 스텝.

### 2단계 — 품질·접근성

1. **M4:** 패널 파괴 확인을 History와 같은 alertdialog로.  
2. **M5:** CI coverage 임계 (`npm run test:coverage`). 선택 e2e job.  
3. **L1 / L7:** sender.id 필수화, invalidation shutdown 단위 테스트.  
4. **M3:** runtime-core / History 를 기능 변경 없이 파일 분리.

### 3단계 — 구조·제품

1. sidePanel 정식/실험/제거 결정 (L5).  
2. TS 6/7 단일화 로드맵 (L4).  
3. 수동 AT + 고대비 체크리스트 (L3, §4).  
4. 실중계 스모크는 `LIVE_CAPTURE_SMOKE_CHECKLIST.md` (기능 감사 M5와 공유).

---

## 6. Test Recommendations (비기능)

| 테스트 | 목적 | 관련 |
|--------|------|------|
| e2e 마커 없을 때 `dataset.assemblyPreview` 가 비어 있음 | 미러 게이트 | M1 |
| e2e 마커 있을 때 스모크가 상태를 읽음 | 회귀 방지 | M1 |
| `isMessageFromOwnExtension` — sender.id 없음 거부 | 경계 | L1 |
| 패널 confirm: Tab/Esc/포커스 복귀 | a11y | M4 |
| hidden 탭에서 polling interval ×4 (유지) | 성능 | 기존 `visibility-polling.test.ts` |
| CI에서 coverage thresholds | 게이트 | M5 |
| `npm audit --omit=dev` 를 CI에 | 공급망 | M5 |
| Manifest permissions 스냅샷에 unlimitedStorage | 권한 회귀 | constants/manifest 테스트 |
| invalidation 시 interval/timeout 0개 | shutdown | L7 |

### 기존 강점 유지

- 단위 테스트 70 files / 385.  
- CI verify 상당 부분.  
- permission justification · SECURITY.md · privacy draft 존재.

---

## 7. Cross-Reference

| 문서 | 역할 |
|------|------|
| `PROJECT_AUDIT.md` | 기능·데이터 무결성·race·export (6차 + 구현 반영) |
| **본 문서** | 보안 경계, a11y, 성능, CI, 운영·스토어, 아키텍처 비용 |
| `SECURITY.md` | 위협 모델 (일부 구절은 L2로 갱신 필요) |
| `LIVE_CAPTURE_SMOKE_CHECKLIST.md` | 실중계 수동 품질 |
| `CHROME_WEB_STORE_PERMISSION_JUSTIFICATIONS.md` | 심사 문안 (`unlimitedStorage` 절 있음) |
| `PRIVACY_POLICY_DRAFT_KO.md` | 개인정보 (placeholder · 권한 표 갱신 필요) |
| `SITE_COMPATIBILITY_REVIEW_2026-08-10.md` | 사이트 DOM 계약 |

---

## 8. Appendix — CodeGraph / 실측 메모

- `src` 내 제품 `innerHTML` / `dangerouslySetInnerHTML`: **0건**. `innerHTML` 은 테스트 fixture만.  
- 패널 UI: `textContent` + production closed shadow.  
- `sendRuntimeMessage`: 일시 오류 2회 재시도, `Extension context invalidated` 만 영구.  
- frame-forward nonce: tab `loading` 시 회전, remove 시 삭제. 테스트 있음.  
- `sanitizeSpeakerColorForCss`: hex/rgb/rgba 화이트리스트.  
- 외부 `fetch` 로 자막을 올리는 제품 경로: 확인되지 않음.  
- `npm audit --omit=dev`: **0 vulnerabilities** (2026-08-18).  
- CI workflows: **있음** (2026-08-12 문서의 “없음” 은 구식).

---

*본 문서는 비기능 범위 감사 결과이며 코드 변경 없이 작성되었다. 수정 착수 시 §5 1단계를 권장한다.*
