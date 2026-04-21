# 기능 구현 정합성 반영 메모 (2026-04-21)

이 문서는 2026-04-21 리뷰 계획(5개 항목)을 코드/테스트/문서에 반영한 결과를 정리한 구현 메모입니다.

## 이번 배치에서 반영한 내용

### 1) `sourceUrl` 안전화 (import + history reopen)

- session import sanitize 단계에서 `sourceUrl`은 `isSupportedAssemblyUrl()`로 검증합니다.
- 미지원 URL은 보존하지 않고 `""`로 정규화합니다.
- history `원본 페이지 열기` 버튼은 “값 존재”가 아니라 “지원 URL 여부” 기준으로만 활성화됩니다.
- reopen 핸들러에서도 같은 조건을 재검증해 우회 호출을 막습니다.

### 2) unconfirmed 필터 완화 (연속 6회)

- `DomProbeOptions`에 `allowUnconfirmedContainerFallback?: boolean`을 추가했습니다.
- `DomProbeResult`에 `blockedByUnconfirmedFilter?: boolean`을 추가했습니다.
- local polling / top fallback / injected observer 모두 같은 연속 카운트 로직을 사용합니다.
  - 차단 신호가 연속 6회 누적되면 container fallback을 일시 허용
  - 텍스트 회복 시 즉시 카운트 리셋
  - neutral miss에서는 기존 카운트 유지

### 3) 단일 세션 export 정책 (하드 제한 없음 + 오류 안내 강화)

- 단일 세션 export에 하드 용량 제한은 추가하지 않았습니다.
- 대신 다운로드 실패 메시지 품질을 강화했습니다.
  - `message length exceeded`/message-size 계열
  - invalid URL/data URL 계열
- 적용 범위:
  - in-page export
  - history 단일 export
  - history 전체 JSON 백업 다운로드 시작 경로

### 4) fallback 내부 raw / 표시 preview 분리

- container fallback 내부 raw는 정규화된 비교용 텍스트를 `4KB tail cap`으로 보존합니다.
- UI 표시는 별도 formatter로 유지합니다.
  - 비본회의 기준 tail 중심 preview
  - 기존 `400자/3줄` 의미론 유지

### 5) frame-forward 복원력 및 테스트 보강

- nonce mismatch 시 즉시 nonce resync + 빠른 top fallback probe를 트리거합니다.
- frame 관련 테스트 커버리지를 확장해 message guard, nonce accept/resync, fallback delay 경계를 명시 검증합니다.

## 테스트/검증 결과

- 통과:
  - `npm run test` (`47 files / 238 tests`)
  - `npm run typecheck`
  - `npm run build`
- 참고:
  - `npm run lint`는 로컬 비추적 스크립트(`scripts/generate-promo.mjs`)의 `no-undef` 이슈로 실패합니다.
  - 이번 배치 변경 코드 기준 신규 lint 오류는 정리 완료했습니다.

## 문서 동기화

- `README.md`, `CLAUDE.md`, `GEMINI.md`, `DEPLOYMENT.md`, `CODEBASE_AUDIT.md`에 2026-04-21 구현 정합성 내용을 반영했습니다.
- 본 문서를 기준으로 2026-04-21 리뷰 항목 추적이 가능하도록 문서 간 참조를 맞췄습니다.

## `.gitignore` 점검 결과

- 로컬 산출물/임시 자산 정리를 위해 아래 경로를 ignore에 반영했습니다.
  - `/scripts/generate-promo.mjs`
  - `/store_assets/`
  - `/test.html`
- 빌드/테스트/배포에 필요한 추적 파일은 ignore 대상에 포함하지 않았습니다.
