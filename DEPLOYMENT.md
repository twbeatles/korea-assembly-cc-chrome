# 배포 가이드

이 문서는 `korea-assembly-cc-chrome` 확장프로그램을 빌드한 뒤 실제 Chrome 확장프로그램으로 배포하는 절차를 정리합니다.

## 1. 배포 대상

- 개발용 로컬 설치: `chrome://extensions` 에서 `dist/` 로드
- 내부 공유용 패키지: `dist/` 내용을 zip 으로 압축
- Chrome Web Store 배포: `dist/` 내용을 업로드

중요:
- 항상 루트가 아니라 `dist/` 결과물을 배포합니다.
- zip 파일 안에서 `manifest.json` 이 최상위에 있어야 합니다.
- `dist/` 폴더 자체를 한 단계 더 감싸서 압축하면 안 됩니다.

## 2. 사전 준비

### 2.1 필수 환경

- Node.js 20 이상 권장
- npm
- Chrome 최신 버전

### 2.2 버전 관리

배포 전에는 아래 두 파일의 버전을 같이 올립니다.

- `package.json`
- `manifest.json`

현재 구조는 자동 버전 동기화가 없으므로 둘 중 하나만 바꾸면 안 됩니다.

현재 스토어 제출 준비 기준 버전은 `1.0.6` 입니다.

## 3. 배포 전 검증

루트에서 아래 명령을 실행합니다.

```bash
npm install
npm run lint
npm run typecheck
npm run test
npm run build
```

설명:
- `npm run build` 는 먼저 `scripts/build-injected.mjs` 로 `public/injected-observer.js` 를 재생성한 뒤 Vite 빌드를 수행합니다.
- 최종 배포 산출물은 `dist/` 에 생성됩니다.

추가 확인 권장:
- 국회 의사중계 페이지에서 실제 자막 추출
- 페이지 오른쪽 패널이 자동으로 뜨는지 확인
- 패널에서 `자막 모으기` 직후 AI 자막 레이어가 자동으로 열리는지 확인
- 패널 상단의 큰 `실시간 내용` 영역이 먼저 보이는지 확인
- `수집된 자막` 목록에서 같은 `.smi_word`가 보정될 때 카드가 재생성되지 않고 제자리 갱신되는지 확인
- 본회의(`xcode=10` 또는 `xcgcd=DCM000010...`) 페이지에서는 container fallback으로만 잡혀도 `실시간 내용` 누적 원문이 유지되고 `수집된 자막` 목록이 commit된 entry 기준으로 계속 쌓이는지 확인
- `로딩중..`, `로딩 중...`, `Loading...` 같은 placeholder 문구가 저장/export/누적 목록에 들어가지 않는지 확인
- 동일한 carry-over 문장이 반복 노출되더라도 export 결과에서 한 번만 남는지 확인
- 패널의 `저장 / 내보내기` 버튼에서 `텍스트(TXT) / 자막(SRT) / 웹자막(VTT) / 기록(JSON)` 저장 확인
- observer 가 먼저 처리한 row 를 polling/top-frame fallback 이 다시 봐도 중복 entry 가 생기지 않는지 확인
- 수집 중 새로고침/페이지 이동 시 브라우저 경고가 뜨는지 확인
- 탭 숨김 또는 페이지 이탈 직전 마지막 running/stopped 스냅샷이 저장되는지 확인
- 패널 / popup의 수동 저장과 export 가 현재 화면에 보이는 확정 `수집된 자막` 목록만 반영하고, preview-only `실시간 내용`은 저장 대상으로 승격하지 않는지 확인
- service worker 재기동 또는 nonce mismatch 뒤에도 iframe forwarding 수집이 새로고침 없이 다시 수렴하는지 확인
- popup 에서 `페이지 패널 열기`, `저장된 기록`, `환경 설정`, `수집 진단` 이동 확인
- popup `지금 저장` 버튼이 persistable content가 없으면 비활성화되고, 빈 저장 요청 시 `저장할 자막이 아직 없습니다.` 피드백이 보이는지 확인
- history 검색 / 최근 N줄 복사 / 전체 내용 복사 / 찾은 내용 복사 확인
- 페이지 패널의 `최근 N줄 복사`가 현재 화면 row가 아니라 누적 세션 기준으로 history와 같은 결과를 주는지 확인
- history 즐겨찾기 토글 / 즐겨찾기만 보기 / 세션 메모 저장 확인
- history entry 체크박스 기반 `선택한 항목 복사`, `선택 TXT/SRT/VTT/JSON` export 확인
- history `전체 JSON 백업` 과 `JSON 가져오기`(단일 세션 / bundle) 확인
- history `전체 JSON 백업` / `JSON 가져오기` 중 현재 단계, 진행량, 취소 버튼이 노출되고 중복 JSON 작업만 잠기는지 확인
- `JSON 가져오기` 취소 시 이미 저장된 일부 레코드는 유지되고 부분 완료 요약 메시지가 표시되는지 확인
- options 페이지에서 자동 저장, 자동 스크롤, noise filter, 중복 차단 최소 길이, 저장 파일 이름 규칙 검증 확인
- options noise filter 설명이 한글/영문 중심 판정과 foreign text 보존 시 filter off 필요성을 안내하는지 확인
- stopped 세션 저장 실패 뒤 다시 `자막 모으기`/`화면 비우기`를 눌렀을 때 저장 재시도 후 폐기 확인으로 이어지는지 확인
- popup / 패널의 `수집 진단` 버튼이 options 페이지의 `수집 진단` 탭으로 연결되고, 그 탭에서 수집 방식, observer, selector, frame path 진단이 현재 상태와 맞는지 확인

