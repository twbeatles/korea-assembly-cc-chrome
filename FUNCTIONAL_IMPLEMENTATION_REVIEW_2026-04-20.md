# 기능 구현 정합성 반영 메모 (2026-04-20)

이 문서는 2026-04-20 기능 점검에서 제안한 보강 사항을 코드와 문서에 반영한 뒤 남기는 구현 메모입니다.

## 이번 배치에서 반영한 내용

- 다운로드 fallback 경계를 정리했습니다.
  - Blob URL 생성 실패 또는 Blob download 실패에서만 `data:` fallback 으로 내려갑니다.
  - Blob download 가 이미 성공한 뒤 metadata persist 만 실패하면 재다운로드하지 않고 경고만 남깁니다.
- 전체 라이브러리 `JSON 백업` / `JSON 가져오기` 에 `25 MiB` 하드 제한을 넣었습니다.
  - 전체 백업은 세션 전체 preload 대신 page-wise incremental packaging 으로 바뀌었습니다.
  - 전체 백업 / 전체 가져오기는 제한 초과 시 명시적 오류로 중단됩니다.
- iframe 자막 레이어 탐지를 정리했습니다.
  - 접근 가능한 frame 전체의 `#viewSubtit`, 자막 텍스트, visible control active 상태를 함께 집계합니다.
  - 자동 활성화 성공 조건은 계속 `visible && (hasText || controlActive)` 입니다.
- runtime 진단에 persistability 상태를 추가했습니다.
  - `persistabilityState`
  - `persistabilityHint`
  - 지원 상태: `idle`, `persistable`, `preview_only`, `unstable_only`, `filtered`, `duplicate`
- in-page `수집된 자막` 렌더를 최신 `300`건으로 제한했습니다.
  - panel 렌더 비용만 제한합니다.
  - 세션 전체 history, 저장, export, JSON payload 는 전체 committed entry 를 계속 사용합니다.
- popup / diagnostics stale 연결 복구를 보강했습니다.
  - popup 은 현재 창 active tab 기준으로 재연결합니다.
  - diagnostics 는 `tabId` 가 있으면 우선 추적하고, 대상이 닫히거나 unsupported 가 되면 다른 supported assembly tab 으로 fallback 합니다.
- 저커버리지 영역 테스트를 추가했습니다.
  - `offscreen-main`
  - `chrome-api`
  - `popup-bridge`
  - `session-lifecycle`
  - `persistability`

## 문서 동기화

- `README.md`
  - `25 MiB` 제한, persistability diagnostics, frame-aware subtitle activation, panel `300`건 render cap, popup/options reconnect 동작을 반영했습니다.
- `CLAUDE.md`
  - 2026-04-20 sync delta 를 추가해 최신 구현 기준을 고정했습니다.
- `GEMINI.md`
  - 2026-04-20 sync delta 를 추가해 운영 메모 기준을 맞췄습니다.
- `DEPLOYMENT.md`
  - 릴리스 검증 항목에 `25 MiB` 제한, persistability diagnostics, frame-split subtitle activation, stale reconnect, download fallback 경계를 추가했습니다.
- `CODEBASE_AUDIT.md`
  - 현재 감사 문서가 역사적 참고용이라는 점을 유지하면서, 2026-04-20 기준 최신 구현 반영 사항과 참조 문서를 보강했습니다.

## `.gitignore` 점검 결과

- 현재 워크트리에서 생성되는 `dist/`, `coverage/`, lint 출력물, 임시 스크립트, 로컬 확장 unpack 디렉터리, 스크린샷, zip/crx 산출물은 이미 ignore 대상입니다.
- 이번 배치 기준으로 추가 ignore rule 이 필요한 새 산출물은 확인되지 않았습니다.
- 이번 문서와 코드 변경은 추적 대상이므로 `.gitignore` 는 수정하지 않았습니다.

## 남은 후속 과제

- 전체 라이브러리 `JSON 백업` / `JSON 가져오기` 의 `25 MiB` 초과 payload 를 다루는 streaming parse / streaming transport 는 후속 과제로 남겨 두었습니다.
- 실제 국회 중계 페이지 기준 브라우저 수동 QA 는 배포 전 다시 한 번 돌리는 것이 좋습니다.
