# Project Audit

감사일: 2026-11-05 (Asia/Seoul) · 기준: `main`, `2d08586` · 제품 버전: `1.0.16`

추가 범위의 감사와 수정 결과: [PROJECT_AUDIT_ROUND2.md](PROJECT_AUDIT_ROUND2.md).

아래는 수정 전 기준의 감사 기록이다. 감사 당시 제품 소스·설정·테스트 코드는 수정하지 않았다. 이후 사용자 요청에 따른 개선 내역·현재 상태·검증 범위는 [AUDIT_REMEDIATION.md](AUDIT_REMEDIATION.md)에 별도로 기록한다. 실제 사용자 프로필·production 데이터는 사용하지 않았다.

## 1. Executive Summary

**전체 상태: Needs Work. 전체 위험도: High — 저장소 장애·복구 조건에서 데이터 보존 문제가 확인되었다.** 기본 수집·저장·검색·내보내기·복원 구조와 검증 체계는 갖춰져 있다. 단위 테스트 77개 파일/516개 테스트, 커버리지 게이트, TS7/TS6 타입 검사, lint, production build, 실제 Chromium 확장 스모크가 통과했다. 그러나 정상 경로의 성공이 저장소 전환과 여러 실행 환경의 동시 쓰기까지 보장하지는 않는다.

| 이슈      | 심각도 | 신뢰도    | 핵심 결과                                                                                    |
| --------- | ------ | --------- | -------------------------------------------------------------------------------------------- |
| ISSUE-001 | High   | Confirmed | IndexedDB 복구 후 캡처 저장이 폴백의 최신 사용자 메모를 버린다.                              |
| ISSUE-002 | High   | Confirmed | 별도 실행 환경의 동시 폴백 저장이 공용 인덱스를 덮어써 세션을 목록·검색·백업에서 누락시킨다. |
| ISSUE-003 | Medium | Confirmed | IndexedDB 개별 삭제 실패가 성공으로 반환되고 원본 기록이 남는다.                             |

**논리적 데이터 유실 가능성이 있다.** ISSUE-001은 최신 편집을 담은 폴백 복사본까지 삭제하므로 백업이 없으면 메모 복구가 어려울 수 있다. ISSUE-002는 원본 per-session 키가 남는 발견 가능성 문제로, 즉시 물리적 소실을 뜻하지 않는다. ISSUE-003은 삭제 미완료·성공 오표시다. DB 파일 자체의 물리적 손상, 전체 라이브러리 파괴, 심각한 외부 유출 경로는 이번 범위에서 확인하지 못했다.

먼저 **양 저장소 최신 상태 조정 → 폴백 공용 인덱스 직렬화 → 삭제 결과 정확성** 순으로 수정해야 한다. 일반적인 사용자 편집 보존, Web Locks 호출 오류, 종료 큐 고아 복구는 기존 보호 장치를 확인해 종전과 같은 미해결 버그로 남기지 않았다. 이번 이슈는 남아 있는 별도 실패 조건이다.

## 2. Project Understanding

### 목적·개발 규칙

- 국회 의사중계 사이트의 AI 자막을 수집하는 Chrome Manifest V3 확장이다. 페이지 우측 패널, popup, History, Options, 실험적 side panel을 제공한다.
- TXT/SRT/VTT/JSON/MD/CSV 출력, History 검색·메모·발언자·자막 편집, lineage 기반 긴 회의 분할, JSON 백업·가져오기가 핵심 기능이다.
- `README.md`, `CLAUDE.md`, `SECURITY.md`, manifest·의존성·빌드·테스트·CI 설정을 확인했다. 루트 `AGENTS.md` 파일은 없었다. 대화로 제공된 지침인 CodeGraph 우선, main 유지, 요청되지 않은 claude-mem 스킬 사용 금지를 적용했다.
- 활성 제품은 TypeScript/React 확장이다. 과거 데스크톱 코드·임시 유지보수 스크립트를 production 경로로 간주하지 않았다. 코드 변경 없는 감사이므로 Spec Kit 구현 산출물을 만들지 않았다.