## 4. 로컬 설치

### 4.1 Unpacked Extension 로드

1. `npm run build`
2. Chrome 에서 `chrome://extensions` 열기
3. 우측 상단 `개발자 모드` 켜기
4. `압축해제된 확장 프로그램을 로드합니다` 선택
5. 저장소 루트가 아니라 `dist/` 폴더 선택

### 4.2 로드 후 점검

아래를 확인합니다.

1. 확장 popup 이 열리는지
2. 국회 페이지 오른쪽에 패널이 자동으로 나타나는지
3. 기존에 열려 있던 국회 탭에서 popup 연결 오류 없이 재주입 또는 새로고침 안내로 복구되는지
4. 확장 아이콘의 popup 에서 현재 상태가 보이는지

## 5. 내부 공유용 배포

사내 배포나 수동 전달용으로 zip 패키지를 만들 때는 `dist/` 내부 파일들만 압축합니다.

예시:

```text
good.zip
  manifest.json
  popup.html
  options.html
  history.html
  assets/
  icons/

bad.zip
  dist/
    manifest.json
    ...
```

Windows PowerShell 예시:

```powershell
Compress-Archive -Path dist\* -DestinationPath korea-assembly-cc-chrome-1.0.6-cws.zip -Force
```

## 6. Chrome Web Store 배포

### 6.1 업로드 전 준비물

- `dist/` 기반 zip 파일
- 스토어 설명 문구
- 스크린샷
- 아이콘/프로모션 이미지
- 개인정보 처리 관련 설명
- 권한 설명

현재 확장에서 실제 사용하는 주요 권한:

- `storage`
- `downloads`
- `offscreen`
- `activeTab`
- `scripting`
- host permission:
  - `https://assembly.webcast.go.kr/*`
  - `https://webcast.assembly.go.kr/*`

### 6.2 업로드 절차

1. `npm run build`
2. `dist/` 내부 파일만 zip 으로 압축
3. Chrome Web Store 개발자 대시보드에서 새 버전 업로드
4. 스토어 메타데이터와 권한 설명 입력
5. 심사용 변경 사항 설명 작성
6. 검토 제출

### 6.3 심사 메모에 적기 좋은 항목

- 국회 의사중계 도메인에서만 동작함
- AI 자막 DOM 을 읽어 사용자가 파일로 저장할 수 있게 함
- 수집 데이터는 세션 저장 및 내보내기 목적
- `downloads` 권한은 TXT/SRT/VTT/JSON 파일 저장용
- `storage` 권한은 설정, 세션 저장 fallback, page-exit replay queue, 탭 단위 frame-forward nonce, 저장 복구 diagnostics 용
- `storage` 는 즐겨찾기/메모 같은 세션 메타와 JSON 가져오기 후 복원된 기록 저장에도 사용됨

## 7. 릴리스 체크리스트

- `package.json` 버전 증가
- `manifest.json` 버전 증가
- `npm run lint` 통과
- `npm run typecheck` 통과
- `npm run test` 통과
- `npm run build` 통과
- `dist/manifest.json` 생성 확인
- `dist/injected-observer.js` 생성 확인
- `dist/manifest.json` 의 버전이 루트 `manifest.json` / `package.json` 과 같은지 확인
- unpacked 로드 테스트 완료
- 실제 국회 페이지 자막 추출 확인
- exporter 결과물 확인
- history 즐겨찾기/메모 persistence 확인
- 부분 선택 export 및 JSON 백업/복원 확인
- options 페이지 `수집 진단` 탭 정보 확인
- options `저장 파일 이름 규칙`에 금지 문자 또는 지원하지 않는 placeholder 입력 시 저장 차단 확인

## 8. 배포 후 확인 항목

배포 후에는 아래를 다시 봅니다.

