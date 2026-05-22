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

현재 스토어 제출 준비 기준 버전은 `1.0.9` 입니다.

## 3. 배포 전 검증

루트에서 아래 명령을 실행합니다.

```bash
npm install
npm run check:version
npm run check:injected
npm run lint
npm run typecheck
npm run test
npm run build
npm run verify:e2e
```

설명:

- `npm run build` 는 먼저 `scripts/build-injected.mjs` 로 `public/injected-observer.js` 를 재생성한 뒤 Vite 빌드를 수행합니다.
- `npm run verify:e2e` 는 build 후 Playwright로 built extension smoke test를 실행합니다.
- 최종 배포 산출물은 `dist/` 에 생성됩니다.
- 전체 release gate 는 `npm run verify` 로 실행할 수 있으며, 로컬 Chrome 확장 smoke 는 `npm run test:e2e:extension` 으로 별도 실행합니다.

추가 확인 권장:

- 국회 의사중계 페이지에서 실제 자막 추출
- `main` / `main/` 홈에서 페이지 오른쪽 패널이 자동으로 뜨는지 확인
- 홈(`main`/`main/`)에서는 패널이 바로 보이지만 `자막 모으기`를 누르면 플레이어 페이지에서만 수집을 시작할 수 있다는 안내가 나오는지 확인
- `main/player*` 플레이어 페이지에서는 패널이 계속 보이고 실제 자막 수집이 시작되는지 확인
- 패널에서 `자막 모으기` 직후 AI 자막 레이어가 자동으로 열리는지 확인
- 패널 상단의 큰 `실시간 내용` 영역이 먼저 보이는지 확인
- `수집된 자막` 목록에서 같은 `.smi_word`가 보정될 때 카드가 재생성되지 않고 제자리 갱신되는지 확인
- 본회의(`xcode=10` 또는 `xcgcd=DCM000010...`) 페이지에서는 container fallback 내부 raw가 commit/diff 용으로 전체 보존되고, 화면 preview 는 `400자/3줄` tail 로 짧게 표시되는지 확인
- fallback-only 자막은 같은 normalized raw가 2회 이상 또는 400ms 이상 안정적으로 관측된 뒤 `sourceCaptureMode: "fallback"` entry 로 commit 되고, 그 전에는 저장/export 대상이 아닌지 확인
- structured row snapshot 안에 stable/unstable row가 함께 있을 때 stable row만 `수집된 자막` 목록과 저장/export 대상에 반영되고 unstable row는 preview-only로 남는지 확인
- `로딩중..`, `로딩 중...`, `Loading...` 같은 placeholder 문구가 저장/export/누적 목록에 들어가지 않는지 확인
- 동일한 carry-over 문장이 반복 노출되더라도 export 결과에서 한 번만 남는지 확인
- 패널의 `저장 / 내보내기` 버튼에서 `텍스트(TXT) / 자막(SRT) / 웹자막(VTT) / 기록(JSON)` 저장 확인
- history의 `Markdown / CSV` 저장, 선택 export, 중요 표시만 export, 시간 범위 export 확인
- observer 가 먼저 처리한 row 를 polling/top-frame fallback 이 다시 봐도 중복 entry 가 생기지 않는지 확인
- 수집 중 새로고침/페이지 이동 시 브라우저 경고가 뜨는지 확인
- 탭 숨김 또는 페이지 이탈 직전 마지막 running/stopped 스냅샷이 저장되는지 확인
- 패널 / popup의 수동 저장과 export 가 현재 화면 렌더 window와 무관한 세션 전체 committed `entries` 를 기준으로 동작하고, 안정 관측 전 preview-only `실시간 내용`은 저장 대상으로 승격하지 않는지 확인
- service worker 재기동 또는 nonce mismatch 뒤에도 iframe forwarding 수집이 새로고침 없이 다시 수렴하는지 확인
- popup 에서 `페이지 패널 열기`, `저장된 기록`, `환경 설정`, `수집 진단` 이동 확인
- popup `지금 저장` 버튼이 persistable content가 없으면 비활성화되고, 빈 저장 요청 시 `저장할 자막이 아직 없습니다.` 피드백이 보이는지 확인
- history 검색 / 최근 N줄 복사 / 전체 내용 복사 / 찾은 내용 복사 확인
- 페이지 패널의 `최근 N줄 복사`가 현재 화면 row가 아니라 누적 세션 기준으로 history와 같은 결과를 주는지 확인
- 패널 notice 가 기본 idle 상태에서는 숨고, 수동 클릭 안내 / 자동 조정 / reset 복구 / 오류·액션 feedback 은 실제 텍스트로 보이는지 확인
- preview-only 또는 notice-only 상태에서도 패널 `화면 비우기`는 활성화되고 저장/복사/export 는 계속 비활성화되는지 확인
- history 즐겨찾기 토글 / 즐겨찾기만 보기 / 세션 메모 저장 확인
- 수집 중이거나 stale selection 상태의 history detail 에서 즐겨찾기/메모를 저장해도 최신 subtitle count / status / entries 가 되돌아가지 않는지 확인
- history entry 체크박스 기반 `선택한 항목 복사`, `선택 TXT/SRT/VTT/JSON` export 확인
- history 목록이 lineage summary 기준으로 표시되고, 즐겨찾기/핀/메모/삭제/export 작업이 lineage 전체 segment 에 적용되는지 확인
- lineage export 예상 용량이 `8 MiB` 를 넘는 경우 `segment-001` suffix 기반 분할 저장 액션이 보이는지 확인
- history `전체 JSON 백업` 과 `JSON 가져오기`(단일 세션 / bundle) 확인
- history `전체 JSON 백업` 이 service worker `DOWNLOAD_REQUEST` 대형 본문 전달 없이 page Blob URL 다운로드로 시작되는지 확인
- history `JSON 가져오기`에서 incoming `running` 레코드가 `saved`로 정규화되어 stale `수집 중` 배지가 남지 않는지 확인
- history `전체 JSON 백업` / `JSON 가져오기` 중 현재 단계, 진행량, 취소 버튼이 노출되고 중복 JSON 작업만 잠기는지 확인
- `JSON 가져오기` 취소 시 이미 저장된 일부 레코드는 유지되고 부분 완료 요약 메시지가 표시되는지 확인
- `JSON 가져오기`를 파일 읽기 단계에서 바로 취소하면 0건 요약 대신 즉시 취소 메시지가 보이고, 일부 write 이후 취소일 때만 부분 완료 요약이 보이는지 확인
- options 페이지에서 자동 저장, 자동 스크롤, noise filter, 중복 차단 최소 길이, 저장 파일 이름 규칙 검증 확인
- options 숫자 필드가 정수만 허용하고 소수 입력에는 inline 오류를 표시하며 저장을 막는지 확인
- options segment preset(`stability` / `balanced` / `capacity` / `custom`)이 threshold 값을 반영하고, 숫자 필드를 직접 수정하면 `custom`으로 전환되는지 확인
- export filename 생성 시 금지 문자가 여러 개 있어도 모두 제거되는지 확인
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
2. 국회 `main` / `main/` 홈과 `main/player*` 플레이어 페이지에서 패널이 자동으로 나타나는지
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
Compress-Archive -Path dist\* -DestinationPath korea-assembly-cc-chrome-1.0.9-cws.zip -Force
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
- `sidePanel`
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
- `downloads` 권한은 TXT/SRT/VTT/JSON/Markdown/CSV 파일 저장용
- `storage` 권한은 설정, 세션 저장 fallback, page-exit replay queue, 탭 단위 frame-forward nonce, 저장 복구 diagnostics 용
- `storage` 는 즐겨찾기/메모/태그/카테고리/발언자 라벨/중요 표시/entry note/labels 같은 로컬 메타데이터와 JSON 가져오기 후 복원된 기록 저장에도 사용됨
- `sidePanel` 권한은 Chrome 114+의 브라우저 측면 보조 패널을 열기 위한 용도이며, 국회 의사중계 탭을 유지한 채 수집 상태, 최근 자막, 저장/기록/설정 바로가기를 확인하게 합니다. 기존 in-page panel이 기본 UI이고, side panel은 추가 웹사이트 접근/외부 전송/영상 캡처에 사용하지 않습니다.