### 주요 entrypoint·모듈

| 영역       | 진입점 / 핵심 모듈                                                                     | 역할                                        |
| ---------- | -------------------------------------------------------------------------------------- | ------------------------------------------- |
| Content    | `src/content/content-script.ts` → `app/runtime/orchestrator/runtime-core/lifecycle.ts` | bootstrap, 수집·패널·observer/polling 조립  |
| Page world | `src/content/injected-observer.ts` 및 하위 모듈                                        | DOM 관찰, 자막 행 읽기, 브리지 이벤트       |
| 캡처 상태  | `runtime-core/context.ts`, `capture-events.ts`, `session-lifecycle.ts`                 | 페이지별 상태, commit, 분할·종료            |
| 자막 로직  | `core/live-capture.ts`, `core/subtitle-pipeline/*`                                     | reconcile, 증분 추출, 중복·노이즈 필터      |
| Background | `background/service-worker.ts`, `service-worker-commands.ts`                           | 명령 검증, 영속화, 다운로드, startup        |
| 저장       | `storage/session-store.ts` → `public-api/*`, `idb/*`, `fallback/storage.ts`            | CRUD, 검색, 청크, import/export             |
| 복구       | `storage/persist-recovery/*`, `background/startup-persistence.ts`                      | 종료 큐, tombstone, replay, running cleanup |
| UI         | popup/history/options/sidepanel HTML·React entry                                       | 사용자 명령·기록 관리·설정                  |
| 출력       | `session-store/export-payload.ts`, `core/exporters/*`, offscreen                       | 선택·시간 범위, 포맷 변환, Blob 다운로드    |

### 데이터·외부 의존성·공유 상태

- IndexedDB schema 5, session record version 4. 메타데이터와 자막 청크를 별도 object store에 두고 같은 readwrite transaction에서 저장한다.
- IDB 실패 시 `chrome.storage.local` per-session 폴백을 사용하며 마지막 수단은 메모리다. 설정·폴백 인덱스/메타데이터·종료 큐·진단·nonce도 Chrome storage에 저장한다.
- `enqueueSessionWrite`는 세션 ID별 Web Locks와 메모리 큐를 사용한다. History와 서비스 워커는 모듈 메모리를 공유하지 않는다. 폴백 공용 인덱스 큐는 별도 모듈 상태다.
- 입력은 지정된 두 의사중계 호스트의 DOM이다. 자체 전사 API를 호출하는 구조가 아니다. production npm 의존성은 React/React DOM, 개발 도구는 Vite·CRXJS·esbuild·Vitest·Playwright 등이다.
- 활성 런타임은 서버 SQL DB·사용자 경로 파일 쓰기·OS subprocess를 필요로 하지 않는다. 다운로드는 Chrome downloads/Blob 경로다. SQL·shell보다 IDB transaction·메시지 경계·파일명·CSV를 확인했다.

### 핵심 사용자 흐름

1. **수집:** `content-script → createContentRuntime/bootstrap → 설정·nonce → observer/polling → handleTopFrameEvent → normalizeCaptureEvent/analyzeCaptureCommit → structured reconcile 또는 안정 관측 fallback → SessionState.entries → 패널`.
2. **저장:** `commit/수동 저장/종료 → committed snapshot → PERSIST_SESSION_RECORD → sender·payload 검증 → updateRunningSession/saveSession → Web Lock → 기존 편집 병합 → IDB metadata+chunks transaction / 폴백 → revision·updatedAt 응답`.
3. **History 편집:** `사용자 입력 → hook → updateSessionMetadata/updateSessionContent → 최신 record mutator → transaction → revision → 재조회`. 수집 중 구조 변경에는 status/ownership 보호가 있다.
4. **출력:** `선택·시간 범위·포맷 → background load → createSessionExportPayload → 출력 정규화 → exporter → offscreen Blob → downloads → 완료/중단 시 URL 정리`. data URL 폴백은 작은 데이터로 제한된다.
5. **복원:** `파일 → 25 MiB 검사 → abort-aware 읽기 → JSON.parse → allow-list sanitize → importSessionRecords → ID별 최신 updatedAt 비교·transaction → 결과/부분 완료·취소 표시`.
6. **이탈·재시작:** `page-exit stopped snapshot → durable 큐 + background 요청 → startup durable 키 탐색·tombstone 필터 → replay → stale running cleanup → 진단`.

