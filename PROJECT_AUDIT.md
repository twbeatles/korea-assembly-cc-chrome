# Project Audit

감사일: **2026-09-09 (KST)** · 대상: **국회 AI 자막 추출기 1.0.13** · 기준 커밋: **`4cf5ea4`** (`main`)

이번 문서는 기존 감사를 현재 코드와 실행 결과로 갱신한 보고서다. 제품 코드·설정·의존성은 수정하지 않았다. 기존 사용자 프로필, IndexedDB, 확장 저장소에는 접근하거나 쓰지 않았다. 재현은 임시 Node 프로세스의 fake-indexeddb와 메모리 Chrome API 대역으로 수행했다.

## 1. Executive Summary

수집·검색·편집·다형식 내보내기의 기능 골격과 오류 처리 기반은 갖춰져 있다. **기존 테스트 69개 파일, 375개 테스트가 통과**했고 lint 및 임시 디렉터리 대상 Vite production build도 성공했다. 실제 국회 법사위 중계에서 자막 DOM 갱신을 관측했으며, 핵심 선택자와 확정/미확정 스타일은 구현과 일치했다.

그러나 **전체 위험도는 High**로 평가한다. 저장 완료로 표시된 사용자 수정이 다음 자동 저장에 사라지는 문제와, 별도 실행 환경 간 쓰기 및 종료 복구 인덱스 경쟁을 격리 재현했다. 단위 테스트 통과만으로 데이터 보존을 보장할 수 없는 상태다.

| 이슈 | 우선순위 | 신뢰도 | 상태 | 핵심 영향 |
|---|---|---|---|---|
| ISSUE-001 | High | Confirmed | **Resolved** | 수집 중 History의 자막 수정·중요 표시·행 메모가 자동 저장에 덮어써짐 (수정/보존 반영) |
| ISSUE-002 | High | Confirmed | **Resolved** | History/백그라운드 등 별도 실행 환경 사이에서 메타데이터 변경 유실 (Web Locks + 원자적 IDB RMW) |
| ISSUE-003 | High | Confirmed | **Resolved** | 종료 복구 큐의 인덱스 경쟁으로 durable record가 재시작 후 조회되지 않음 (전체 스캔 복구) |
| ISSUE-004 | Medium | Likely | **Resolved** | 자동 분할 저장 중 멈추기를 누르면 대기 중 자막 이벤트가 사라짐 (stop 시 rollover 큐 drain) |
| ISSUE-005 | Medium | Confirmed | **Resolved** | 삭제한 기록이 남은 종료 복구 큐에서 재생되어 되살아남 (삭제 tombstone + 큐 정리) |

**데이터 유실 가능성: 있음.** ISSUE-001/002는 논리적 덮어쓰기, ISSUE-003은 복구 대상 누락이다. DB 파일 자체의 물리적 손상이나 전체 라이브러리 파괴, 외부로 자막을 유출하는 Critical 경로는 확인하지 못했다. ISSUE-003은 원본 키가 저장소에 남아 있어 복구 여지가 있으며, 모든 동시 종료가 영구 유실로 이어진다는 뜻은 아니다.

가장 먼저 **캡처 원문과 사용자 편집의 저장 정책**, **실행 환경을 가로지르는 쓰기 직렬화**, **종료 복구 큐의 원자성·발견 가능성**을 수정해야 한다.

## 2. Project Understanding

### 목적·개발 규칙

- 국회 의사중계 페이지의 AI 자막을 실시간 수집하고 브라우저 내부에 저장하는 Chrome Manifest V3 확장이다. TXT/SRT/VTT/JSON/MD/CSV 내보내기, History 검색·메모·편집·백업을 제공한다.
- `README.md`, `CLAUDE.md`, `manifest.json`, `package.json`, `vite.config.ts`, `vitest.config.ts`, `tsconfig.json`, CI workflow, `SECURITY.md`, 실중계 체크리스트 및 기존 감사의 요약을 확인했다.
- **루트 `AGENTS.md` 파일은 존재하지 않았다.** 사용자 메시지에 제공된 CodeGraph 우선 사용 및 main 작업 규칙을 적용했다. 별도 브랜치나 worktree는 만들지 않았다.
- 활성 제품은 TypeScript/React 확장이다. 과거 Python/PyQt/Selenium 앱은 이번 production 감사 대상에서 제외했다. 신규 기능 구현이나 Spec Kit 산출물 작성은 수행하지 않았다.

### 진입점·핵심 모듈

| 영역 | 진입점 / 모듈 | 역할 |
|---|---|---|
| Content | `src/content/content-script.ts` → `app/runtime/orchestrator/runtime-core.ts` | bootstrap, 상태, 패널, observer/polling, 저장, 분할, 종료 |
| Page world | `src/content/injected-observer.ts` → 생성된 `public/injected-observer.js` | MutationObserver와 DOM 재읽기, token 기반 브리지 |
| DOM | `subtitle-rows.ts`, `dom-probe.ts`, `frame-probe.ts` | 행 키·발언자·미확정 필터, 접근 가능한 프레임 탐색 |
| 자막 처리 | `src/core/live-capture.ts`, `subtitle-pipeline/commit.ts` 및 관련 모듈 | 행 reconcile, 보정, 중복/노이즈 필터, commit |
| Background | `src/background/service-worker.ts`, `service-worker-commands.ts` | 저장 명령, 다운로드, nonce, startup 복구 |
| 저장 | `src/storage/session-store.ts` 및 하위 public-api/idb/fallback | 메타데이터·본문·청크 CRUD, 검색, lineage, import/export |
| 복구 | `src/storage/persist-recovery.ts`, `src/background/startup-persistence.ts` | 종료 스냅샷 큐, 재생, running 기록 종료 처리 |
| UI | popup/history/options/sidepanel의 HTML·React entry | 연결, 기록 관리, 설정, 보조 UI |
| Export | `src/storage/session-store/export-payload.ts`, `src/core/exporters/*`, offscreen | 선택·시간 필터, 출력 정규화, Blob 다운로드 |

### 데이터 저장·공유 상태