## 7. 릴리스 체크리스트

- `package.json` 버전 증가
- `manifest.json` 버전 증가
- `npm run check:version` 통과
- `npm run check:injected` 통과
- `npm run lint` 통과
- `npm run typecheck` 통과
- `npm run test` 통과
- `npm run build` 통과
- `npm run verify` 통과
- `npm run test:e2e:extension` 통과
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
2. content script 가 `https://assembly.webcast.go.kr/main`, `https://assembly.webcast.go.kr/main/`, `https://webcast.assembly.go.kr/main`, `https://webcast.assembly.go.kr/main/`, 각 도메인의 `main/player*` 에서 동작하는지
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
22. 패널 notice 가 기본 idle 상태에서는 숨고, 수동 클릭 안내 / 자동 조정 / reset 복구 / 오류·액션 feedback 은 실제 텍스트로 보이는지
23. preview-only 또는 notice-only 상태에서도 패널 `화면 비우기`는 활성화되고 저장/복사/export 는 비활성화되는지
24. 수집 중 history 에서 즐겨찾기/메모를 저장해도 더 최신 subtitle entry / status 가 되돌아가지 않는지
25. `JSON 가져오기`를 파일 읽기 단계에서 바로 취소하면 즉시 취소 메시지가 보이고, 일부 write 이후 취소일 때만 부분 완료 요약이 노출되는지
26. history 의 대용량 작업 중 관련 버튼이 잠겨 중복 실행이 되지 않는지
27. options `저장 복구 상태`가 `queue write / replay / cleanup` phase별 오류를 각각 보여 주는지 확인
28. history 전체 검색, 태그/카테고리 필터, 중요 표시만 보기와 중요 표시만 export가 함께 동작하는지 확인
29. 시간 범위 export가 entry의 `startTime || timestamp` 기준으로 필터링되고 원본 세션을 변경하지 않는지 확인
30. side panel이 지원 탭에서 열리고, 미지원 환경에서는 `sidepanel.html` fallback으로 열리는지 확인