## 3. Audit Coverage & Limitations

### CodeGraph와 확인 범위

CodeGraph MCP `codegraph_explore`를 실제 사용했다. 문서·설정 이외의 코드 탐색에 우선 적용했고, 생략된 테스트 setup·스모크 실행 설정·얇은 E2E alias만 직접 보완했다. 주요 관계:

- `createContentRuntime → bootstrap → bind/start capture`, `handleTopFrameEvent → rollOverRunningSessionSegment`.
- `saveSession/updateRunningSession → writeMutatedSessionRecord → writeSessionRecordUnlocked → tryIndexedDb → withSessionStoresTransaction`.
- `loadSession → IDB hydration + loadFallbackRecord → mergeSessionCollections`와 쓰기 경로의 최신 상태 선택 차이.
- `writeFallbackWithMutator → saveFallbackRecord → saveChromeFallbackRecord → enqueueFallbackMutation`.
- `useHistoryLibrary → listSessionLineagesPage → mergeSessionCollections`, lineage 삭제에서 `deleteSession`으로 내려가는 경로.
- page-exit snapshot·종료 큐·tombstone·startup replay/cleanup.
- History import/backup → parse/import/backup bundle, exporter → Blob/data URL 다운로드.
- 설정 정수·파일명 정규화, background sender·payload 제한, CSV BOM·수식 prefix 방어.

### 실제 실행한 검증

환경: Windows, Node `v26.13.0`. 기존 의존성·Chromium 사용, 추가 설치 없음.

| 명령 / 검증                                                           | 결과                                                                          |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `npm test`                                                            | 77 files / 516 tests passed                                                   |
| `npm run test:coverage`                                               | 동일 516 tests passed, 설정된 coverage 게이트 통과                            |
| `npm run typecheck`                                                   | TS7 통과                                                                      |
| `npm run typecheck:ts6`                                               | TS6 통과                                                                      |
| `npm run lint`                                                        | 통과                                                                          |
| `npm run build`                                                       | injected 생성 및 Vite production build 통과                                   |
| `EXTENSION_E2E_HEADLESS=1` 설정 후 `node scripts/extension-smoke.mjs` | 실제 확장 로드, DOM+iframe 수집, IDB 재조회, 6종 출력, 재시작, JSON 왕복 통과 |
| `npm run check:depsync`                                               | 통과                                                                          |
| `npm run check:version`                                               | 1.0.16 일치                                                                   |
| `npm run check:coverage-calibration`                                  | Node 26 / Vitest 5 기준 통과                                                  |
| 인메모리 Node 재현 harness                                            | ISSUE-001/002/003 재현                                                        |

Coverage: statements **75.66%**, branches **67.59%**, functions **77.29%**, lines **75.77%**. 설정상 포함 파일의 수치이며 `runtime/orchestrator/**`, service worker 조립 파일 등 제외 영역까지 검증한 비율이 아니다. 특히 `session-store/fallback/storage.ts` statements **23.41%**, branches **18.33%**로 장애 저장소 경로의 검증이 얕다.

재현은 설치된 esbuild의 `write:false` 번들을 data URL ESM으로 메모리에서 실행하고 `fake-indexeddb`와 합성 `chrome.storage.local`만 사용했다. ISSUE-002는 같은 번들을 서로 다른 module URL로 로드해 큐·캐시를 분리하고 storage만 공유했다. 두 저장은 서로 다른 session ID여서 실제 Web Locks에서도 같은 잠금을 얻지 않는다. 재현용 테스트 파일을 저장소에 추가하지 않았다.

### 한계·반증으로 제외한 사항