- IndexedDB schema **5**, session record version **4**. 세션 메타데이터와 자막 청크를 별도 object store에 두고 쓰기는 같은 readwrite transaction으로 수행한다.
- IndexedDB open/capability 실패 시 30초 TTL 후 재시도하며 `chrome.storage.local` per-session fallback을 사용한다. fallback 쓰기 실패 시 메모리 변경을 되돌리는 보호가 있다.
- 설정, fallback 인덱스·메타데이터, 종료 복구 레코드·인덱스, 진단, frame nonce 등은 확장 storage에 저장한다.
- Content의 `state`, `liveCaptureLedger`, 분할 대기 큐는 페이지별 메모리다. 저장소의 `queues: Map`, fallback queue, memory cache는 **각 JavaScript 실행 환경별 모듈 상태**다. 같은 확장 ID를 사용해도 History 문서와 service worker의 Map은 공유되지 않는다.
- 서버 DB, SQL, 사용자 파일 경로를 여는 런타임 subprocess는 활성 핵심 흐름에 없다. 브라우저 다운로드 API로 파일을 생성한다. DB transaction/migration 감사는 IndexedDB를 대상으로 했다.

### 핵심 실행 흐름

```text
지원 player URL
 → content bootstrap / lifecycle start
 → AI 자막 레이어 활성화
 → page-world observer 또는 local polling / frame fallback
 → token·nonce 검증 / normalizeCaptureEvent
 → reconcileLiveCapture → commitLiveRow → committed entries
 → 패널·popup 갱신 / 자동 분할 / autosave
 → PERSIST_SESSION_RECORD → background handler
 → updateRunningSession 또는 saveSession
 → IDB metadata+chunks transaction / chrome.storage fallback
 → 저장 시각 또는 오류 표시

History 입력
 → 빈 본문·메타데이터·선택 상태 확인
 → updateSessionContent / updateSessionMetadata / updateSessionLineageMetadata
 → load → patch → writeSessionRecord
 → library revision 알림 / 목록 재조회

JSON 파일
 → 25 MiB 제한 / abort-aware 파일 읽기 / JSON parse
 → parseSessionImportPayload allow-list·날짜·URL 검증
 → importSessionRecords (running→saved, updatedAt 비교)
 → record별 저장 / 부분 성공·취소 요약

내보내기
 → 세션 또는 lineage 조회 → 선택·시간 범위 필터
 → 출력 정규화 → 형식별 exporter
 → offscreen Blob → chrome.downloads
 → 실패 시 크기 제한 내 data URL fallback
전체 JSON 백업 → page-wise packaging → History page Blob 다운로드

pagehide / beforeunload
 → 확정 entries의 stopped 스냅샷
 → 종료 큐 저장 → background 저장 시도
 → onStartup/onInstalled: queue replay → 잔여 running cleanup → 진단
```

### 국회 사이트 실측

**관측 시각: 2026-09-09 약 11:03~11:06 KST.** 단순 HTTP 추출에는 빈 중계 카드와 기본 달력만 나타났으나, JavaScript가 실행된 브라우저에서는 실제 당일 목록이 표시됐다. 정적 HTML의 빈 목록을 “중계 없음”으로 판단하지 않았다.

