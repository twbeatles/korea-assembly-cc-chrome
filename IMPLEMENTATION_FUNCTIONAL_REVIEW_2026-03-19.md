# 기능 구현 점검 리포트 (2026-03-19)

검토 기준 문서:

- `README.md`
- `CLAUDE.md`
- `GEMINI.md`
- `CHROME_WEB_STORE_PERMISSION_JUSTIFICATIONS.md`
- `PRIVACY_POLICY_DRAFT_KO.md`
- `manifest.json`
- `src/`, `tests/`

## 검증 결과

- `npm run lint`: 통과
- `npm run typecheck`: 통과
- `npm run test`: 통과
  - `35`개 테스트 파일
  - `148`개 테스트 통과
- `npm run build`: 통과

## 이번 라운드 구현 완료 항목

### 1. MV3 service worker 재기동 대응 frame-forward nonce 하드닝

- `src/background/frame-forward-nonce-store.ts`
  - 탭 단위 `chrome.storage.local` 기반 nonce source를 추가했습니다.
- `src/background/frame-forward-nonce-lifecycle.ts`
  - 탭 `loading` 시 nonce 회전, 탭 제거 시 nonce 정리 로직을 테스트 가능한 헬퍼로 분리했습니다.
- `src/background/service-worker.ts`
  - `GET_FRAME_FORWARD_NONCE`가 persisted nonce를 반환하도록 변경했습니다.
  - `tabs.onUpdated(status === "loading")`에서 nonce를 회전합니다.
  - `tabs.onRemoved`에서 메모리/저장소 nonce를 정리합니다.
- `src/content/content-script.ts`
  - content script bootstrap 시 nonce를 받고, 15초 주기로 재동기화합니다.
  - forwarded frame message nonce mismatch 시 현재 이벤트를 버리고 즉시 nonce를 재조회합니다.
- `src/content/frame-coordinator.ts`
  - forwarded frame nonce mismatch 처리 의미론을 헬퍼로 고정했습니다.

영향:

- service worker가 idle 종료 후 다시 살아나도 top/subframe nonce가 자동으로 다시 맞춰집니다.
- mismatch 이벤트는 드롭하지만 이후 이벤트부터는 새 nonce로 정상 수렴합니다.

### 2. page-exit replay queue / startup maintenance 보존성 강화

- `src/storage/persist-recovery.ts`
  - replay queue 조회가 storage snapshot + memory snapshot merge 방식으로 동작합니다.
  - 같은 `sessionId` 충돌 시 `record.updatedAt` 최신값을 우선하고, 동률이면 `queuedAt`이 더 늦은 레코드를 유지합니다.
  - queue write 실패 시 메모리 queue는 유지하고, `lastQueueWriteError` diagnostics를 별도로 남깁니다.
  - queue clear는 memory/storage 각각 best-effort로 수행합니다.
- `src/storage/types.ts`
  - `PersistReplayDiagnostics`에 `lastReplayError`, `lastCleanupError`, `lastQueueWriteError`를 추가했습니다.
- `src/background/startup-persistence.ts`
  - startup replay 실패와 cleanup 실패를 분리해서 저장합니다.
  - `lastError`는 phase별 오류의 호환용 요약 필드로 유지합니다.
- `src/options/App.tsx`
  - `저장 복구 상태`에서 queue write / replay / cleanup / summary 오류를 각각 노출합니다.

영향:

- `chrome.storage.local.set`이 실패해도 같은 런타임에서 replay 후보가 조용히 사라지지 않습니다.
- startup diagnostics에서 어느 단계가 실패했는지 분리해 확인할 수 있습니다.

### 3. popup / panel 저장 정합성 정리

- `src/popup/App.tsx`
  - popup `지금 저장` 버튼 활성 조건을 `subtitleCount > 0 || previewText.trim() !== ""`로 정리했습니다.
- `src/content/content-script.ts`
  - 저장 가능한 내용이 없으면 `저장할 자막이 아직 없습니다.` 문구를 패널 notice로 남깁니다.
  - popup에서 강제 저장 요청이 들어와도 같은 문구를 `POPUP_FEEDBACK`으로 돌려줍니다.
- `src/shared/message-types.ts`
  - `POPUP_FEEDBACK` 명령 타입에 `SAVE_SESSION`을 추가했습니다.

영향:

- panel과 popup이 빈 저장 상태를 같은 문구로 처리합니다.
- 버튼 비활성화와 우회 호출 처리 결과가 서로 어긋나지 않습니다.

### 4. 자막 레이어 자동 활성화 성공 판정 강화

- `src/content/subtitle-layer.ts`
  - `SubtitleLayerState`에 `controlActive`를 추가했습니다.
  - visible activation control을 frame 포함 경로에서 탐색합니다.
  - 성공 판정을 `visible && (hasText || controlActive)`로 강화했습니다.
  - 단순히 `#viewSubtit`만 보여도 성공으로 보지 않습니다.

영향:

- 자동 활성화가 실제로 자막 레이어를 usable 상태로 만들었을 때만 성공으로 처리됩니다.
- 활성화가 덜 된 상태에서는 수집은 유지하면서 패널 notice가 수동 클릭 안내로 내려갑니다.

## 문서 정합성 업데이트

이번 구현과 맞추어 다음 문서를 갱신했습니다.

- `README.md`
  - storage-backed nonce, phase별 diagnostics, popup 빈 저장 처리, stricter subtitle activation 설명 추가
  - Git 추적 기준 문서 집합으로 정리하고 local-only `legacy/` 참조를 완화
- `CLAUDE.md`
  - 2026-03-19 sync delta 추가
  - replay queue merge, diagnostics 분리, popup save UX, subtitle activation 성공 기준 명시
- `GEMINI.md`
  - 2026-03-19 sync delta 추가
  - same runtime/storage semantics 반영
- `DEPLOYMENT.md`
  - 배포 전 검증 체크리스트에 nonce 복구, phase diagnostics, popup no-content save, stricter activation 판정 추가
- `CHROME_WEB_STORE_PERMISSION_JUSTIFICATIONS.md`
  - `storage` 권한 사용 근거에 replay diagnostics 및 탭 단위 nonce 내부 상태 추가
- `PRIVACY_POLICY_DRAFT_KO.md`
  - 로컬 저장되는 내부 진단/동기화 상태 설명 추가

## `.gitignore` 점검 결과

- 현재 `.gitignore`는 `dist/`, `coverage/`, 임시 스크립트, 루트 export 파일, Chrome unpacked output 등 실제 산출물을 적절히 제외하고 있습니다.
- 이번 라운드에서 추가된 추적 대상 문서/소스/테스트를 막는 규칙은 없었습니다.
- 따라서 `.gitignore`는 정합성 관점에서 수정이 필요하지 않아 유지했습니다.

## 남은 범위

이번 라운드에서 의도적으로 제외한 항목:

- 대용량 JSON import/export 전용 진행률/취소 UX

권장 후속 작업:

- 실제 국회 페이지 기반 브라우저 통합 회귀 테스트
- 대용량 JSON import/export UX와 quota 근처 진단

## 요약

2026-03-19 기준으로 계획했던 1차 안정성 하드닝은 `대용량 JSON import/export UX`를 제외하고 구현 완료 상태입니다. 문서, 권한 설명, 개인정보 초안도 현재 코드와 맞도록 정리했으며, 기본 검증(`lint`, `typecheck`, `test`, `build`)은 모두 통과했습니다.
