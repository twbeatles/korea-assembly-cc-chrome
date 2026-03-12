# 기능 구현 리스크 점검 리포트 (2026-03-12)

## 점검 범위

- 참조 문서: `CLAUDE.md`, `README.md`
- 코드 점검: `src/`, `tests/`
- 검증 실행: `npm run verify` (lint/typecheck/test:coverage/build 통과)

## 요약

- 현재 기능은 전반적으로 동작하며 빌드/테스트 파이프라인도 통과했습니다.
- 다만, 문서에서 강조한 저장 일관성/회귀 방지 관점에서 실제 운영 리스크가 될 수 있는 지점이 확인됐습니다.
- 특히 `history` 비동기 예외 처리, startup 정리 로직의 실패 가시성, 가져오기 스키마 검증 강도가 우선 보강 대상입니다.

## 주요 발견사항 (심각도 순)

### 1. [High] `history` 일부 액션에서 비동기 예외가 사용자 메시지로 처리되지 않음

- 근거 코드:
  - `src/history/App.tsx:326`
  - `src/history/App.tsx:334`
  - `src/history/App.tsx:546`
  - `src/history/App.tsx:653`
  - `src/history/App.tsx:664`
- 설명:
  - `handleExport`, `handleReopen` 내부에 `try/catch`가 없어 `sendRuntimeMessage`, `createTab` 실패 시 `Unhandled Promise Rejection`으로 빠질 수 있습니다.
  - 버튼 핸들러도 `void handleExport(...)` 형태라 reject가 UI 메시지로 연결되지 않습니다.
- 영향:
  - 다운로드 실패/탭 열기 실패 시 사용자에게 실패 사유가 일관되게 노출되지 않을 수 있습니다.
- 권장 보완:
  - `handleExport`, `handleReopen`을 `try/catch`로 감싸고 `setMessage(...)`로 오류를 통일 표준화.

### 2. [High] startup running-session 정리에서 IndexedDB 실패가 숨겨질 수 있음

- 근거 코드:
  - `src/storage/session-store.ts:794`
  - `src/storage/session-store.ts:805`
- 설명:
  - `closeRunningSessionsOnStartup()`는 IndexedDB 갱신을 `tryIndexedDb(...)`로 감싼 뒤 결과 실패를 강하게 처리하지 않고 진행합니다.
  - 함수는 마지막에 `uniqueRunningIds.size`를 반환하므로, 실제로 일부 running이 닫히지 않아도 닫힌 것처럼 집계될 수 있습니다.
- 영향:
  - 문서의 "cold start 시 running 세션 자동 정리" 의미론과 실제 결과 사이 괴리가 생길 수 있습니다.
- 권장 보완:
  - IndexedDB write 실패 시 경고를 명시적으로 반환하거나, 실패 카운트 분리(`closedCount`, `failedCount`)로 결과를 노출.

### 3. [Medium] JSON 가져오기 스키마 검증이 느슨하고 unknown 필드가 그대로 저장될 수 있음

- 근거 코드:
  - `src/storage/session-backup.ts:43`
  - `src/storage/session-backup.ts:96`
  - `src/storage/session-backup.ts:104`
  - `src/storage/session-store.ts:167`
  - `src/storage/session-store.ts:727`
- 설명:
  - `isStoredSessionRecordLike`는 최소 필드만 검사합니다.
  - `normalizeSessionRecord`가 `...session`으로 객체를 펼치므로, 예상하지 않은 추가 필드가 그대로 저장 페이로드에 포함될 수 있습니다.
  - backup `version`도 문자열 여부만 확인하고 호환성 정책을 강제하지 않습니다.
- 영향:
  - 대용량/이상 필드 유입 시 저장 용량 압박, 예측 불가 데이터 오염 가능성이 커집니다.
- 권장 보완:
  - import 시 허용 키 화이트리스트 기반 재구성.
  - backup version 호환 정책(허용 버전 집합/거절 메시지) 명시.

### 4. [Medium] 페이지 이탈 시 저장은 best-effort이며 전달 보장 계층이 없음

- 근거 코드:
  - `src/content/content-script.ts:556`
  - `src/content/content-script.ts:635`
  - `src/content/content-script.ts:1454`
  - `src/content/content-script.ts:1463`
- 설명:
  - `pagehide`/`beforeunload`에서 background 저장을 시도하지만, 탭 종료 타이밍/worker 상태에 따라 응답이 안정적으로 보장되지는 않습니다.
  - 재시도는 함수 내부 1회 즉시 재호출 수준이며, durable queue가 없습니다.
