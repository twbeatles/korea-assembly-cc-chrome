# 구현 리스크 후속 정리 — 2026-03-13

> 작성일: 2026-03-13
> 검토 기준: 현재 `src/`, `tests/`, `manifest.json`, `.gitignore`, 주요 운영 문서 직접 대조

---

## 요약

2026-03-13 기준으로 저장 복구 경로, JSON import 검증, history 대량 작업 helper, popup/history/options 오류 피드백, options 숫자 draft validation, fallback notice 문구 정합성까지 코드와 문서를 다시 맞췄다.

이번 라운드에서는 문서와 구현의 불일치도 함께 정리했다.

- `README.md`, `CLAUDE.md`, `GEMINI.md`: startup persistence maintenance / replay diagnostics / import sanitize / history helper / options draft validation 반영
- `DEPLOYMENT.md`: 지원 host permission 2개와 startup recovery diagnostics 검증 절차 반영
- `CHROME_WEB_STORE_PERMISSION_JUSTIFICATIONS.md`, `PRIVACY_POLICY_DRAFT_KO.md`: 실제 동작 도메인 2개 기준으로 수정
- `.gitignore`: 로컬 lint 산출물 ignore 보강, 버전 관리 중인 정책 문서 ignore 규칙 제거

---

## 이번 라운드에서 구현 완료된 항목

### 1. 저장 복구 경로 강화

- page-exit stopped snapshot 은 background 저장 요청과 별도로 세션별 replay queue 에 적재된다.
- startup 시에는 queued stopped snapshot replay 를 먼저 실행하고, 그 다음 persisted running session cleanup 을 수행한다.
- replay / cleanup 결과는 diagnostics snapshot 으로 저장되며 options `저장 복구 상태`에서 확인할 수 있다.
- background 저장이 성공하면 같은 세션의 stale queued snapshot 은 즉시 정리된다.

### 2. import 및 저장소 검증 강화

- JSON import 는 raw payload spread 가 아니라 allow-list sanitize 후 normalize 한다.
- unsupported backup wrapper version 은 reject 한다.
- parse 불가능한 `startedAt`, `createdAt`, `updatedAt`, `endedAt`, entry timestamp 는 reject 한다.
- unknown field 는 drop 한다.

### 3. history / popup / options UX 보강

- history 와 popup 의 주요 async 액션은 실패 시 항상 사용자 메시지를 남긴다.
- history 전체 삭제 확인은 저장소 전체 preload 대신 `정확한 총 건수 + preview` helper 를 사용한다.
- 전체 JSON 백업은 store helper 가 만든 payload 로 수행한다.
- options 숫자 필드는 canonical number 와 별도 draft string state 를 유지하고, invalid draft 는 inline error 와 함께 저장을 막는다.

### 4. 패널 문구 정합성 보정

- 실제 자막이 계속 수집되는 fallback / polling 경로에서 “불안정”, “보조 탐지” 같은 과도한 경고 문구를 제거했다.
- panel capture mode badge 도 `자막 찾는 중` 대신 `실시간 자막`으로 조정했다.

---

## 현재 기준으로 남겨둔 항목

다음 항목은 이번 라운드에서 의도적으로 남겨 두었다.

- `mergeGapSeconds` 미사용 문제
- `recentHistoryEntries` / `recentHistoryCompactLength` 미사용 문제
- CJK 문자 처리 범위를 확장할지 여부
- popup 에 직접 Start/Stop/Save 제어를 다시 넣을지 여부
- 브라우저 E2E 도입 여부

이 항목들은 현재 기준으로 “미해결 리스크 또는 정책상 유보” 상태다.

---

## 검증 기준

이번 라운드 정합성 확인은 아래 기준으로 맞췄다.

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

문서 정합성은 아래를 함께 대조했다.

- host permission 이 실제 manifest 도메인 2개와 일치하는지
- options 진단 문구가 실제 UI 기능(`저장 복구 상태`)과 일치하는지
- README / 운영 문서가 startup replay -> cleanup 순서를 반영하는지