- [공식 홈](https://assembly.webcast.go.kr/main/)에 **법사위 ‘개의’와 생중계 링크**가 있었고 **본회의는 14:00 중계예정**이었다.
- [확인한 플레이어](https://assembly.webcast.go.kr/main/player.asp?xcode=25&xcgcd=DCM000025224390201&)의 제목은 **제439회 국회(정기회) 제02차 법제사법위원회**였다.
- AI 자막보기 클릭 후 `.btn_subtit_ai.on`, `#viewSubtit`의 `display:block`, `.incont`, `p.smi_word.stxt789` 등의 행과 `span#segarr_789_0` 구조를 확인했다. 관측한 player 문서에는 iframe/frame이 없었다. 다른 중계의 프레임 구성까지 일반화하지 않는다.
- 11:04:43의 `stxt789…796`에서 11:06:23의 `stxt804…809`로 행과 문장이 변경됐다. **실시간 자막 공급은 실제 관측으로 확인**했다.
- 확정 행은 투명 배경, 발언자 색은 `rgb(35,124,147)` / `rgb(30,30,30)`, 미확정 행은 `#cfe5f7` 배경과 `#0c2b80` 글자색이었다. 구현의 class key·발언자 분류·배경 필터와 부합한다.
- 관측 구조 중 3행을 임시 jsdom에서 재구성해 현재 `readObservedSubtitleRows`를 실행했다. **stable class key 2행, primary/secondary 분류, 미확정 1행 제외**를 확인했다. 실제 확장의 수집·저장 완료 테스트를 대신하는 결과는 아니다.
- 내장 브라우저에서 영상은 재생되지 않았고 마지막 관측은 `paused:true, readyState:0, error:null`이었다. 영상 스트림의 정상 재생·음성과 자막의 정확도는 확인하지 못했다. 이를 확장 버그로 분류하지 않았다.
- 보조 호스트 `webcast.assembly.go.kr`는 web 접근이 실패했고 Windows `Resolve-DnsName`도 “DNS 이름이 없습니다”를 반환했다. **현재 감사 환경의 결과**이며 전 세계 장애로 단정하지 않는다. README에 이미 보조 호스트 불통 가능성이 명시되어 있다.

후속 실측(2026-09-17, 외통위·복지위 개의 중): `SITE_COMPATIBILITY_REVIEW_2026-09-17.md`. URL·자막 DOM 계약은 유지되며 이 감사 시점 코드 수정은 없다.

## 3. Audit Coverage & Limitations

### 확인한 범위와 CodeGraph 사용

CodeGraph **MCP `codegraph_explore`를 실제 사용**했다. 먼저 entrypoints, storage/export/import, 다음으로 정확한 심볼을 조회했으며 다음 경로와 영향 범위를 확인했다.

| 호출 관계 | 확인 사항 |
|---|---|
| `updateSessionContent → loadSession → withSessionStoresTransaction` | 읽기와 후속 쓰기의 transaction 경계 |
| `saveSession/updateRunningSession → preserveStoredSessionMetadata → writeSessionRecord` | 메타 보존 범위와 session-id queue |
| `handleTopFrameEvent → queueSegmentRolloverEvent`, `flushQueuedSegmentRolloverEvent → handleTopFrameEvent` | 버퍼 진입·재생과 stop 경쟁 |
| `applyStructuredRowsEvent → reconcileLiveCapture/commitLiveRow` | 행 보정·commit 및 state 변경 |
| `readObservedSubtitleRows ← dom-probe/injected-observer` | 실제 DOM 선택자와 발언자·미확정 분류 |
| `queueExitPersistRecord/list/clear ← page exit/startup/store` | 복구 인덱스·메모리 merge·삭제 영향 |
| `exportSessionData/exportSessionLineageData ← service-worker` | 세션 기반 출력 조립, 선택·시간 필터 |
| `importSessionRecords ← History` | UI validation 이후 저장, 취소·부분 성공 |
| `closeRunningSessionsOnStartup ← runStartupPersistenceMaintenance` | replay 후 cleanup 순서 |

MCP 응답에는 크기 제한에 따른 생략 구간이 있었다. 그 구간의 handler 본문, UI disabled 조건, migration·worker listener·설정 구현은 `rg`와 직접 열람으로 보완했다. 그래프의 이름 매칭은 모호한 후보나 facade import를 caller로 포함할 수 있다. 따라서 그래프가 “테스트 없음”이라고 출력한 것만으로 테스트 부재를 단정하지 않았고 실제 테스트 파일도 확인했다.

### 실행 결과

| 검증 | 결과 / 의미 |
|---|---|
| `npm run test -- --reporter=dot` | **69 files / 375 tests passed**, 38.61초. jsdom/fake-indexeddb 및 UI/API 대역 기반 |
| `npm run lint` | 성공, 오류 출력 없음 |
| `npm run check:version` | 1.0.13 일치 |
| `npm run check:injected` | 성공, 생성 observer와 소스 일치 |
| `npm run typecheck` | **실행 실패**: `Cannot find module 'typescript-7/package.json'` |
| `node node_modules/typescript/bin/tsc --noEmit` | 설치된 **TypeScript 5.9.3**로 보조 검사 성공. 프로젝트 지정 TS7 검사 통과를 의미하지 않음 |
| `node node_modules/vite/bin/vite.js build --outDir <TEMP>/assembly-audit-build-20260909` | 성공, Vite 표시 2.07초. 기존 `dist`를 덮어쓰지 않는 임시 production build |
| 임시 재현 harness | 실제 저장 모듈을 esbuild로 메모리 번들링하여 아래 4가지 잘못된 결과 재현; DOM 파서 호환 확인 |
| 공식 사이트 브라우저 검사 | 당일 중계 목록, 법사위 player, 자막 활성화와 시간차 갱신 확인 |

`npm run verify`, `npm run build` 전체 script, TS6/TS7 정식 검증, coverage 측정, `verify:e2e`, `test:e2e:extension`은 통과했다고 주장하지 않는다. 표의 임시 Vite 빌드는 별도 명령이다. dependency 설치는 하지 않았다. 로컬 Node는 **v24.19.0**, CI는 Node 20이므로 환경도 동일하지 않다.

테스트 stderr의 quota/transaction/clear 실패 문구는 기존 실패 주입 테스트의 예상 로그였으며, 테스트 실패와 구분했다.

### 격리 재현 방법과 결과

임시 파일: `C:/Users/soulb/AppData/Local/Temp/assembly-audit-repro.mjs`, 결과 `assembly-audit-repro.log`. 기존 설치된 esbuild/fake-indexeddb/jsdom만 사용했다. 번들은 `write:false`, ESM data URL로 로드했고 A/B에 서로 다른 import fragment를 부여해 모듈 전역 상태를 분리했다. 두 인스턴스가 하나의 **메모리 fake-indexeddb와 구조 복사하는 비동기 chrome.storage 대역**을 공유하도록 했다. 실제 Chrome 프로필에는 연결하지 않았다.

주요 입력과 출력은 다음과 같다. 향후 회귀 테스트에서는 아래 잘못된 결과가 발생하지 않아야 한다.

```text
1) updateRunningSession(original e1)
   → updateSessionContent(e1 = user edit, highlighted=true, entryNote=user note)
   → updateRunningSession(original e1 + new e2)
   결과: e1.text=original, highlighted=false, entryNote=null, count=2

2) A와 B가 동시에 같은 saved 기록에
   A.updateSessionMetadata({note: retained note})
   B.updateSessionMetadata({starred: true})
   결과: note="", starred=true (양쪽 호출은 성공)

3) anchor 큐를 저장한 뒤 A.queue(queue-a), B.queue(queue-b)를 동시 호출
   → 메모리가 없는 새 모듈에서 listQueuedExitPersistRecords()
   durable keys: anchor, queue-a, queue-b
   index/listed: anchor, queue-b (queue-a 누락)

4) saved 기록 + 더 최신 stopped 종료 큐
   → deleteSession → loadSession → replayQueuedExitPersistRecords → loadSession
   결과: 삭제 직후 없음, replay 후 다시 존재

5) 실사이트 대표 DOM: 투명 배경 2행 + 하늘색 배경 1행
   결과: class:stxt789/secondary, class:stxt795/primary,
         둘 다 unstable=false, filtered=1
```

### 한계·반증 결과

- 확장 설치가 없는 내장 브라우저에서 사이트만 확인했다. 최신 빌드를 로드한 실제 Chrome에서 `DOM → 확장 panel → SW → 실제 IDB → 다운로드 파일` 전체 경로는 이번에 실행하지 않았다.
- Windows에서 수행했으며 macOS/Linux 실행, 실제 quota 고갈, OS 강제 종료, 브라우저 crash·자동 업데이트, 장시간 본회의·대형 lineage export는 미검증이다.
- 코드 변경 없이 한정된 감사다. 모든 소스 줄을 읽거나 모든 라이브러리의 동작을 독립 검증한 것은 아니다.
- 동일 실행 환경의 session queue, metadata+chunks transaction, transient messaging retry, fallback rollback, preview 비승격, import allow-list, CSV 안전 처리 등 기존 보호를 확인했다. 이를 없는 것처럼 지적하지 않았다.
- Page-world token과 panel CustomEvent는 같은 의사중계 호스트 스크립트가 접근할 수 있으나, `SECURITY.md`가 명시한 신뢰 호스트 전제와 일치한다. 이 사실만으로 원격 침해 취약점이라고 분류하지 않았다.
- 전체 import 취소의 부분 완료는 문서화된 정책이다. 전체 rollback 부재를 버그로 분류하지 않았다. 보조 호스트 DNS 실패, bounded queue의 상한, 모듈 크기 자체도 별도의 production 버그로 세지 않았다.

## 4. High-Risk Issues

이 절에는 재현으로 확인한 Confirmed 4건과 코드 근거가 강한 Likely 1건만 포함한다. 절 이름과 별개로 각 항목의 실제 심각도는 개별 표기를 따른다.

### [ISSUE-001] 수집 중 History의 행 편집이 다음 자동 저장에 덮어써진다

- **위치:** `src/history/app/App.tsx:809` `persistSelectedEntries`, `src/storage/session-store/public-api/mutations.ts:187` `updateRunningSession`, `src/storage/session-store/normalize.ts:202` `mergeEditableSessionMetadata`
- **우선순위:** High
- **신뢰도:** Confirmed
- **문제:** History는 저장된 `entries`를 수정하지만 content의 캡처 state에는 수정이 전달되지 않는다. 다음 자동 저장이 content의 전체 entries로 기존 본문을 교체한다. 보존 함수는 세션의 note/star/tags 등을 보존할 뿐 행의 text/highlight/entryNote를 합치지 않는다.
- **발생 조건:** 수집이 계속되는 세션을 History에서 편집하거나 중요 표시한 후 다음 자동 저장 또는 최종 저장이 발생한다. 매우 짧은 동시 실행 창이 필요하지 않으며 순차 호출만으로 발생한다.
- **영향:** 사용자 수정, 중요 표시, 행 메모가 소실된다. 삭제·병합·분할 역시 캡처 snapshot과 충돌할 수 있다. 오래된 History 전체 entries를 저장하면 최근 캡처분을 일시적으로 되돌릴 위험도 있다.
- **근거:** 격리 재현 1에서 `user edit / highlighted=true / user note` 저장 뒤 자동 저장을 실행하자 `original / false / null`이 됐다. 새 캡처 행 e2는 남아 있어 파일 손상이 아닌 덮어쓰기임을 확인했다.
- **반증 확인:** `persistSelectedEntries`는 selectedSession 존재만 확인한다. `SessionDetailPanel.tsx:921` 부근 편집·중요 표시 버튼의 disabled 조건은 `actionButtonsDisabled`이며 running 제한이 없다. 세션 쓰기 큐는 순서만 보장하므로 순차 덮어쓰기를 막지 못한다. History의 revision refresh도 content state를 갱신하지 않는다.
- **호출/영향 범위:** CodeGraph의 `History → updateSessionContent → writeSessionRecord`와 `content persist → worker → updateRunningSession → preserveStoredSessionMetadata → writeSessionRecord`가 같은 레코드에서 만난다. History 결과와 이후 모든 export에 영향이 있다.
- **권장 수정 방향:** 우선 실제 캡처 중인 세션의 행 편집을 UI·저장 API 양쪽에서 보호한다. 수동 저장이 status를 saved로 바꿔도 캡처는 계속될 수 있으므로 단순 persisted status 검사만으로 해결하지 않는다. 장기적으로 캡처 원문과 사용자 편집/삭제 overlay를 entry-id 기준으로 분리하거나, 충돌을 검출하는 patch/revision 정책을 둔다.
- **필요한 회귀 테스트:** original e1 저장 → e1 수정·중요 표시·메모 → e2 수집 → 자동/최종 저장. e1 사용자 변경과 e2가 함께 남거나 편집 요청이 명시적으로 거부되어야 한다. 수정뿐 아니라 삭제·분할·병합을 포함한다.

### [ISSUE-002] 세션 쓰기 큐가 실행 환경별로 분리되어 변경 유실을 막지 못한다

- **위치:** `src/storage/session-write-queue.ts:6`, `src/storage/session-store/public-api/mutations.ts:223`, `src/storage/session-store/mutations-internal.ts:146` 및 `:155`
- **우선순위:** High
- **신뢰도:** Confirmed
- **문제:** 모듈 전역 Map으로 만든 큐는 History 문서와 service worker 사이에 공유되지 않는다. `loadSession → patch/preserve → write`의 읽기는 후속 쓰기 transaction 밖에 있으며, 두 환경이 같은 이전 snapshot을 읽고 각각 전체 레코드를 덮어쓸 수 있다.
- **발생 조건:** History 두 창에서 같은 기록을 변경하거나, History 메타데이터 저장과 background 자동 저장이 겹친다.
- **영향:** 성공 응답 이후에도 한쪽 note/star/tags 또는 캡처 snapshot이 사라질 수 있다. ISSUE-001의 순차 편집 충돌과는 별개로 세션 메타데이터에도 발생한다.
- **근거:** 독립 번들 A/B의 동시 `note` 및 `starred` patch가 모두 resolve했지만 결과는 `note="", starred=true`였다. 공유 fake-indexeddb가 실제 transaction 순서를 처리하는 상태에서 재현했다.
- **반증 확인:** IDB metadata+chunks write transaction은 부분 청크 저장을 방지한다. 하지만 transaction 안에서 읽는 `previousRecord`는 청크 갱신용이며 이미 작성한 record를 최신 값에 다시 merge하지 않는다. 세션별 queue·History busy UI·storage revision은 별도 실행 환경의 임계 구역이 아니다.
- **호출/영향 범위:** CodeGraph에서 History는 `updateSessionMetadata/updateSessionLineageMetadata/updateSessionContent`를 직접 호출하고, worker는 `saveSession/updateRunningSession`을 호출한다. lineage 메타 편집도 내부에서 session-id 큐를 사용하므로 같은 한계가 있다. fallback의 전역 mutation queue도 실행 환경별이라는 점을 수정 설계에 포함해야 한다.
- **권장 수정 방향:** 변경 명령을 단일 background writer에 모으고 read-modify-write를 같은 직렬화 경계에 둔다. 또는 모든 writer가 참여하는 공유 lock/IDB transaction/revision 비교·재시도를 도입한다. in-memory Map만 추가하는 수정은 충분하지 않다.
- **필요한 회귀 테스트:** 독립 History/worker 환경에서 note 변경과 autosave를 barrier로 교차시켜 최신 entries와 note가 함께 남는지 확인한다. History 두 창의 서로 다른 metadata patch도 모두 보존되어야 한다.

### [ISSUE-003] 종료 복구 인덱스의 경쟁으로 저장된 스냅샷을 재시작 후 놓친다

- **위치:** `src/storage/persist-recovery.ts:47` `addSessionIdToExitPersistIndex`, `:267` `queueExitPersistRecord`, `:323` `listQueuedExitPersistRecords`
- **우선순위:** High
- **신뢰도:** Confirmed
- **문제:** 종료 레코드와 공용 인덱스를 별도로 저장하고 인덱스에 `get → 배열 추가 → set`을 수행한다. 동시 추가가 서로를 덮어쓰면 실제 레코드는 존재해도 인덱스에서 사라진다. 이후 조회는 인덱스에 있는 키만 읽는다.
- **발생 조건:** 두 수집 탭 종료, 또는 content와 background의 queue/cleanup 호출이 겹친다. 이후 작성 환경 메모리가 사라지고 background 직접 저장도 완료되지 않아 큐 재생이 필요한 경우가 특히 중요하다.
- **영향:** 마지막 확정 자막 스냅샷이 복구에서 누락되어 이전 autosave까지만 보일 수 있다. 원본 storage key는 남지만 정상 UI에서 발견하지 못할 수 있다.
- **근거:** anchor 존재 상태에서 queue-a/b를 동시 기록했다. 세 레코드 키가 모두 저장됐지만 인덱스는 `[anchor, queue-b]`였고 새 모듈의 조회도 두 건만 반환했다.
- **반증 확인:** 기존 memory-before/after merge는 같은 런타임의 snapshot만 보완한다. 새 worker는 다른 content의 소실된 메모리를 읽지 못한다. 전체 스캔 복구는 `index.length === 0`일 때만 수행되어 **비어 있지 않은 불완전 인덱스**를 고치지 못한다. background 직접 저장 성공은 일부 경우를 구제하므로 “모든 동시 종료에서 유실”이라고 단정하지 않는다.
- **호출/영향 범위:** CodeGraph의 page-exit queue → storage index/list → `replayQueuedExitPersistRecords → saveSession` 경로. 인덱스 삭제·정리의 read-modify-write 역시 동일 공유 자원에 참여한다.
- **권장 수정 방향:** queue 본체를 원자적 저장소/단일 writer로 관리하고 인덱스가 유일한 발견 수단이 되지 않게 한다. 기존 고아 레코드의 일회 재조정·복구도 포함한다. content를 background로 단순 우회시킬 경우 page-exit 전달 실패에 대한 durable 보장은 별도로 유지해야 한다.
- **필요한 회귀 테스트:** 비어 있지 않은 인덱스에서 서로 다른 ID 동시 enqueue → 모든 모듈 메모리 폐기 → 새 reader/replay. 저장된 모든 최신 stopped snapshot을 발견해야 한다. enqueue와 clear, 레코드 set 성공 후 인덱스 set 실패도 포함한다.

### [ISSUE-004] 자동 분할 중 Stop이 큐에 대기한 자막을 버린다

- **위치:** `src/content/app/runtime/orchestrator/runtime-core.ts:1630`, `:1713`, `:2313` `stopCaptureUnlocked`, `:2334` `rollOverRunningSessionSegment`
- **우선순위:** Medium
- **신뢰도:** Likely
- **문제:** 자동 롤오버는 lifecycle lock 바깥에서 fire-and-forget으로 시작된다. 그 저장 응답을 기다리는 동안 자막 이벤트는 state에 반영되지 않고 큐에 쌓인다. Stop은 큐를 재생하기 전에 token을 변경하고 `queuedSegmentRolloverEvents = []`로 비운 뒤 현재 state만 저장한다.
- **발생 조건:** 분할 threshold 도달 → persist 지연 중 새 stable row 수신 → 저장 완료 전에 사용자 Stop. 느린 storage/worker 응답이면 충분히 가능한 순서다.
- **영향:** 분할 대기 구간의 확정 가능한 자막이 마지막 저장에서 빠질 수 있다. 이 손실은 queue overflow가 아니므로 droppedTotal 진단에도 반영되지 않는다.
- **근거:** `handleTopFrameEvent`의 in-flight 분기는 enqueue 후 즉시 return한다. Stop의 큐 초기화는 snapshot 작성 전이다. 이전 rollover의 finally는 token이 달라지면 flush하지 않는다. 정적 흐름으로 확인했으나 실제 Chrome에서 이 타이밍을 강제로 재현하지는 않았다.
- **반증 확인:** Stop 자체는 lifecycle lock을 사용하지만 자동 rollover 호출은 같은 lock에 예약되지 않는다. 큐 상한 128이나 일반 완료 시 flush는 Stop의 무조건 초기화를 보호하지 못한다. 중지 후 이벤트는 running 검사에서 제외되므로 다시 관측해도 현재 저장에 보충되지 않는다.
- **호출/영향 범위:** CodeGraph의 `handleTopFrameEvent → rollOverRunningSessionSegment/persistSessionRecord`, `handleCommand → stopCaptureUnlocked`가 segment token/state/queue를 공유한다. 최종 세션·lineage 출력에 영향이 있다.
- **권장 수정 방향:** Stop과 rollover의 완료·취소를 하나의 명시적 순서로 조정한다. 대기 이벤트를 기존/다음 세그먼트 중 하나에 정확히 한 번 반영한 뒤 stopped snapshot을 만든다. page-exit/clear/save-and-new도 같은 종료 정책을 점검한다.
- **필요한 회귀 테스트:** persist promise를 보류하고 stable row B/C를 enqueue → Stop → persist 해제. 모든 세그먼트 합계에 A/B/C가 각각 한 번 존재해야 한다. 실패 응답과 URL 이동도 별도 검사한다.

### [ISSUE-005] 삭제한 세션이 종료 복구 큐에서 되살아난다

- **위치:** `src/storage/session-store/public-api/deletions.ts:160` `deleteSession`, `:207` `deleteAllSessions`, `src/storage/session-store/public-api/startup.ts:161` `replayQueuedExitPersistRecords`
- **우선순위:** Medium
- **신뢰도:** Confirmed
- **문제:** 기록 삭제는 IDB와 fallback을 처리하지만 해당 종료 복구 큐를 제거하거나 삭제 tombstone을 남기지 않는다. 이후 replay가 기존 기록을 찾지 못하면 큐 내용을 다시 저장한다.
- **발생 조건:** page-exit 저장이 끝나지 않아 큐가 남아 있는 세션을 History에서 삭제한 후 다음 startup/install 복구가 실행된다. 기존 autosave 덕분에 삭제할 세션이 History에 보이는 상황이다.
- **영향:** 사용자가 삭제 완료로 인식한 기록이 재등장한다. 기록 정리 및 삭제 의도와 데이터 보존 상태가 어긋난다.
- **근거:** 더 최신 stopped 큐가 있는 saved 세션을 삭제하면 `loadSession`은 없음을 반환했다. replay 이후 같은 ID가 다시 존재했다.
- **반증 확인:** History의 삭제 확인은 사용자 의도 확인일 뿐 queue lifecycle을 변경하지 않는다. `deleteSessionLineage`도 `deleteSession`을 반복 호출한다. startup의 freshness 비교는 기존 레코드가 없으면 보호하지 못하며, 삭제 함수들에 queue 제거 호출은 없다. 정상 저장 성공 시 queue 정리는 있지만 삭제 성공 경로에는 적용되지 않는다.
- **호출/영향 범위:** CodeGraph의 `History → deleteSessionLineage → deleteSession` 및 `startup → replayQueuedExitPersistRecords → saveSession`. 전체 삭제도 같은 누락을 코드에서 확인했지만 별도의 전체 삭제 재현은 실행하지 않았다.
- **권장 수정 방향:** 삭제를 해당 queue 정리와 조정하고 늦게 도착한 저장/replay에 대한 삭제 revision/tombstone 정책을 정의한다. 단순 remove 한 번만으로 동시 재삽입까지 해결되지는 않는다.
- **필요한 회귀 테스트:** 저장된 세션 + pending stopped 큐 → 개별/lineage/전체 삭제 → 새 모듈에서 replay. 삭제한 기록은 없어야 하고 관련 없는 큐는 보존되어야 한다. 삭제와 지연 enqueue의 교차도 검사한다.

## 5. Potential Functional Gaps

현재 버그와 분리하여 기능·안정성 보완 후보를 기록한다.

| 분류 | 항목 | 근거와 필요한 결정 |
|---|---|---|
| Confirmed Gap | 실제 확장 다중 실행 환경을 연결한 자동 검증 | 현 테스트는 각 모듈 helper와 대역 중심이다. `content-runtime.test.ts`도 helper 테스트이며 실제 runtime-core start/stop/rollover 전체를 실행하지 않는다. 이번 4개 저장 재현은 기존 suite가 모두 통과하는 상태에서 발생했다. |
| Confirmed Gap | 큰 export의 transport-level streaming | `service-worker.ts:324`는 문자열을 부분 배열로 나누지만 배열 전체를 **한 번의** runtime message로 보낸다. chunk 배열은 메시지 총량을 줄이지 않는다. 실제 메시지 제한 초과 재현은 하지 않았으므로 현재 모든 대형 export가 실패한다고 분류하지 않는다. segment 분할 내보내기는 workaround다. |
| Likely Gap | 종료 직전 durable 저장 기회 확보 | `persistQueuedPageExitRecord`는 진단 쓰기를 await한 뒤 queue 쓰기, 그 뒤 background persist를 수행한다. 페이지 파괴 시 비동기 완료는 검증되지 않았다. 진단을 핵심 저장보다 먼저 기다릴 필요와 사전 checkpoint 전략을 검토할 가치가 있다. |
| Likely Gap | 복구 완료를 보장하는 재시도 정책 | startup/install 시 복구는 있지만 첫 replay 실패 후 성공할 때까지의 주기적 복구 보장은 확인하지 못했다. transient queue/storage 오류 뒤의 재실행 시점을 제품 정책으로 정해야 한다. |
| 추정 | 이전 자막 전체 회수·영상 시간과의 정밀 동기화 | 현 목적은 접속 후 DOM에 제공되는 자막 수집이며 SRT/VTT는 세션 시작 기준 시간이다. 중계 처음부터 회수하거나 영상 시간에 정밀 정렬하는 기능이 필요한지는 별도 요구사항 결정 사항이다. 누락 구현 버그로 단정하지 않는다. |

## 6. Documentation Mismatches

- **CLAUDE.md §7.3의 메타데이터 보존 기대와 실제 실행 환경 경계:** stale snapshot이 본문·상태를 되돌리면 안 된다는 원칙이 있고, 2026-07-28 delta는 preserve+write 큐를 명시한다. 구현은 한 환경 안에서는 이를 따른다. 그러나 환경 간 보장은 없어 ISSUE-002가 남아 있다. 문구만 고칠 사안이 아니라 코드 보완이 우선이다.
- **CLAUDE.md §4.3의 상태 소유 파일 설명:** `app/runtime/implementation.ts`가 orchestration을 소유한다고 되어 있지만 실제 본체는 `app/runtime/orchestrator/runtime-core.ts`다. §3의 최신 구조 표는 맞고 일부 설명만 과거 위치를 가리킨다.
- **CLAUDE.md의 2026-07-28 queue 기본 64 설명:** 현재 `DEFAULT_SEGMENT_ROLLOVER_EVENT_QUEUE_MAX`는 128이다. 뒤의 2026-08-12 delta에는 정정되어 있으나 앞 설명과 중복·상충한다.
- **CLAUDE.md의 “CI runs npm run verify” 설명:** 실제 workflow는 별도 step으로 동등한 주요 명령들을 실행한다. 동작 누락 자체가 아니라 실행 명령 설명의 차이다.
- **README의 자동 저장·복구 표현:** 기능은 존재한다. 다만 이번에 확인한 편집/동시성/큐 발견 실패를 고려하면 데이터 보존 보장으로 읽히지 않도록 조건을 명확히 할 필요가 있다.

주/보조 호스트 안내, 현재 버전, 여섯 export 형식, CSV BOM, 홈과 player 역할, 레코드 4/IDB 5, import 부분 완료 정책은 확인 범위에서 구현과 대체로 일치했다. 로컬 TS7 패키지 부재는 **현재 설치 환경과 manifest의 불일치**이며, 이를 clean install 또는 production 코드의 확정 오류라고 쓰지 않는다.

## 7. Recommended Fix Plan

### Phase 1 — Immediate

1. **ISSUE-001:** 실제 캡처 ownership과 연결한 편집 보호를 먼저 적용한다. 행 metadata를 포함한 사용자 수정 보존/충돌 정책을 결정한다.
2. **ISSUE-002:** History와 worker가 공유하는 쓰기 경계를 만든다. IDB read-modify-write 원자성 또는 revision 검증을 포함하고, fallback·import·삭제도 같은 writer 정책에 참여시킨다.
3. **ISSUE-003:** 종료 큐 인덱스 경쟁을 제거하고 이미 생긴 고아 레코드도 검색·복구한다. 인덱스가 비어 있을 때만 복구하는 조건을 수정한다.

각 수정은 위 격리 재현을 정상 기대값의 회귀 테스트로 전환한 뒤 진행한다. 이번 감사에서는 구현하지 않았다.

### Phase 2 — Stability

1. **ISSUE-004:** Stop/rollover/page-exit/URL 전환의 버퍼 처리 순서를 통합한다. 정상 종료, 저장 실패, 늦은 완료마다 commit 책임을 한 곳에 둔다.
2. **ISSUE-005:** 삭제와 queue replay 간 일관성을 확보한다. 개별·lineage·전체 삭제를 모두 검증한다.
3. 저장 지연·queue 실패·fallback quota·worker 응답 유실을 주입하고 복구 안내와 재시도 결과를 사용자 관점에서 확인한다.
4. 환경이 준비된 시점에 프로젝트 지정 TS7/TS6와 Node 20 clean-install 검증을 수행한다. 이번에는 감사 외 dependency 설치를 하지 않았다.

### Phase 3 — Structural

1. runtime-core를 분리한다면 파일 크기가 아니라 **캡처 이벤트 입력, lifecycle, persist 결과**를 독립적으로 제어할 수 있는 경계를 우선한다.
2. History의 전체 entries 교체를 entry-id patch/revision 기반으로 바꾸고 캡처 데이터와 사용자 편집을 분리한다.
3. transport-level export streaming 및 큰 백업의 메모리 상한을 검증한다. 현재 chunk-array와 실제 메시지 분할을 명확히 구분한다.
4. 독립 extension context 및 실제 Chromium storage를 사용하는 통합 시나리오를 CI/릴리스 검증에 추가한다. 일반 스타일 리팩터링은 이 계획의 목적이 아니다.

## 8. Test Recommendations

아래는 **추가 권장 테스트**이며 실행 결과가 아니다. 현재 실행한 검사는 §3에만 기재했다.

| 종류 | 입력·실행 조건 | 기대 결과 |
|---|---|---|
| Unit / Regression — 001 | e1 수정·행 메모·중요 표시 뒤 e1+e2 autosave | 사용자 편집과 e2 동시 보존 또는 편집 거부. 성공 후 조용한 rollback 금지 |
| Integration / Concurrency — 002 | 두 독립 모듈/History·worker가 같은 버전을 읽도록 barrier, note/star/entries 별도 갱신 | 서로 다른 변경 모두 보존; 같은 필드 충돌은 revision 오류/명시적 정책 |
| Concurrency — 003 | anchor 큐 존재, A/B enqueue 동시 완료, 작성 메모리 폐기 | 새 reader/replay가 anchor/A/B 모두 발견 |
| Regression — 003 | 레코드 set 성공 후 index set 실패, 비어 있지 않은 stale index, enqueue와 clear 경쟁 | durable 레코드 발견·복구; 오래된 cleanup이 새 record를 제거하지 않음 |
| Integration — 004 | 낮은 분할 임계, persist promise 보류, stable B/C 이벤트, Stop, 응답 해제 | 세그먼트 합계에 A/B/C 각 1회, status stopped, 버퍼 손실 없음 |
| Regression — 005 | pending exit snapshot 존재 후 개별/lineage/전체 삭제, 새 모듈 replay | 삭제 기록 재등장 없음; 관련 없는 queue 정상 복구 |
| End-to-End — 실중계 | 별도 테스트 프로필에 최신 빌드 로드, 중계 중 접속, 자막 2회 이상 보정·화자 전환 관찰 | stable 행만 정확히 수집, 보정은 제자리 갱신, panel 수와 저장/export의 관계 일치 |
| End-to-End — 재시작 | 확정 N행 수집, 정상 종료 및 테스트 프로필 강제 종료를 분리, 재시작 | 정상 종료 최종 스냅샷 복구; 강제 종료는 마지막 durable checkpoint 범위 명시·진단 |
| Integration — IDB | 구 schema 데이터/청크를 test DB에 seed, v5 open; chunk put 중간 실패 주입 | lineage 기본값·메타·본문 보존; transaction 실패 시 부분 청크 노출 없음 |
| Integration — fallback | IDB open 실패 → chrome.storage 성공, 이어 quota 실패, 30초 뒤 IDB 복구 | 실패를 저장 성공으로 표시하지 않음; 이전 메모리 rollback; 최신본 선택·복귀 |
| Integration — import | 구 JSON v3, 잘못된 날짜, 미지원 URL, 중복 ID, 25 MiB 초과, 진행 중 취소 | 유효 레코드만 정규화; URL 제거; 크기 초과 명시 실패; 취소 시 정확한 부분 완료 수 |
| Concurrency — import | import compare 이후 다른 writer가 더 최신 record 저장 | import가 최신 변경을 과거 snapshot으로 덮어쓰지 않음; 최신성 판단을 쓰기 경계에서 재확인 |
| Unit / Export | 한글·emoji·CRLF·CSV `= + - @` 접두, speaker on/off, 선택 entry, 시간 경계 | 형식 파싱 가능, BOM/CRLF 및 수식 중화, speaker 옵션 일치, 원본 기준 시간 유지 |
| End-to-End — 큰 export | 메시지 직렬화 한도를 넘는 synthetic lineage, offscreen 실패, 분할 export | 가능한 경로는 정상 파일 생성; 불가능한 요청은 명시 오류, 중복 다운로드 없음 |
| Integration — UI 연결 | active tab 변경/닫힘, unsupported URL 이동, runtime port 일시 단절 | 현재 supported 탭으로 재연결 또는 안내; 영구 invalidation으로 오판하지 않음 |
| Platform-specific | Windows Chrome/Edge·macOS Chrome·Linux Chromium, 한글 파일명·이모지·금지문자·UTC/KST | 파일명·인코딩 정상, SRT/VTT 상대 시간 일치; UI 시간은 해당 로컬 시간 정책 준수 |
| Security / Regression | 외부 sender 명령, 잘못된 token/nonce, malformed import, sourceUrl `javascript:` | 거부/정규화, UI 실행 없음, 캡처 전체가 영구 정지하지 않음 |

기존 `verify:e2e`는 HTML 페이지 제목을 확인하는 smoke이고, `test:e2e:extension`은 요청을 fixture HTML로 대체한다. 둘의 통과를 “실중계 정확도와 저장 복구까지 통과”로 해석하면 안 된다.

## 9. Final Assessment

| 평가 항목 | 판정 | 근거 |
|---|---|---|
| Functional Correctness | **Needs Work** | 기본 기능과 실사이트 DOM 대응은 양호하지만 수집 중 편집 보존과 삭제 후 복구 의미론이 깨짐 |
| Runtime Stability | **Needs Work** | observer/polling·오류 fallback은 있으나 lifecycle과 자동 rollover의 종료 경쟁이 남음 |
| Data Integrity | **High Risk** | 순차 편집 덮어쓰기, 독립 context 동시 변경 유실, 재시작 queue 누락을 재현 |
| Error Resilience | **Needs Work** | TTL/retry/rollback/diagnostics 기반은 있으나 durable queue의 불완전 인덱스가 복구를 우회함 |
| Cross-platform Robustness | **Acceptable** | 브라우저 API 중심, UTF-8 CSV·파일명 보호·보조 타입검사/빌드 확인. macOS/Linux 실실행은 미검증 |
| Test Confidence | **Needs Work** | 375개 테스트 통과에도 context 간 경쟁과 실제 runtime lifecycle 연결을 놓침. 지정 TS7 검사도 환경상 미완료 |

**실제로 먼저 수정할 세 문제:**

1. **ISSUE-001 — 수집 중 사용자 편집을 다음 저장이 덮어쓰는 문제.** 동시성 타이밍 없이도 사용자 작업이 사라진다.
2. **ISSUE-002 — History와 background 사이의 쓰기 경계.** 같은 환경의 Map queue를 전체 확장의 lock으로 취급하지 않도록 한다.
3. **ISSUE-003 — 종료 큐 인덱스 경쟁과 고아 레코드 복구.** 저장된 최종 스냅샷이 실제 재시작 복구에 반드시 포함되도록 한다.

## 10. Audit Remediation Closure (2026-09-09)

감사에서 확인된 리스크 5건(ISSUE-001 ~ ISSUE-005)에 대해 제품 코드 수정 및 회귀 테스트를 완료했다.

### 10.1 조치 요약

1. **ISSUE-001 조치 (수집 중 사용자 편집 보존 및 구조적 변경 방어)**
   - `src/storage/session-store/normalize.ts`: `mergeCaptureSnapshotWithStoredEdits`, `mergeCaptureEntriesWithUserEdits`, `isStructuralEntryPatch` 구현. 자동 저장이 유입되더라도 History에서 사용자가 수정한 텍스트(`originalText` 보존), 행 메모(`entryNote`), 중요 표시(`highlighted`), 라벨(`labels`), 발언자(`speakerLabel`)를 유지.
   - `src/storage/session-store/public-api/mutations.ts`: 수집 중인 세션(`status === "running"` 또는 live capture ownership 보유)에 대한 구조적 편집(삭제·병합·분할) 시도 시 `LIVE_CAPTURE_STRUCTURAL_EDIT_ERROR` 예외로 안전하게 거부.
   - `src/history/app/App.tsx` & `SessionDetailPanel.tsx`: 수집 중인 세션에 대해 삭제/병합/분할 버튼 비활성화 및 안내 문구 노출.
   - 회귀 테스트: `tests/session-store.test.ts` ("keeps History row edits when the next running autosave adds a new entry", "rejects structural entry edits while a session is still being captured"), `tests/normalize-session-record.test.ts`, `tests/history-app.test.tsx`.

2. **ISSUE-002 조치 (실행 환경 간 쓰기 직렬화 및 원자적 IDB 갱신)**
   - `src/storage/session-write-queue.ts`: `navigator.locks.request` (Web Locks API)를 도입하여 History 문서, 팝업, Background Service Worker 등 서로 다른 JS 런타임 간에도 동일 세션 쓰기를 직렬화.
   - `src/storage/session-store/mutations-internal.ts`: `writeMutatedSessionRecord` 도입. IndexedDB `readwrite` 트랜잭션 내부에서 최신 레코드를 읽고 mutation을 적용한 뒤 청크 및 메타데이터를 원자적으로 저장하는 read-modify-write 보장.
   - 회귀 테스트: `tests/session-store-concurrency.test.ts` (독립 큐 우회 시에도 메타데이터 패치 보존 및 autosave와의 교차 보존 검증).

3. **ISSUE-003 조치 (종료 복구 큐의 durable 레코드 발견 보장)**
   - `src/storage/persist-recovery.ts`: `listQueuedExitPersistRecords()`에서 인덱스 배열에만 의존하지 않고 storage 전체에서 `assembly-subtitle-exit-persist:*` durable record를 스캔하여 동시 enqueue 경쟁이나 인덱스 누락/오염 상황에서도 고아 레코드를 100% 발견 및 복구하고 인덱스를 자동 재동기화.
   - 회귀 테스트: `tests/persist-recovery.test.ts` ("discovers concurrently queued records after the writer memory is discarded", "still lists a durable record when the shared index omits it", "keeps a queue record inserted during storage snapshot reconciliation").

4. **ISSUE-004 조치 (자동 분할 중 Stop 시 대기 큐 자막 보존)**
   - `src/content/app/runtime/orchestrator/runtime-core.ts`: `stopCaptureUnlocked()` 실행 시 `queuedSegmentRolloverEvents` 대기 큐를 즉시 폐기하지 않고, 남은 이벤트를 즉시 drain/commit하여 세션 상태에 반영한 뒤 최종 stopped snapshot을 생성·저장.

5. **ISSUE-005 조치 (삭제된 세션의 종료 복구 큐 부활 방지)**
   - `src/storage/persist-recovery.ts`: `markSessionDeleted`, `isSessionDeleted` 및 삭제 tombstone(`assembly-subtitle-deleted-session:*`) 도입. 삭제된 세션에 대한 지연 큐잉 차단 및 복구 목록에서 필터링.
   - `src/storage/session-store/public-api/deletions.ts`: `deleteSession` 및 `deleteAllSessions` 실행 시 즉시 exit persist queue를 정리하고 tombstone을 기록.
   - 회귀 테스트: `tests/session-store.test.ts` ("does not resurrect a deleted session when replaying queued exit persist records"), `tests/persist-recovery.test.ts` ("does not enqueue a stopped snapshot after the session was deleted").

### 10.2 검증 결과

- **Vitest**: **70개 테스트 파일 / 389개 테스트 전체 통과** (기존 375개 대비 +14개 테스트 추가)
- **ESLint**: 오류 0개 (`npm run lint` 통과)
- **Version / Injected**: `check:version` (1.0.13), `check:injected` 통과
- **TypeScript**: `tsc --noEmit` 통과
- **Vite Production Build**: `npm run build` 성공 (`dist/` 갱신 완료)