- 실제 국회 생중계·DNS·WebSocket·HTML 개편·영상 플레이어 연동은 접속 검증하지 않았다. 브라우저 스모크는 국회 페이지 응답을 fixture로 바꾼다.
- Windows Chromium만 실행했다. macOS/Linux, Chrome 배포 버전별, 장시간 절전·강제 종료·디스크 고갈은 직접 재현하지 않았다.
- 전체 `npm run verify`, `npm audit`, 전체 format 검사, `check:parity`는 실행하지 않았다. 개별 실행한 항목만 위에 기재했다. 형제 데스크톱 저장소의 계약 검증도 범위 밖이다.
- CodeGraph는 구조·소스의 근거이며 런타임 보증은 아니다. 일부 응답은 잘리거나 질의 관련도가 낮아 정확한 심볼로 재질의했다. graph의 “no tests found”만으로 테스트 부재를 단정하지 않았다.
- 정상 IDB readwrite transaction과 세션 Web Locks가 일반적인 read-modify-write를 보호하므로 단순 메타데이터 동시 편집을 새 버그로 남기지 않았다.
- 종료 큐는 durable 키 전체 탐색·tombstone 필터가 있다. 종전 종료 큐 인덱스 누락을 미해결로 재분류하지 않았다. ISSUE-002는 **세션 폴백 인덱스** 문제다.
- production accessible dialog/Vitest confirm 분기는 의도적이다. 테스트 분기를 production 승인 우회로 분류하지 않았다.
- 호스트 XSS를 전제한 브리지 token/테스트 마커 공격은 SECURITY의 명시적 신뢰 범위 밖이다. 이를 새 Critical 취약점으로 과장하지 않았다.

## 4. High-Risk Issues

수정 우선순위를 위한 검증된 기능 이슈 목록이다. Medium 1건을 포함하며 추정 이슈는 넣지 않았다.

### [ISSUE-001] IndexedDB 복구 후 저장이 폴백의 최신 사용자 편집을 폐기한다

- **위치:** `src/storage/session-store/mutations-internal.ts:207` `writeSessionRecordUnlocked` (230–242, 251–260), `public-api/mutations.ts:189` `updateRunningSession`, `load-session.ts:22`.
- **우선순위:** High
- **신뢰도:** Confirmed
- **문제:** 읽기는 양 저장소에서 최신 record를 고르지만 IDB 쓰기 mutator는 IDB 내부 record만 latest로 받는다. 더 최신 폴백 편집을 병합하지 않고 IDB 저장 성공 후 폴백까지 삭제한다.
- **발생 조건:** IDB 세션 수집 → 일시 장애로 폴백에 캡처 저장 → History에서 해당 record 메모 등 편집 → IDB 복구 → 다음 캡처 저장. 캡처 상태에는 History 메모가 반영되지 않아 저장 계층의 편집 보존에 의존한다.
- **영향:** 최신 메모·태그·발언자 설정·entry 편집이 이전 IDB 상태로 돌아갈 수 있다. 이번에 메모 유실을 직접 확인했다. 모든 필드를 각각 재현한 것은 아니다. 폴백 삭제 때문에 유일한 최신 복사본까지 사라질 수 있다.
- **근거:** 실제 공개 API로 다음 순서를 실행했다: `updateRunningSession(base)` → IDB 비가용 → 새 snapshot 저장 → `updateSessionMetadata(id,{note:'HISTORY_EDIT'})` → IDB 복구 → 더 최신 캡처 snapshot 저장. 저장 전 `loadSession(id).note`는 `HISTORY_EDIT`, 복구 저장 후는 `""`였다.
- **반증 확인:** `mergeCaptureSnapshotWithStoredEdits`는 정상 경로에서 편집을 보존하지만 입력 latest가 오래된 IDB 복사본이라 폴백 편집을 알 수 없다. Web Lock은 순서만 보호하고 양 백엔드를 합치지 않는다. transaction도 IDB만 포함한다. `loadSession`의 최신 병합은 이 쓰기 경로에서 사용되지 않는다.
- **호출/영향 범위:** CodeGraph: `service-worker.handleMessage → updateRunningSession/saveSession → writeMutatedSessionRecord → writeSessionRecordUnlocked → persistResolvedSessionRecord/bestEffortDeleteFallbackRecord`. 자동·수동·최종 저장과 History 편집 보존에 영향.
- **권장 수정 방향:** 동일 세션 잠금 안에서 양 백엔드 최신 상태를 조정하고 IDB transaction의 최신 record와 병합한다. 폴백 삭제는 병합에 사용한 버전 이하인지 확인해야 한다. 반대 방향 IDB→폴백도 같은 보존 정책으로 검증한다.
- **필요한 회귀 테스트:** running IDB → 강제 폴백 → History 메모·entry 수정 → 복구 → 새 entry autosave. 최종 결과는 새 entry와 사용자 편집 모두 보존하고 폴백 정리·재로드 후에도 동일해야 한다.