1. service worker 가 정상 등록되는지
2. content script 가 `https://assembly.webcast.go.kr/*` 와 `https://webcast.assembly.go.kr/*` 에서 동작하는지
3. observer 실패 시 polling fallback 이 계속 동작하는지
4. SRT / VTT 시간이 상대 cue time 으로 생성되는지
5. IndexedDB 실패 시 세션 저장 fallback 이 동작하는지
6. options 페이지 `수집 진단` 탭에 마지막 자동 저장 시각과 `저장 복구 상태`가 보이는지
7. 브라우저/확장 재시작 뒤 남아 있던 `running` 세션이 `stopped`로 정리되는지
8. 브라우저/확장 재시작 뒤 page-exit queued stopped snapshot replay가 cleanup보다 먼저 적용되는지
9. 대용량 export에서 offscreen Blob 경로가 우선 사용되고 필요 시 fallback 되는지
10. `자막 모으기` 중 자막 레이어가 닫히거나 비어도 자동 재활성화 시도가 동작하고, 성공 판정이 `visible && (hasText || controlActive)`와 맞는지 확인
11. JSON 내보내기에서 carry-over 중복이 정리되고 내부 발언자 메타가 노출되지 않는지
12. 자막 보정 중에는 패널의 `실시간 내용`과 `수집된 자막`이 바로 갱신되는지
13. `수집된 자막` 목록이 최근 row를 누적 표시하고, preview-only 갱신만으로 깜빡이거나 맨 아래로 튀지 않는지
14. 본회의 페이지에서는 structured row가 없어도 `수집된 자막` 목록이 commit된 누적 entry를 계속 보여 주는지
15. `로딩중..`, `로딩 중...`, `Loading...` placeholder가 저장 기록이나 export 결과에 남지 않는지
16. history 에서 즐겨찾기/메모를 저장한 뒤 새로고침해도 그대로 유지되는지
17. 부분 선택 `SRT / VTT` export 가 원본 세션 시작 기준 상대 시간 의미론을 유지하는지
18. 전체 JSON 백업 파일로 다른 기록을 가져올 때 최신 `updatedAt` 레코드 우선 정책이 지켜지는지
19. options 페이지 `수집 진단` 탭의 진단 정보가 실제 structured/fallback/polling 상태와 일치하는지
20. history / popup 주요 액션 실패 시 사용자 메시지가 즉시 노출되는지
21. history 의 전체 삭제가 한 저장소만 실패해도 다른 저장소 정리를 계속 시도하고, 실패 detail 을 사용자에게 남기는지
22. history 의 대용량 작업 중 관련 버튼이 잠겨 중복 실행이 되지 않는지
23. options `저장 복구 상태`가 `queue write / replay / cleanup` phase별 오류를 각각 보여 주는지 확인

## 9. 자주 발생하는 문제

### 9.1 확장을 로드했는데 페이지 패널이 보이지 않음

- 국회 페이지가 이미 열려 있었다면 새로고침이 필요할 수 있습니다.
- 최신 빌드는 기존 탭에 content script 재주입을 먼저 시도합니다.
- 대상 URL 이 `https://assembly.webcast.go.kr/*` 또는 `https://webcast.assembly.go.kr/*` 범위인지 확인합니다.

### 9.2 zip 업로드가 실패함

- zip 최상위에 `manifest.json` 이 있는지 확인합니다.
- `dist/` 폴더를 통째로 감싸서 압축하지 않았는지 확인합니다.

### 9.3 observer 가 붙지 않음

- 페이지 구조 변경 가능성이 있습니다.
- 현재 구현은 observer 실패 시 polling fallback 으로 내려가므로, 완전 중단보다는 성능 저하 형태로 나타나는 경우가 많습니다.

### 9.4 저장이 실패함

- 현재 구현은 `IndexedDB -> chrome.storage.local -> 메모리` fallback 순서로 내려갑니다.
- `chrome.storage.local` fallback 은 세션별 key 구조를 사용합니다.
- 브라우저 저장소 정책이나 시크릿 모드 설정에 따라 persistence 동작이 달라질 수 있습니다.

### 9.5 Chrome Web Store 참고 기능과 차이가 있음

- 현재 범위에는 `영상 캡처`, `중요 표시`, `발언자 편집` 기능이 포함되지 않습니다.
- 이번 배포는 검색 / 복사 / autosave UX 외에 자막 자동 활성화, 본회의 fallback 누적 표시, placeholder 필터링 하드닝도 포함합니다.

## 10. 권장 운영 방식

- 개발 빌드는 unpacked 로 검증
- 배포 빌드는 항상 새 `dist/` 를 생성
- 스토어 제출용 zip 은 매번 새로 생성
- 릴리스 태그나 커밋 메시지에 manifest 버전을 같이 남김

## 2026-03-11 Release Gate Update

Before packaging a release ZIP, run the full validation path:

```bash
npm run lint
npm run typecheck
npm run test:coverage
npm run build
```