## 9. 자주 발생하는 문제

### 9.1 확장을 로드했는데 페이지 패널이 보이지 않음

- 국회 페이지가 이미 열려 있었다면 새로고침이 필요할 수 있습니다.
- 최신 빌드는 기존 탭에 content script 재주입을 먼저 시도합니다.
- 대상 URL 이 `https://assembly.webcast.go.kr/main`, `https://assembly.webcast.go.kr/main/`, `https://webcast.assembly.go.kr/main`, `https://webcast.assembly.go.kr/main/`, 각 도메인의 `main/player*` 범위인지 확인합니다.

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

- 현재 범위에는 `영상 캡처`, 외부 AI 요약, 외부 전송 기능이 포함되지 않습니다.
- 이번 배포는 검색 / 복사 / autosave UX 외에 자막 자동 활성화, 본회의 fallback 누적 표시, placeholder 필터링 하드닝, 중요 표시, 발언자/entry 메타데이터 편집도 포함합니다.

## 10. 권장 운영 방식

- 개발 빌드는 unpacked 로 검증
- 배포 빌드는 항상 새 `dist/` 를 생성
- 스토어 제출용 zip 은 매번 새로 생성
- 릴리스 태그나 커밋 메시지에 manifest 버전을 같이 남김

## 2026-03-11 Release Gate Update

Before packaging a release ZIP, run the full validation path:

```bash
npm run verify
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

- 본회의(`xcode=10` / `xcgcd=DCM000010...`) container fallback에서는 commit/diff 용 내부 raw 원문을 전체 보존하고, 화면 preview 는 tail formatter 로 짧게 유지합니다.
- structured row가 비어 있어도 본회의 fallback capture는 안정 관측 뒤 commit된 entry를 `수집된 자막` 목록으로 계속 표시합니다.
- `로딩중..`, `로딩 중...`, `Loading...` placeholder는 commit/persist/export 대상에서 제외합니다.
- Chrome Web Store 제출용 압축 예시는 `korea-assembly-cc-chrome-<version>-cws.zip` 형식을 권장합니다.
- 수동 저장 / export 와 pagehide/beforeunload/stop 계열 persistence 는 현재 화면에 보이는 `300건` 렌더 window가 아니라 세션 전체 committed subtitle 목록을 기준으로 검증해야 합니다.
- 하늘색 등 불투명 배경이나 background-image highlight 가 남아 있는 `인식 중` 자막은 commit/persist/export 대상에서 제외되는지 확인해야 합니다.
- History favorites/notes, partial copy/export, full JSON backup/import, and live capture diagnostics are part of current release baseline.
- full-library `JSON 백업` / `JSON 가져오기` 는 단계별 진행률과 취소를 제공하며, import cancel 은 partial completion 을 허용합니다.
- 기본 idle notice 는 숨기되, 수동 클릭 안내 / 자동 조정 / reset 복구 / 오류·액션 notice 는 패널에 실제 텍스트로 노출됩니다.
- 패널 `화면 비우기` 는 저장 가능 여부와 별도 gating 을 사용해 preview-only / notice-only 상태에서도 직접 reset 할 수 있습니다.
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

- Release verification should confirm that a fresh `start -> stop` cycle with no captured rows does not leave an orphan persisted `running` session, and that preview-only / keepalive-only runtime activity does not autosave an empty `running` record.
- Release verification should confirm that favorited / noted sessions keep `starred`, `pinnedAt`, and `note` metadata after autosave, page-exit persistence, and final stop-save flows.
- page-exit persistence is now ordered as `queue replay record -> background persist request`; regression coverage for that ordering is part of release confidence.
- History validation should cover store-level paging, live refresh via `SESSION_LIBRARY_REVISION_STORAGE_KEY`, and note-draft preservation during same-session refreshes.
- Popup and options initial render should be validated from lightweight `CAPTURE_STATUS` alone, including subtitle count, char count, preview text, and recent entry hydration. Export estimates should be validated only through `GET_DIAGNOSTICS_STATUS`.
- The current pre-release gate remains `npm run verify`.

## 2026-03-19 Deployment Consistency Update

- Release verification should confirm that frame-forward nonce state survives MV3 service worker restarts via `chrome.storage.local` and converges again without requiring a page reload.
- Release verification should confirm that queued exit persist reads merge storage and memory snapshots, and that a storage write failure does not silently drop the in-memory replay candidate.
- Release verification should confirm that when content-side queue storage write fails during page exit, the background path still attempts one more durable queue write before only the background persist remains.
- History validation should confirm that explicit discard confirmation on refresh / `즐겨찾기만 보기` filter change actually restores the saved note instead of leaving the dirty draft in place.
- Options validation should confirm that `저장 복구 상태` shows `queue write`, `replay`, `cleanup`, and summary errors separately when they are present.
- Popup validation should confirm that `지금 저장` is disabled when `hasPersistableContent` is false, and that forced empty saves still yield `저장할 자막이 아직 없습니다.` feedback.
- Subtitle activation validation should confirm that merely showing `#viewSubtit` is not enough; success requires visible text or an active control signal.

## 2026-04-07 Deployment Consistency Update

- Release verification should confirm that `수집된 자막` 저장/export 기준이 live ledger cap 과 무관한 세션 전체 누적 committed subtitle 목록임을 유지합니다.
- Release verification should confirm that 회의명 파서는 trailing `|` branding 만 제거하고 날짜 / 회차 / 하이픈 텍스트를 보존합니다.
- Release verification should confirm that subtitle visibility 판정은 `display:none`, `visibility:hidden`, `opacity:0`, zero-rect 를 동일하게 hidden 으로 처리합니다.

## 2026-04-20 Deployment Consistency Update