### [ISSUE-002] 별도 실행 환경의 동시 폴백 저장이 공용 인덱스에서 세션을 누락시킨다

- **위치:** `src/storage/session-store/fallback/storage.ts:141` `enqueueFallbackMutation`, 438 `saveChromeFallbackRecord`, 527 `listFallbackSessionIds`, 580 `listFallbackRecords`; `session-write-queue.ts:35`.
- **우선순위:** High
- **신뢰도:** Confirmed
- **문제:** 본문은 개별 키지만 ID 배열·메타데이터 맵은 공용 키다. 갱신은 get→수정→set이고 fallbackMutationQueue는 해당 실행 환경에만 있다. 각 환경이 오래된 배열·맵을 읽어 덮어쓸 수 있다.
- **발생 조건:** IDB 폴백 중 서비스 워커 캡처 저장과 History의 다른 ID JSON 가져오기 등이 겹친다. 여러 History 문서도 가능하다.
- **영향:** 저장 성공 세션이 목록·검색·전체 백업에서 사라질 수 있다. 본문 키는 남아 알려진 ID로 직접 조회하거나 키 스캔으로 복구할 여지가 있다. 같은 최신 원본이 IDB에 없고 폴백에만 새로 생성된 세션에서 영향이 크다.
- **근거:** 모듈 상태를 분리한 A/B의 공개 `saveSession`을 Promise.all로 실행하고 비동기 storage set을 모사했다. durable `...:record:audit_a`, `...:record:audit_b` 모두 존재했으나 인덱스는 `["audit_b"]`, `listSessions()`도 `["audit_b"]`만 반환했다.
- **반증 확인:** 같은 환경의 폴백 큐는 직렬화한다. 그러나 History와 SW는 모듈 싱글턴을 공유하지 않는다. 상위 Web Locks 키는 sessionId별이라 다른 ID의 공용 인덱스 변경을 막지 않는다. mutator 재조회는 해당 ID 본문 updatedAt만 비교해 인덱스 누락을 감지하지 못한다. 종료 큐 고아 복구는 prefix가 다른 세션 폴백 키를 복구하지 않는다.
- **호출/영향 범위:** CodeGraph: `saveSession/updateRunningSession/importSessionRecords → writeSessionRecordUnlocked → saveFallbackRecord → saveChromeFallbackRecord`. `listFallbackSessionIds/listFallbackRecords/listFallbackMetadataRecords`를 거쳐 History 목록·검색·backup에 확산.
- **권장 수정 방향:** 공용 인덱스·메타데이터 read-modify-write에 공통 cross-context 잠금을 적용하고 저장·삭제·마이그레이션을 같은 정책으로 묶는다. durable per-session 키에서 인덱스를 재구성하는 복구도 제공한다. 잠금 순서는 교착을 피하도록 고정한다.
- **필요한 회귀 테스트:** 독립 모듈/확장 문서에서 다른 ID 저장을 barrier로 동시에 실행한다. 재시작 후 목록·검색·백업에 두 ID가 있어야 한다. 저장/삭제·legacy migration 조합도 durable 키와 인덱스가 일치해야 한다.

### [ISSUE-003] IndexedDB 개별 삭제 실패를 성공으로 반환한다

