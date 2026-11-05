# Project Audit — Round 2

감사·수정일: 2026-11-05 (Asia/Seoul). 수정 전 기준: `main` / `a20527a`, 제품 1.0.16.

설정, Options, 다운로드 수명 관리, 캡처 브리지·프레임 전달, popup 재연결을 추가 감사했다. 최초 [감사](PROJECT_AUDIT.md)와 [저장소 개선 기록](AUDIT_REMEDIATION.md)은 당시 증거로 보존한다. 아래 다섯 이슈는 **수정 전 결함**이며 이번 변경에서 모두 수정했다. 실제 사용자 프로필·production 데이터·새 의존성을 사용하지 않았다. Spec Kit·claude-mem 스킬은 사용하지 않았다.

## 1. Executive Summary

추가 범위의 수정 전 상태는 **Needs Work / Medium**, 수정 후는 **Acceptable**이다. 새 Critical·High 결함이나 자막 DB 손상·삭제 경로는 확인하지 못했다. 확인한 문제는 설정값의 논리적 유실·잘못된 적용과 export Blob의 정리 누락이다.

| 이슈   | 우선순위 | 신뢰도    | 문제                                       | 현재 상태                    |
| ------ | -------- | --------- | ------------------------------------------ | ---------------------------- |
| R2-001 | Medium   | Confirmed | 실행 환경별 설정 변경 덮어쓰기             | 공용 잠금·SW 위임 적용       |
| R2-002 | Medium   | Confirmed | 오래 열린 Options의 전체 snapshot 덮어쓰기 | 변경 필드만 저장             |
| R2-003 | Medium   | Confirmed | 실패한 설정 저장이 메모리에 남음           | durable 성공 후 확정         |
| R2-004 | Medium   | Confirmed | 기본값이 구버전 alias·custom 임계값을 가림 | 원본 정규화 적용             |
| R2-005 | Medium   | Confirmed | SW 재시작·빠른 완료 시 Blob 정리 누락      | 지연 복원·직렬화·상태 재조회 |

가장 먼저 고칠 영역은 설정 쓰기의 실행 환경 간 일관성과 Options 저장 범위였다. 자막 원문이 직접 파괴되는 경로는 이번 추가 결함에서 확인되지 않았다. 누적 Blob 메모리의 실제 크기는 측정하지 않았으므로 광범위 장애로 확대하지 않았다.

## 2. Project Understanding

README·CLAUDE·AGENTS·package/manifest/빌드 설정과 CodeGraph를 확인했다. 프로젝트는 국회 의사중계 AI 자막을 로컬에서 수집·저장·편집하고 TXT/SRT/VTT/JSON/MD/CSV로 내보내는 Manifest V3 Chrome 확장이다.

주요 entrypoint는 `src/content/content-script.ts`, `src/background/service-worker.ts`, `src/offscreen/main.ts`, Options/History/popup/sidepanel의 React 진입점이다. 자막 기록은 IndexedDB와 Chrome storage 폴백, 설정·다운로드 매핑은 `chrome.storage.local`에 저장한다. 외부 자막 DOM, Chrome extension API, React/Vite가 주요 의존성이다. 이 범위에 서버 DB·SQL migration·외부 API 클라이언트는 없다.

- `Options 입력 → 숫자·파일명 검증 → handleSave(변경 필드) → saveSettings → extension origin Web Lock → 최신 설정 병합·정규화 → chrome.storage.local → 결과/오류 UI`
- `페이지 패널 설정 → saveSettings → UPDATE_SETTINGS → own-extension sender 확인 → SW saveSettings → 동일 Web Lock → storage → 설정 응답`
- `기록/백업 → export payload → DOWNLOAD_* → SW → Offscreen Blob URL → chrome.downloads → 매핑 저장 → 완료/중단 → 매핑 복원·revoke·저장`
- `DOM/iframe → observer bridge/폴링 → 토큰·nonce 확인 → top frame pipeline → 세션 저장 → History 재조회·출력`
- `popup → 활성 탭 → ENSURE_CONTENT_SCRIPT → content port → 상태/명령 → 연결 해제 시 재연결`

## 3. Audit Coverage & Limitations