- 영향:
  - 간헐적인 종료 시점 데이터 유실 가능성이 남아 있습니다.
- 권장 보완:
  - 종료 직전 저장 실패 이벤트를 로컬 큐(예: `chrome.storage.local`)에 남기고 startup 시 재처리.

### 5. [Medium] 브리지 메시지의 보안 경계가 nonce/token 의존 중심이고 origin 검증이 약함

- 근거 코드:
  - `src/content/content-script.ts:741`
  - `src/content/content-script.ts:1499`
  - `src/content/injected-observer.ts:306`
- 설명:
  - `postMessage(..., "*")` 기반 브리지이며, top-frame 수신부도 nonce/token 중심 검증입니다.
  - 호스트 페이지 스크립트/XSS 상황에서는 이벤트 위조 시도면이 넓어질 수 있습니다.
- 영향:
  - 정상 환경에서는 문제 가능성이 낮지만, 보안 하드닝 관점에서 리스크가 남습니다.
- 권장 보완:
  - 가능한 범위에서 `origin`/`source` 검증 강화, token 갱신 주기 축소, 설정 이벤트 노출 최소화.

### 6. [Medium] 핵심 런타임 파일 테스트 공백이 큼

- 근거:
  - `npm run test:coverage` 결과상 주요 파일이 0% 또는 매우 낮은 커버리지
  - 예: `src/content/content-script.ts`, `src/background/service-worker.ts`, `src/history/App.tsx`, `src/options/App.tsx`, `src/popup/App.tsx`, `src/offscreen/main.ts`
- 설명:
  - 현재 테스트는 core/pure 모듈 중심으로는 좋지만 UI/메시지/런타임 연결부는 회귀 방어가 약합니다.
- 영향:
  - 기능 추가 시 기존 동작 붕괴를 사전에 잡기 어렵습니다.
- 권장 보완:
  - 최소한 `history` 액션 실패 처리, popup/options 재연결, background 명령 라우팅에 대한 통합 테스트 보강.

### 7. [Low] 옵션 숫자 입력은 저장 전까지 비정상 값(빈값/NaN)에 머물 수 있음

- 근거 코드:
  - `src/options/App.tsx:492`
  - `src/options/App.tsx:550`
- 설명:
  - 입력 중 빈 문자열이 `Number("") => 0`으로 반영되고, 실제 정상화는 저장 시점 `sanitizeSettings`에 의존합니다.
- 영향:
  - 즉시 피드백 관점에서 사용자 혼란이 생길 수 있습니다.
- 권장 보완:
  - 입력 단계에서 min clamp 또는 invalid state 메시지 표시.

## 추가 필요 항목 (실행 우선순위)

### P0 (즉시)

- `history` export/reopen 액션 `try/catch` + 오류 메시지 표준화
- startup running-session 정리 결과를 성공/실패로 분리 반환
- 페이지 이탈 저장 실패 durable 재시도(큐 + startup replay)

### P1 (단기)

- JSON import 화이트리스트 검증 + backup version 호환 정책
- 브리지 보안 검증(가능 범위의 origin/source 강화)
- `content-script`/`service-worker`/`history App` 테스트 추가

### P2 (중기)

- local polling miss case 재현 기반으로 휴리스틱 확장
- 대용량 import 시 chunk 처리/사용자 피드백(진행 상태) 보강

## 참고

- 이번 점검은 "현재 구현이 바로 실패하는지"보다 "운영 중 간헐 장애/회귀를 만들 수 있는 부분"을 우선 식별했습니다.
- 특히 저장 경로와 메시지 경로는 정상 경로에서는 안정적으로 보여도, 실패 경로 관리를 강화해야 문서의 신뢰성 목표와 맞습니다.

## 2026-03-12 Status Update

- This document remains a risk review, not a closure checklist.
- Functional-review closure was completed on 2026-03-12 except for the intentionally excluded `1-3` foreign-language/CJK item.
- The following risks should still be treated as open unless separately closed:
  - history action error-surfacing consistency
  - startup running-session cleanup result reporting
  - strict JSON import schema validation
  - page-exit persistence durability
  - bridge origin/security hardening beyond nonce/token
  - broader runtime UI/integration test coverage
  - transient invalid numeric input UX in options
- Risk-reducing changes now present in code:
  - transaction handler ordering hardening
  - fallback mutation serialization
  - partial import failure accounting via `failedCount`
  - cursor-based IndexedDB listing with starred index backfill
  - persisted Blob URL cleanup tracking
  - popup/history/options feedback improvements
- Latest verification completed on 2026-03-12:
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test`
  - `npm run build`