- **위치:** `src/storage/session-store/public-api/deletions.ts:159` `deleteSession` (167–198); `src/background/service-worker-commands.ts:275`.
- **우선순위:** Medium
- **신뢰도:** Confirmed
- **문제:** IDB 삭제 실패 후 폴백 삭제만 완료되면 정상 resolve한다. IDB 원본이 남았는지 판정하거나 오류를 전파하지 않는다.
- **발생 조건:** IDB에만 저장된 기록 삭제 중 transaction/delete 오류 또는 일시 IDB 비가용. 조회 성공 후 삭제 연산만 실패하는 경우도 포함한다.
- **영향:** 삭제 성공 표시 후 재조회·복구 시 기록이 다시 보인다. lineage의 일부 세그먼트가 남아도 성공으로 끝날 수 있다. 데이터 파괴가 아닌 삭제 상태 불일치이며 재시도 workaround가 있다.
- **근거:** 합성 IDB에 저장 후 `IDBObjectStore.prototype.delete`가 UnknownError를 던지도록 장애 주입했다. 공개 `deleteSession(id)`는 reject하지 않았고 장애 제거 후 `loadSession(id)`가 원본을 반환했다. IDB 비가용 전환 재현도 동일했다.
- **반증 확인:** transaction wrapper는 reject하지만 tryIndexedDb가 결과 객체로 바꾸고 deleteSession의 폴백 분기가 오류를 버린다. tombstone은 종료 큐 부활 방지용으로 일반 load/list에서 원본을 숨기거나 삭제 재시도하지 않는다. background는 resolve를 받아 ok:true를 반환하므로 최상위 catch도 작동하지 않는다. 전체 삭제에는 별도 오류 집계가 있어 같은 문제로 일반화하지 않았다.
- **호출/영향 범위:** CodeGraph: `History deleteSessionLineage → deleteSession → tryIndexedDb → deleteFallbackRecord`, `DELETE_SESSION_RECORD → deleteSession`. 기록 삭제·빈 종료 세션 정리에 영향.
- **권장 수정 방향:** 저장소별 완료·실패를 구분하고 IDB 오류를 전파한다. 불확실한 삭제를 성공으로 표시하지 말고 재시도 상태로 남긴다. 일반 삭제 의도 tombstone을 도입한다면 조회·startup 재시도까지 일관되게 처리한다.
- **필요한 회귀 테스트:** IDB-only 세션의 delete/transaction 장애에서 실패 반환을 확인한다. 장애 해제 후 재시도는 메타데이터·청크·폴백·큐를 정리하고 재시작 후에도 원본이 없어야 한다.

## 5. Potential Functional Gaps

다음은 확정 버그 3건과 구분한 보완 과제다.

- **Confirmed Gap — 실행 환경을 분리한 폴백 회귀 검증:** 기존 concurrency 테스트는 주로 IDB transaction 보호를 확인한다. 단일 모듈 Promise 병렬 실행만으로 공용 폴백 인덱스 경쟁을 충분히 모사하지 못한다. 현 테스트 전체 통과와 ISSUE-002 재현이 공존한다.
- **Confirmed Gap — 25 MiB 초과 전체 백업:** `backup-bundle.ts:48` 누적 크기 검사로 큰 라이브러리의 전체 JSON 백업은 거절된다. README에 명시된 제한이므로 버그가 아니다. 장시간 수집 목적상 분할 백업·다중 파일 복원 또는 구체적인 우회 안내가 유용하다.
- **Likely Gap — 백업 중 동시 변경의 일관성:** `backup-bundle.ts:88` 이후 페이지별 재조회·ID 중복 제거는 있으나 시작 시 ID 집합을 고정하지 않는다. autosave로 정렬이 이동하면 중복 방지만으로 누락 방지를 보장하기 어렵다. 이번에 백업 누락을 재현하지 않아 확정 버그로 올리지 않았다. snapshot 의미와 변경 감지 정책을 검토한다.
- **추정 — 장기 절전·강제 종료 보장 범위:** stop·이탈 큐·startup replay는 존재한다. OS 강제 종료 직전 미저장 구간, memory-only 최후 폴백, failed-stopped guard 이후 탭 소멸의 복구 범위는 장시간 장애 검증이 필요하다. 마지막 자막을 항상 복구할 수 없다는 사실만으로 구현 버그라 단정하지 않는다.