Or run the one-shot command:

```bash
npm run verify
```

Additional release notes:

- UI/UX safety guards and accessibility updates are now part of baseline behavior.
- History export now uses user-defined `filenamePattern`.
- Popup now attempts automatic reconnection on disconnect.

## 2026-03-20 Release Update

Current release alignment:

- 본회의(`xcode=10` / `xcgcd=DCM000010...`) container fallback에서는 `실시간 내용` 원문 누적을 유지합니다.
- structured row가 비어 있어도 본회의 fallback capture는 commit된 entry를 `수집된 자막` 목록으로 계속 표시합니다.
- `로딩중..`, `로딩 중...`, `Loading...` placeholder는 commit/persist/export 대상에서 제외합니다.
- Chrome Web Store 제출용 압축 예시는 `korea-assembly-cc-chrome-<version>-cws.zip` 형식을 권장합니다.
- 수동 저장 / export 와 pagehide/beforeunload/stop 계열 persistence 는 현재 화면에 보이는 확정 `수집된 자막` 목록만 저장 기준으로 검증해야 합니다.
- 하늘색 등 불투명 배경이나 background-image highlight 가 남아 있는 `인식 중` 자막은 commit/persist/export 대상에서 제외되는지 확인해야 합니다.
- History favorites/notes, partial copy/export, full JSON backup/import, and live capture diagnostics are part of current release baseline.
- full-library `JSON 백업` / `JSON 가져오기` 는 단계별 진행률과 취소를 제공하며, import cancel 은 partial completion 을 허용합니다.
- `npm audit` may still report high findings via `@crxjs/vite-plugin` -> `rollup@2.x` upstream pinning.

## 2026-03-11 Addendum Deployment Notes

Pre-release validation now assumes the addendum closure changes are present:

- Observer bridge token integrity checks
- Frame-forward nonce rotation on navigation
- Fallback probing backoff + cached frame path probing
- Invalidated-context shutdown cleanup
- Offscreen duplicate-create tolerance

Deployment documentation consistency sources:

- `README.md`
- `DEPLOYMENT.md`

## 2026-03-12 Deployment Consistency Update

- Supported hosts are fixed to both:
  - `https://assembly.webcast.go.kr/*`
  - `https://webcast.assembly.go.kr/*`
- Release verification should additionally confirm:
  - popup `OPEN_INPAGE_PANEL` feedback is visible
  - popup char-count display is correct
  - history pagination and visible-only selection controls behave as expected
  - options page explains that `autoStartEnabled` defaults to `true`
  - startup cleanup restores persisted Blob download URL tracking safely
  - options `저장 복구 상태` reflects replay / cleanup diagnostics from startup persistence maintenance

## 2026-03-14 Deployment Consistency Update

- Release verification should confirm that a fresh `start -> stop` cycle with no captured rows does not leave an orphan persisted `running` session.
- Release verification should confirm that favorited / noted sessions keep `starred`, `pinnedAt`, and `note` metadata after autosave, page-exit persistence, and final stop-save flows.
- page-exit persistence is now ordered as `queue replay record -> background persist request`; regression coverage for that ordering is part of release confidence.
- History validation should cover store-level paging, live refresh via `SESSION_LIBRARY_REVISION_STORAGE_KEY`, and note-draft preservation during same-session refreshes.
- Popup and options initial render should be validated from `CAPTURE_STATUS` alone, including subtitle count, char count, preview text, and recent entry hydration.
- The current pre-release gate remains `npm run verify`.

## 2026-03-19 Deployment Consistency Update

- Release verification should confirm that frame-forward nonce state survives MV3 service worker restarts via `chrome.storage.local` and converges again without requiring a page reload.
- Release verification should confirm that queued exit persist reads merge storage and memory snapshots, and that a storage write failure does not silently drop the in-memory replay candidate.
- Options validation should confirm that `저장 복구 상태` shows `queue write`, `replay`, `cleanup`, and summary errors separately when they are present.
- Popup validation should confirm that `지금 저장` is disabled when `hasPersistableContent` is false, and that forced empty saves still yield `저장할 자막이 아직 없습니다.` feedback.
- Subtitle activation validation should confirm that merely showing `#viewSubtit` is not enough; success requires visible text or an active control signal.

## 2026-04-07 Deployment Consistency Update

- Release verification should confirm that `수집된 자막` 저장/export 기준이 live ledger cap 과 무관한 세션 전체 누적 committed subtitle 목록임을 유지합니다.
- Release verification should confirm that 회의명 파서는 trailing `|` branding 만 제거하고 날짜 / 회차 / 하이픈 텍스트를 보존합니다.
- Release verification should confirm that subtitle visibility 판정은 `display:none`, `visibility:hidden`, `opacity:0`, zero-rect 를 동일하게 hidden 으로 처리합니다.
