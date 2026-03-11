# 추가 기능 구현 점검 리포트 (2026-03-11, Addendum)

## 점검 기준
- 참조 문서: `CLAUDE.md`, `README.md`
- 점검 관점: 보안/무결성, 성능/안정성, 운영 품질
- 검증 상태: `npm run verify` 통과 (lint/typecheck/test:coverage/build)

## 추가 발견 이슈 (기존 리포트 이후)

| 우선순위 | 이슈 | 근거 | 영향 | 권장 조치 |
|---|---|---|---|---|
| 높음 | page world 메시지 스푸핑 가능성 | `src/content/content-script.ts:1276-1287` (`event.source === window` + `source` 문자열만 확인) | 페이지 스크립트가 `subtitle:update/reset` 이벤트를 위조하면 세션 오염 가능 | observer 주입 시 비밀 토큰(세션 nonce) 전달 후 이벤트마다 토큰 검증 |
| 높음 | `filterUnconfirmedEnabled`가 container fallback에서 우회될 수 있음 | `src/content/dom-probe.ts:101-124, 157-175` (`readContainerFallback`, container selector 경로는 확정/미확정 구분 없음) | 미확정 자막 제외 옵션 켜도 일부 경로에서 인식 중 자막이 반영될 수 있음 | container 경로에도 확정 판별 게이트 추가(예: `#viewSubtit .smi_word` confirmed row 존재 여부 확인) |
| 중간~높음 | frame forwarding nonce 수명이 탭 생명주기와 동일(탭 내 내비게이션 시 재발급 없음) | `src/background/service-worker.ts:16, 56-64, 328-329` | nonce 노출 시 같은 탭의 후속 페이지에서도 재사용 공격면 유지 | nonce를 내비게이션 단위(또는 캡처 시작 단위)로 재발급 |
| 중간 | fallback 탐색 비용이 큼 (주기적 frame 재귀 탐색) | `src/content/content-script.ts:811-849`, `src/content/frame-probe.ts:108-150` | observer stale 시 CPU 사용량 증가, 저사양 환경에서 끊김 가능 | stale 누적 시간 기반 백오프(예: 200ms→500ms→1000ms), 마지막 성공 frame 캐시 도입 |
| 중간 | 자막 row 처리에서 스타일 계산 비용이 큼 | `src/content/subtitle-rows.ts:63-64, 101-104, 95-100` (`normalizeSpeakerColor`, `isConfirmedSubtitleNode`) | row 수가 많거나 polling 빈도가 높을 때 reflow/recalc 비용 증가 | 색상 정규화 캐시(Map), 확정 판별 대상 깊이 제한/조기 종료, 필요 시 샘플링 |
| 중간 | extension context invalidated 시 타이머/브리지 정리 불충분 | `src/content/content-script.ts:520-525` (status/persist timer만 정리) | 업데이트 직후 polling/fallback 루프가 남아 오류 로그 누적 가능 | invalidated 전용 `shutdown()` 추가(로컬/탑 fallback 타이머, pending reset, observer bridge 해제) |
| 낮음~중간 | Offscreen 문서 존재 확인이 `getContexts` 의존적 | `src/background/service-worker.ts:131-141` | 일부 런타임에서 `createDocument` 중복 예외로 data URL fallback 빈도 증가 가능 | `createDocument`의 "already exists" 계열 오류를 정상 경로로 취급 |
| 낮음 | 핵심 런타임 모듈 테스트 커버리지 낮음 | `npm run verify` 결과: `content-script.ts`, `injected-observer.ts`, `frame-probe.ts` 커버리지 매우 낮음 | 회귀를 사전에 포착하기 어려움 | 브리지/보안/fallback 경로 단위 테스트 및 최소 1개 브라우저 E2E 시나리오 추가 |

## 우선 보강 제안 (실행 순서)
1. 메시지 무결성 강화: observer 이벤트 토큰 검증 + nonce 회전 정책.
2. 옵션 의미론 보장: `filterUnconfirmedEnabled`를 container fallback까지 일관 적용.
3. 성능 안정화: stale fallback 백오프 + color/확정 판별 캐시.
4. 운영 품질: invalidated graceful shutdown + 핵심 모듈 테스트 확대.

## 메모
- 이번 리포트는 기존 `FUNCTIONAL_GAP_REVIEW_2026-03-11.md`에서 이미 처리한 항목을 제외하고, **추가로 남아 있는 리스크**만 정리했습니다.

## Implementation Closure (2026-03-11)

The improvements proposed in this addendum are now implemented in the codebase.

| Item | Implementation Status | Code References |
|---|---|---|
| Observer bridge message token verification | Completed | `src/content/content-script.ts`, `src/content/injected-observer.ts`, `src/shared/message-types.ts` |
| `filterUnconfirmedEnabled` consistency in container fallback paths | Completed | `src/content/dom-probe.ts`, `src/content/injected-observer.ts` |
| Frame-forward nonce rotation on navigation | Completed | `src/background/service-worker.ts` |
| Fallback probe performance (backoff + cached frame path probe) | Completed | `src/content/content-script.ts`, `src/content/frame-probe.ts` |
| Invalidated extension context shutdown handling | Completed | `src/content/content-script.ts` |
| Offscreen document duplicate-create tolerance | Completed | `src/background/service-worker.ts` |
| Row-style cost reduction (color cache + bounded confirmation checks) | Completed | `src/content/subtitle-rows.ts` |
| Test expansion for new runtime behavior | Completed | `tests/dom-probe.test.ts`, `tests/frame-probe.test.ts`, `tests/injected-observer.test.ts` |

Validation snapshot (after implementation):

- `npm run lint`
- `npm run typecheck`
- `npm run test:coverage`
- `npm run build`
- `npm run verify`