CodeGraph를 먼저 사용해 설정 공개 함수, Options `handleSave`, write queue, background command dispatch, Blob export/Offscreen, observer bridge, polling, frame/capture event, popup 연결의 source·caller/callee·영향 범위를 추적했다. 그래프가 생략한 세부 코드와 문서·설정·fixture만 직접 열람했다. cross-file 매칭과 동적 연결은 최선의 추정이므로 타입 검사와 실행 검증으로 보완했다. 새 tracker도 추가 후 CodeGraph로 확인했다.

실행 결과:

- 새 회귀 테스트에서 설정 동시 변경·메모리 확정·migration·content 위임·Options payload·다운로드 두 정리 경로의 **수정 전 실패**를 확인했다. 초기 다운로드 mock의 누락 API를 보완한 뒤에도 대상 실패가 남는 것을 확인했다.
- `npm run verify` **통과**: depsync/version, injected 생성·검증, coverage calibration, 형제 저장소 parity, format/lint, TS7, 전체 coverage 테스트, TS6, production dependency audit, production build.
- **82 files / 539 tests passed**. coverage: statements **78.12%**, branches **69.63%**, functions **79.79%**, lines **78.24%**. 기존 게이트·제외 범위를 완화하지 않았다.
- production dependency audit **0 vulnerabilities**. 의존성 설치·lockfile 변경 없음.
- `npm run verify:e2e` **통과**. wrapper가 실행하는 확장 스모크까지 확인했다.
- 최신 build로 `EXTENSION_E2E_HEADLESS=1; node scripts/extension-smoke.mjs` **통과**: DOM+iframe 수집 → IndexedDB 재조회 → 6종 출력 → 재시작 → JSON/전체 library roundtrip → SW/History 동시 폴백 → Options/popup/sidepanel 렌더링.
- 추가 실제 Chromium 검증: 임시 프로필의 로컬 테스트 다운로드 정지 → Blob 매핑 저장 → CDP SW 중단 → `UPDATE_SETTINGS`로 재기동 → Blob 내용 읽기 성공 → 다운로드 취소 → Blob 읽기 실패·매핑 제거. 테스트 HTTP 서버·프로필·다운로드는 종료 시 정리한다.

미확인 환경: 실제 생중계의 장시간 동작·네트워크 장애, macOS/Linux, OS 강제 종료, 장시간 메모리 사용량, Web Store 배포. Windows synthetic DOM fixture·임시 Chromium 프로필에서 실행했다. content script의 origin 위임은 모듈 테스트로 확인했으며 실제 패널과 Options의 동시 클릭까지 새로 재현한 것은 아니다.

## 4. High-Risk Issues

새 Critical·High 항목은 없다. 아래는 반증되지 않은 Medium 결함 및 완료된 수정 기록이다.

### [R2-001] 실행 환경별 설정 read-modify-write가 서로 덮어써진다

- **위치:** `src/storage/settings-store.ts` / `saveSettings`, `src/storage/session-write-queue.ts`.
- **우선순위:** Medium. **신뢰도:** Confirmed.
- **문제:** 기존 Promise queue는 한 모듈의 메모리에만 존재한다. 두 문서가 같은 이전 설정을 읽고 서로 다른 필드를 바꿔 전체 객체를 저장하면 한쪽 변경이 사라진다.
- **발생 조건:** A가 autoScroll, B가 autosave를 거의 동시에 변경한다.
- **영향:** 설정이 되돌아가 수집·출력 동작이 사용자 의도와 달라진다.
- **근거:** 독립 모듈 A/B의 동시 부분 변경 테스트가 수정 전 실패했다.
- **반증 확인:** storage.set 한 번은 get+set 전체의 transaction이 아니다. 모듈 queue는 공유되지 않는다. 페이지 origin의 Web Lock도 extension origin Options와 같지 않다.
- **호출/영향 범위:** CodeGraph `panel-host/Options.handleSave/reset → saveSettings`; 소비자인 capture lifecycle·History·popup.
- **권장 수정 방향 / 반영:** `assembly-settings-write` 잠금 안에서 최신 값을 읽고 병합한다. content script는 own-extension sender를 확인하는 `UPDATE_SETTINGS`로 SW에 위임한다. reset도 같은 경로를 쓴다.
- **필요한 회귀 테스트:** A/B의 독립 필드 모두 보존, page-origin 저장 시 runtime 위임만 호출, save 뒤 reset은 기본값. 추가·통과했다.