## 6. Documentation Mismatches

1. **Node 버전:** README는 Node.js 24+를 요구하지만 package engines는 >=26.0.0, .nvmrc·CI는 26이다. 현재 coverage 보정 검사도 Node 26 기준으로 통과했다. README를 지원 툴체인과 맞춰야 한다. Node 24에서 빌드가 반드시 실패한다고 재현한 것은 아니다.
2. **과거 툴체인 설명:** vitest.config.ts 주석과 CLAUDE의 2026-10-11 delta는 coverage/CI 기준을 Node 24로 설명하지만 현재 설정은 26이다. 역사 기록과 현재 필수 조건을 구분해야 한다.
3. **편집 보존 범위:** CLAUDE의 data preservation delta는 autosave의 History 편집 보존을 설명한다. 동일 백엔드 보호는 있으나 ISSUE-001의 저장소 전환까지 보장하지 못한다. 수정과 함께 복구 범위를 명시해야 한다.

JSON 25 MiB 제한, CSV BOM, 실험적 side panel, verify:e2e의 전체 스모크 alias 설명은 구현과 맞는다. 과거 종료 큐 keyed-read 설명은 후속 전체 스캔 delta가 있어 과거 문장만 독립 버그로 세지 않았다.

## 7. Recommended Fix Plan

### Phase 1 — Immediate

1. **ISSUE-001:** 양 저장소 최신 record 조정·편집 보존을 구현한다. IDB 정상/IDB→폴백/폴백→IDB를 같은 회귀 시나리오로 검증하고 최신 폴백 복사본의 무조건 삭제를 피한다.
2. **ISSUE-002:** 공용 폴백 인덱스·메타데이터 직렬화와 durable 키 복구를 추가한다. 저장·삭제·마이그레이션의 잠금 순서를 고정한다.
3. 새 포맷 도입보다 기존 데이터·편집 보존을 우선한다. 이미 누락된 키 복구 시 기존 원본을 파괴하지 않는다.

### Phase 2 — Stability

1. **ISSUE-003:** 개별 삭제의 실패 전파·부분 완료 표시·재시도를 구현한다.
2. IDB open/transaction, storage.local get/set/remove 실패와 quota·중단·재시작을 결합한다. 응답·revision·큐 정리 순서까지 검증한다.
3. 전체 백업의 동시 변경 정책과 한도 초과 시 분할 또는 우회 안내를 정한다.
4. Node 문서를 현재 설정에 맞추고 OS별 파일명·인코딩·타임존을 검증한다.

### Phase 3 — Structural

1. IDB·폴백·메모리 사이 최신 상태 결정·성공/실패 정책을 명시한다. 취향상 파일 재배치가 목적은 아니다.
2. 테스트 어댑터가 독립 모듈 메모리와 공유 storage를 구분하도록 구성하고 실제 Chromium의 History 두 문서+SW로 대조한다.
3. coverage 제외 runtime 조립 경로는 E2E의 분할·종료·장애 조건으로 검증한다. 수치만 높이기 위해 coverage 제외 설정을 바꾸지 않는다.

## 8. Test Recommendations