- Release verification should confirm that subtitle auto-activation still succeeds when visible control과 실제 `#viewSubtit` / 자막 텍스트가 서로 다른 accessible frame에 있어도 같은 상태로 집계됩니다.
- Release verification should confirm that options `수집 진단` 탭이 `persistabilityState` / `persistabilityHint` 를 표시하고, `preview_only`, `unstable_only`, `filtered`, `duplicate`, `persistable` 상태가 실제 런타임과 일치합니다.
- Release verification should confirm that in-page `수집된 자막` 목록은 최신 `300`건까지만 렌더하지만 저장 / export / history / 최근 N줄 복사 기준은 전체 committed session 을 계속 사용합니다.
- Release verification should confirm that full-library `JSON 백업` / `JSON 가져오기` 는 `25 MiB` 초과 payload에서 명시적 오류로 즉시 중단됩니다.
- Release verification should confirm that popup 은 현재 창 active tab 을 따라 재연결하고, diagnostics `tabId` 대상이 닫히거나 unsupported 가 되면 다른 supported assembly tab 으로 fallback 합니다.
- Release verification should confirm that Blob export fallback 은 Blob URL 생성 실패 또는 Blob download 실패에서만 `data:` 경로로 내려가고, metadata persist 실패만으로 중복 다운로드를 다시 열지 않습니다.

## 2026-04-21 Deployment Consistency Update

- Release verification should confirm that session import sanitize normalizes unsupported `sourceUrl` to an empty string, and history `원본 페이지 열기` is disabled/blocked for unsupported URLs.
- Release verification should confirm that unconfirmed container fallback blocking emits the `blockedByUnconfirmedFilter` signal and that local polling / top fallback / injected observer all relax fallback after `6` consecutive blocked probes.
- Release verification should confirm that unconfirmed block streak resets immediately when subtitle text recovers and is not reset by neutral misses without text.
- Release verification should confirm that non-plenary fallback internal raw keeps a `4KB` tail window, plenary fallback internal raw preserves the full diff/commit raw, and panel/popup preview still uses the `400자/3줄` tail-oriented display semantics.
- Release verification should confirm that single-session export keeps no hard size cap, and known transport/download failures (`message length exceeded`, `invalid data URL` class) are surfaced as user-friendly guidance.
- Release verification should confirm that frame-forward nonce mismatch triggers immediate nonce resync plus fast top-frame fallback probing to recover dropped bridge events.

## 2026-04-22 Deployment Consistency Update

- Release verification should confirm that the in-page panel appears immediately on supported `main` and `main/` home URLs, while actual capture start is still allowed only on `main/player*` pages.
- Release verification should confirm that options `수집 진단` shows current segment threshold usage and TXT/SRT/VTT/JSON estimated export sizes for the active player tab.
- Release verification should confirm that runtime segmentation thresholds (`세그먼트 최대 문장/글자/시간`) can be edited in options and affect later roll-over decisions.
- Release verification should confirm that large export downloads use the offscreen Blob chunk path first, and that payloads above the bounded `data:` fallback path surface the explicit large-export guidance instead of attempting an impractical fallback.
- Release verification should confirm that full-library JSON backup uses the history page Blob URL helper and revokes the Blob URL after completion, interruption, or timeout.
- Release verification should confirm that JSON single-session export and backup/import preserve `lineageId` and `segmentNumber`, while older JSON without those fields still imports.
- Release verification should confirm that `pendingPreviews` are not materialized into saved or exported entries.

## 2026-04-28 Deployment Consistency Update

- Release verification should include `check:version`, `check:injected`, `lint`, `typecheck`, `test`, and `build` via `npm run verify`.
- Local Chrome extension smoke should be run with `npm run test:e2e:extension` before store submission or large capture-path changes.
- Release verification should confirm fallback-only conservative commit behavior: 2 repeated observations or 400ms stable raw before `sourceCaptureMode: "fallback"` entry creation.
- Release verification should confirm structured rows clear pending fallback candidates and committed structured entries carry `sourceCaptureMode: "structured"`.
- Release verification should confirm SPA URL transitions start/stop capture pipeline once, and running sessions are stopped/persisted before changing capture URL state.
- Release verification should confirm history defaults to lineage summary list and lineage metadata/delete/export operations apply to all segments.
- Release verification should confirm lineage export split download uses segment suffixes such as `segment-001`.