### [R2-002] 오래 열린 Options가 수정하지 않은 최신 설정을 되돌린다

- **위치:** `src/options/app/App.tsx` / `handleSave`.
- **우선순위:** Medium. **신뢰도:** Confirmed.
- **문제:** 로드한 전체 settings 객체를 저장해 편집하지 않은 필드까지 다시 쓴다.
- **발생 조건:** Options를 연 뒤 다른 곳에서 설정을 바꾸고 첫 문서에서 다른 필드를 저장한다. 동시 실행이 없어도 발생한다.
- **영향:** 다른 곳에서 저장한 최신 설정이 과거 값으로 돌아간다.
- **근거:** autosave 간격만 편집했을 때 해당 필드 하나만 전달해야 한다는 UI 회귀 테스트가 수정 전 실패했다.
- **반증 확인:** write 잠금만으로 해결되지 않는다. 오래된 전체 payload도 명시적 변경으로 처리되기 때문이다. 입력 검증은 최신 필드 보존을 검사하지 않았다.
- **호출/영향 범위:** CodeGraph `Options.handleSave → saveSettings → storage`; 설정 소비 모듈 전체.
- **권장 수정 방향 / 반영:** `savedSettings`와 draft를 비교해 변경 필드만 저장한다. 같은 필드를 양쪽에서 바꾸면 나중 저장이 이기는 기존 정책을 유지한다.
- **필요한 회귀 테스트:** 간격 1200만 편집하면 payload는 `{runningAutoSaveDebounceMs:1200}`이어야 한다. 추가·통과했다.

### [R2-003] 실패한 설정 저장이 메모리에 반영된다

- **위치:** `src/storage/settings-store.ts` / `saveSettings`, `resetSettings`.
- **우선순위:** Medium. **신뢰도:** Confirmed.
- **문제:** durable set 전에 `memorySettings`를 바꾼다.
- **발생 조건:** storage set이 실패한 뒤 storage API가 없는 환경에서 같은 모듈의 fallback을 읽는다.
- **영향:** 실패로 표시한 설정과 메모리 값이 다르고 재로드 시 durable 값으로 되돌아간다. 영향은 해당 실행 환경에 한정된다.
- **근거:** autoScroll=true 저장 후 false 쓰기를 실패시키고 storage API를 제거하면 수정 전 false를 반환했다.
- **반증 확인:** UI의 예외 표시는 이미 바뀐 모듈 메모리를 rollback하지 않는다. durable 원본은 남으므로 자막 DB 손상으로 분류하지 않았다.
- **호출/영향 범위:** CodeGraph `Options/panel/reset → saveSettings → getSettings(memory fallback)`.
- **권장 수정 방향 / 반영:** durable 성공 후 메모리 확정. reset도 동일 저장 함수 사용.
- **필요한 회귀 테스트:** 실패 후 fallback은 마지막 성공값 true를 반환해야 한다. 추가·통과했다.

### [R2-004] 설정 기본값이 구버전 migration을 가린다

- **위치:** `src/storage/settings-store.ts` / `getSettings`, `sanitizeSettings`, `resolveSegmentPreset`.
- **우선순위:** Medium. **신뢰도:** Confirmed.
- **문제:** raw object 앞에 canonical 기본값을 합친 뒤 정규화해 legacy alias·preset 추론이 실행되지 않는다.
- **발생 조건:** alias와 preset 도입 전 custom 분할 임계값이 남은 업그레이드 사용자.
- **영향:** 화자 출력·중복 필터·분할 동작이 이전 설정과 달라진다.
- **근거:** `{exportSpeakerEnabled:true, noiseMinLength:15, maxEntriesPerSegment:3456}`가 실제 getSettings에서 수정 전 false/8/balanced/2000, 수정 후 true/15/custom/3456이 된다.
- **반증 확인:** sanitizer 자체는 alias를 지원하지만 상위 loader가 canonical 필드를 미리 채워 무력화한다. 실제 production 설정 로딩 경로다.
- **호출/영향 범위:** CodeGraph `getSettings → sanitizeSettings → resolveSegmentPreset/resolveSegmentThresholds`; Options·캡처·History 출력.
- **권장 수정 방향 / 반영:** 원본 설정을 정규화하고 누락 기본값은 sanitizer에서 공급한다. schema나 사용자 storage를 강제로 다시 쓰지 않는다.
- **필요한 회귀 테스트:** 구버전 storage fixture를 공개 getSettings로 읽어 alias·custom 값을 확인한다. 추가·통과했다.