| 유형                     | 입력·조건                                                                      | 기대 결과                                                                |
| ------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Unit / Regression · 001  | IDB note=A, 더 최신 폴백 note=B, 캡처 snapshot note 빈 값                      | note=B·새 entry 동시 보존, 폴백 정리 후에도 동일                         |
| Integration · 001        | 정상→장애→폴백 History text/note/labels/speaker 편집→IDB 복구                  | originalText·편집·새 자막 모두 유지, 재조회·export 결과 일치             |
| Concurrency · 002        | 독립 A/B 환경, 다른 ID, 인덱스를 동시에 읽도록 barrier                         | 두 성공 ID 모두 durable 본문·인덱스·메타·검색·백업에 존재                |
| Concurrency · 002        | 한 환경 저장, 다른 환경 다른 ID 삭제/legacy migration                          | 살아야 할 세션 누락 없음, 삭제 상태 일치, 재시작 후 동일                 |
| Integration · 003        | IDB-only record delete/transaction UnknownError·abort                          | 성공 메시지 금지, 오류·재시도 표시; 재시도 후 청크·폴백·큐 제거          |
| End-to-End               | fixture→미확정/확정/동일 행 보정→저장→History 편집→autosave→6종 출력→JSON 복원 | 미확정·로딩 제외, 중복 보정 없음, 편집·포맷별 데이터 보존                |
| End-to-End / Concurrency | Chromium History 두 문서+SW, IDB 실패 중 다른 ID 저장                          | 모든 성공 세션 발견 가능, SW 재시작 후에도 동일                          |
| Regression · 분할/종료   | 분할 저장 지연 중 여러 새 행·reset, 곧바로 stop                                | 확정 이벤트 정확히 한 번 반영; 최종 저장·export 누락·중복 없음           |
| Integration · 복구       | 큐 인덱스 누락, durable 키 존재, 오래된/새로운 tombstone                       | 유효 최신 snapshot만 replay, 삭제 기록 부활 없음, 실패 재시도 가능       |
| Integration · import     | 25 MiB 경계·잘린 JSON·잘못된 URL/날짜·중복 ID·읽기/쓰기 abort                  | 거부·정규화·최신 정책 일치, 부분 완료·취소 결과 정확                     |
| Concurrency · backup     | 작은 pageSize, 페이지 사이 새 기록 추가·updatedAt 변경                         | 정한 snapshot 기준 ID가 정확히 한 번 포함되거나 변경 감지 경고           |
| Platform-specific        | Windows 금지 문자·경로 구분자, 한글+이모지, CRLF/LF, UTC/KST·자정              | 유효 basename, CSV BOM·수식 방어, surrogate 보존, SRT/VTT 상대 시간 일관 |
| Runtime / Failure        | offscreen 실패·다운로드 중단·SW 재시작, 작은/2 MiB 초과 export                 | 제한된 data URL 폴백, 큰 파일 명확한 오류, URL 정리·다른 다운로드 보호   |

기존 성공 스모크는 유지하면서 실패 조건을 추가한다. 이 표는 권고이며 모든 제안을 이번에 실행했다는 뜻은 아니다. 실제 실행은 §3에 한정한다.

## 9. Final Assessment

| 항목                      | 평가       | 근거                                                                                    |
| ------------------------- | ---------- | --------------------------------------------------------------------------------------- |
| Functional Correctness    | Needs Work | 기본 흐름은 통과했지만 복구 저장·삭제 결과에 확정 오류가 있다.                          |
| Runtime Stability         | Acceptable | observer/polling·예외 처리·저장 가드·기본 스모크가 있다. 장시간 강제 종료는 미검증이다. |
| Data Integrity            | High Risk  | 장애·복구 시 편집 유실과 세션 발견 누락을 재현했다.                                     |
| Error Resilience          | Needs Work | 폴백은 있으나 백엔드 조정·삭제 오류 전파가 불완전하다.                                  |
| Cross-platform Robustness | Acceptable | 브라우저 API 중심·파일명/인코딩 보호가 있다. 실제 실행은 Windows Chromium에 한정된다.   |
| Test Confidence           | Needs Work | 516 tests·coverage·E2E 성공에도 폴백과 독립 실행 환경의 장애 검증이 부족하다.           |

**실제로 먼저 수정할 문제 3개:**

1. **ISSUE-001:** IDB 복구 저장에서 폴백 최신 사용자 편집을 병합·보존한다.
2. **ISSUE-002:** 폴백 공용 인덱스를 실행 환경 간 직렬화하고 durable 키에서 복구한다.
3. **ISSUE-003:** IDB 삭제 실패를 성공으로 알리지 않고 오류·재시도를 제공한다.