### [R2-005] SW 재시작·완료 순서 경합으로 다운로드 Blob이 남는다

- **위치:** `src/background/service-worker.ts`, `src/background/blob-download-tracker.ts`, `src/offscreen/main.ts`.
- **우선순위:** Medium. **신뢰도:** Confirmed.
- **문제:** startup/install 때만 매핑을 복원하고, 이전 SW 세대의 Offscreen URL은 무효라고 가정해 revoke를 건너뛴다. 완료 이벤트가 download callback보다 빠르면 빈 map을 보고 지나간다.
- **발생 조건:** 진행 중 SW 중단·재기동 또는 작은 다운로드의 빠른 완료.
- **영향:** Offscreen Blob 메모리·stale 매핑 누적. 성공한 파일 내용의 손상은 확인하지 못했다.
- **근거:** actual service-worker 모듈을 Chrome mock으로 로드한 두 회귀 테스트가 수정 전 실패했다. 실제 Chromium에서도 SW 중단 뒤 Blob 유지, 취소 뒤 해제를 확인했다.
- **반증 확인:** 다운로드 완료가 URL 소유권 해제를 대신하지 않는다. SW 재기동은 browser startup과 다르다. Offscreen 수명은 SW와 독립적이므로 세대 검사는 보호 장치가 아니다. [Chrome 공식 설명](https://developer.chrome.com/blog/Offscreen-Documents-in-Manifest-v3), [Offscreen API 수명](https://developer.chrome.com/docs/extensions/reference/api/offscreen).
- **호출/영향 범위:** CodeGraph `DOWNLOAD_REQUEST/SESSION_EXPORT/LINEAGE_EXPORT → downloadExportWithFallback → track`, `downloads.onChanged → complete → Offscreen revoke`; 6종 export·JSON 백업.
- **권장 수정 방향 / 반영:** lazy restore·직렬 queue를 가진 tracker 사용. 이전 SW URL도 revoke하고 등록 후 downloads.search로 이미 끝난 항목을 정리한다. 비동기 정리 오류를 catch해 기록한다.
- **필요한 회귀 테스트:** 새 SW의 persisted 매핑 정리, callback 전 완료, 실제 SW 중단 뒤 취소·URL 해제. 추가·통과했다.

## 5. Potential Functional Gaps

- **Confirmed Gap:** Options의 외부 변경 실시간 반영·같은 필드 충돌 안내는 없다. 독립 필드 보존은 수정했으며 같은 필드의 나중 저장 우선은 제품 정책이다.
- **Confirmed Gap:** Web Locks가 없으면 모듈 queue의 실행 환경 간 원자성은 보장되지 않는다. 현재 Chrome 검증 경로와 혼동하지 않는다.
- **추정:** 장시간 export/취소의 메모리 예산 계측이 유용할 수 있다. 이번에는 URL 해제만 검증했으며 실측하지 않은 잔여 메모리 누수를 주장하지 않는다.
- **Likely Gap:** 실제 방송 DOM 변경·네트워크 재연결·확장 업데이트를 섞은 장시간 테스트는 fixture를 보완할 수 있다. 현재 버그를 재현한 것은 아니다.

반증 후 제외한 후보: observer 주입 실패만으로 영구 수집 중단을 단정하지 않았다. 로컬 polling·top fallback·활성화 재시도와 nonce 재동기화·capture page guard가 존재한다. popup의 활성 상태 guard·연결 직렬화·지연 재시도도 확인했으며 단순 비동기 구조만 보고 race로 확정하지 않았다. 토큰은 같은 페이지 자체를 적대적 보안 경계로 격리하는 수단으로 확대 해석하지 않는다.

## 6. Documentation Mismatches

수정 전 SW 주석의 ‘이전 세대 URL은 사라진 Offscreen 문서 소유’ 설명이 Chrome 수명 규칙과 달랐다. 해당 가정과 세대 집합을 제거했다. README의 6종 출력·로컬 저장·폴링 fallback 설명은 확인 경로와 일치했다. 새로운 README 수준의 기능 불일치는 확인하지 못했다. CLAUDE의 현재 운영 기준에 설정 잠금·위임·migration·Blob 수명 규칙을 추가했다.

## 7. Recommended Fix Plan

### Phase 1 — Immediate

**완료:** R2-001·002 설정 덮어쓰기 방지. 공용 잠금과 변경 필드 저장은 함께 필요하다.

### Phase 2 — Stability

**완료:** R2-003 메모리 확정 순서, R2-004 migration, R2-005 복원·완료 경합 정리와 실제 Chromium 재시작 검증.

### Phase 3 — Structural

**완료:** Blob tracker 분리, 설정·다운로드 회귀 테스트, 운영 문서 보완. **후속 권고:** 같은 필드 충돌 정책, 실제 방송·export 장시간 자원 예산, 다른 OS 검증. 기능 향상 권고를 미수정 버그로 분류하지 않는다.

## 8. Test Recommendations

| 구분               | 입력·조건                                         | 기대 결과                                     | 이번 상태                          |
| ------------------ | ------------------------------------------------- | --------------------------------------------- | ---------------------------------- |
| Unit / Migration   | legacy alias + preset 없는 3456 임계값            | true/15/custom/3456 보존                      | 추가·통과                          |
| Concurrency        | 독립 모듈 A/B가 다른 설정 동시 저장               | 두 변경 모두 durable 저장                     | 추가·통과                          |
| Regression         | save 후 reset                                     | 최종 기본값                                   | 추가·통과                          |
| Fault injection    | storage.set 실패 후 memory fallback               | 마지막 성공 설정 유지                         | 추가·통과                          |
| Integration        | supported page origin에서 설정 저장               | runtime 위임, local.set 직접 호출 없음        | 추가·통과                          |
| UI regression      | Options에서 간격 1200만 편집                      | 해당 필드만 저장                              | 추가·통과                          |
| Download ordering  | callback 전 완료 이벤트                           | Blob revoke·매핑 비움                         | 추가·통과                          |
| Restart regression | 새 SW에 이전 매핑·완료 이벤트                     | 저장 URL revoke·매핑 제거                     | 추가·통과                          |
| End-to-End         | 다운로드 정지 → 실제 SW 중단 → 재기동 → 취소      | 중단 후 Blob 유효, 취소 후 해제               | 추가·통과                          |
| End-to-End         | DOM+iframe → 저장 → 재조회 → 6종 출력 → JSON 복원 | 한글·순서·편집값 보존                         | 기존 경로 재실행·통과              |
| Platform-specific  | 각 OS에서 재시작·UTF-8 출력                       | 정상 취소·복원, 같은 자막 내용                | Windows만 실행; macOS/Linux 미실행 |
| Long-running       | 실제 방송에서 DOM 교체·가시성·연결 중단 반복      | 재연결·진단, 중복 저장 없음, 안정적 자원 사용 | 미실행                             |

## 9. Final Assessment

이번 추가 범위의 수정 후 평가다. 실제 방송 운영 전체의 인증을 뜻하지 않는다.

| 항목                      | 평가       | 근거                                                             |
| ------------------------- | ---------- | ---------------------------------------------------------------- |
| Functional Correctness    | Acceptable | 확인한 설정·migration 수정, 수집/출력 fixture E2E 통과           |
| Runtime Stability         | Acceptable | 실제 SW 재시작·다운로드 정리 통과; 장시간 부하 미측정            |
| Data Integrity            | Acceptable | 독립 설정 보존, 새 자막 DB 손상 경로 미확인                      |
| Error Resilience          | Acceptable | 저장 실패 후 메모리 일관성, 정리 오류 catch; OS 강제 종료 미검증 |
| Cross-platform Robustness | Needs Work | 이번 실제 실행은 Windows Chromium 한정                           |
| Test Confidence           | Acceptable | 전체 539 tests·실제 확장 E2E 통과; 실 방송·다른 OS 한계          |

실제로 먼저 수정할 세 영역은 **설정 직렬화(R2-001), Options 부분 저장(R2-002), 다운로드 수명 복구(R2-005)**였다. 세 영역과 나머지 두 결함을 모두 수정·검증했다. 남은 우선 검증은 실제 방송 장시간 운전, 다른 OS, 같은 필드 충돌 정책이다.
