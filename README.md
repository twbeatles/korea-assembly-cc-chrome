# 국회 AI 자막 추출기 Chrome Extension

<p align="center">
  <img src="public/icons/icon128.png" alt="국회 AI 자막 추출기 아이콘" width="128" />
</p>

기존 `PyQt6 + Selenium` 데스크톱 앱을 `Chrome Extension (Manifest V3) + TypeScript + React + Vite` 구조로 재설계한 저장소입니다. 목표는 국회 의사중계/생중계 페이지에서 AI 자막을 실시간으로 수집하고, 페이지 오른쪽 패널에서 바로 보여 주며, 모은 내용을 `TXT / SRT / VTT / JSON`으로 저장하는 최소 실용 버전을 제공하는 것입니다.

현재 스토어 배포 준비 기준 버전은 `1.0.7` 입니다.


## 기술 선택

- 빌드 도구: `Vite + @crxjs/vite-plugin`
- 언어: `TypeScript`
- UI: `React`
- 스타일링: 페이지별 scoped CSS 파일
- 테스트: `Vitest`
- 린트/포맷: `ESLint + Prettier`

`Vite`를 선택한 이유는 popup/options/history 같은 multi-entry HTML 제어가 쉽고, MV3 manifest를 직접 관리하면서도 순수 TypeScript 모듈 테스트와 빌드 구성을 간결하게 유지할 수 있기 때문입니다.

## 주요 기능

- 국회 의사중계 페이지의 AI 자막 실시간 추출
- `실시간 내용 / 수집된 자막` 2단 표시
- `MutationObserver` 우선 + polling fallback
- `.smi_word` nodeKey + framePath 기반 live row ledger 추적, 같은 row 제자리 보정, 컨테이너 fallback, 접근 가능한 iframe/frame 순회
- content script는 `https://assembly.webcast.go.kr/main`, `https://assembly.webcast.go.kr/main/`, `https://webcast.assembly.go.kr/main`, `https://webcast.assembly.go.kr/main/`, 각 도메인의 `main/player*` 에서 로드되며, 패널은 홈(`main`/`main/`)에서도 바로 보이고 실제 자막 수집 시작은 플레이어(`main/player*`)에서만 허용됩니다
- 접근 가능한 frame 전체의 `#viewSubtit`, 자막 텍스트, 자막 control active 상태를 함께 집계해 레이어 활성화 성공을 판정
- 본회의(`xcode=10` 또는 `xcgcd=DCM000010...`) container fallback에서는 증분 비교/커밋용 내부 raw 누적 원문을 전체 보존하고, 화면 preview는 `400자/3줄` tail 의미론으로 짧게 표시합니다
- history 가져오기 sanitize 단계에서 지원하지 않는 `sourceUrl`은 빈 문자열로 정규화하고, `원본 페이지 열기`는 지원 URL일 때만 허용합니다
- unconfirmed 필터로 container fallback이 연속 차단되면 6회째부터 fallback을 일시 허용해 수집 복원력을 높입니다
- 비본회의 container fallback 내부 원문은 `4KB` tail cap으로 유지하고, 본회의는 전체 raw를 보존합니다. 패널/팝업 표시용 preview는 URL과 무관하게 짧게 분리합니다
- fallback-only 자막은 같은 normalized raw가 2회 이상 또는 400ms 이상 안정적으로 관측된 뒤 확정 entry로 커밋되며, 커밋된 뒤에는 자동 저장/수동 저장/export/history에서 일반 자막과 동일하게 처리됩니다
- 단일 세션 export는 하드 용량 제한 없이 시도하되, `message length exceeded`/`invalid data URL`/`large data URL fallback disabled` 계열 실패는 사용자 안내 문구로 매핑합니다. lineage export 예상 용량이 `8 MiB`를 넘으면 history에서 segment별 분할 저장을 제공합니다
- frame-forward nonce mismatch 시 즉시 nonce 재동기화와 빠른 top-frame fallback probe를 함께 수행합니다
- `normalized capture event -> live ledger -> preview / normalize / gate`
- 글로벌 히스토리 + `rfind` suffix 기반 증분 추출
- keepalive 기반 마지막 자막 `endTime` 갱신
- `subtitle_reset` 처리
- 저장된 기록 관리
- `TXT / SRT / VTT / JSON` 내보내기
- 사이트 안 우측 패널에서 실시간 자막 확인
- 수집 시작 시 AI 자막 레이어 자동 활성화 시도
- AI 자막 레이어 자동 활성화 성공은 `visible && (hasText || controlActive)` 신호 기준으로 판정
- MV3 service worker 재기동 뒤에도 storage-backed frame-forward nonce + 주기적 재동기화로 iframe forwarding 복구
- 페이지 패널 / history에서 최근 `N`줄 복사
- 페이지 패널의 `최근 N줄 복사`는 history와 같은 의미로 현재 세션에 누적된 최근 `N`줄을 기준으로 동작
- `autoScroll`, 중복 차단 최소 길이, 한글/영문 중심 noise filter 토글 등 옵션 반영
- popup 보조 화면
- popup의 `지금 저장` 버튼은 실제 저장 가능한 상태에서만 활성화되며, 빈 저장 요청에는 명시적 안내를 표시합니다
- history 기록 내부 검색 / 복사 / 즐겨찾기 / 세션 메모
- history 목록은 기본적으로 회의 lineage 단위 summary를 표시하며, 즐겨찾기/핀/메모/삭제/export 작업은 lineage 전체 segment에 적용됩니다
- history 상세 entry 체크박스 기반 부분 선택 복사 / 부분 export
- 저장된 기록 전체 JSON 백업 / JSON 가져오기
- history는 store-level 페이지네이션을 사용하며, 전체 JSON 백업 / JSON 가져오기는 단계별 진행률과 취소를 제공합니다
- 전체 라이브러리 `JSON 백업` / `JSON 가져오기` 는 `25 MiB` 이하 payload에서만 지원합니다
- options의 저장 파일 이름 규칙은 금지 문자와 지원하지 않는 placeholder를 저장 전에 검증하고, export 직전에는 남은 금지 문자를 전역 제거해 한 번 더 정리합니다
- options의 숫자 설정은 정수만 허용하며, 소수 입력은 inline 오류로 저장을 막습니다
- options에서는 auto segmentation preset(`stability` / `balanced` / `capacity` / `custom`)과 threshold(`세그먼트 최대 문장/글자/시간`)를 조정할 수 있습니다
- `로딩중..`, `로딩 중...`, `Loading...` 같은 placeholder 문구는 수집된 자막/저장/export 대상에서 제외합니다
- 실행 중 자동 저장 설정 및 수집 진단 화면에서 최근 저장 시각, queue write / replay / cleanup phase별 저장 복구 오류 확인
- 수집 진단은 `persistabilityState` / `persistabilityHint`를 포함해 `preview_only`, `unstable_only`, `filtered`, `duplicate`, `persistable` 상태를 구분합니다
- 패널 / popup 에서 수집 진단 화면 진입
- popup / options 수집 진단은 현재 창의 활성 탭을 기준으로 재연결하며, 지정한 진단 탭이 사라지면 다른 지원 탭으로 fallback 합니다
- 페이지 패널 / options / history UI
- 페이지 패널의 `수집된 자막` 렌더는 최신 `300`건까지만 유지하고, 세션 전체 기록 / 저장 / export 기준은 그대로 유지합니다
- **크롬 확장프로그램 전용 아이콘 세트 적용(16, 32, 48, 128px)**
- 최소 단위 테스트

## 자막 및 내보내기 정합성

- SRT는 세션 시작 시각 기준 상대 cue time을 `HH:MM:SS,mmm` 형식으로 출력합니다
- VTT는 세션 시작 시각 기준 상대 cue time을 `HH:MM:SS.mmm` 형식으로 출력합니다
- JSON은 세션 전체 복원을 위해 `id`, `version`, `sourceUrl`, `startedAt`, `endedAt`, `lineageId`, `segmentNumber`, `entries`를 항상 포함합니다
- 중복 문장은 실시간 수집 단계에서 먼저 차단하고, export 정규화는 마지막 안전망으로만 한 번 더 적용합니다
- 동일 raw가 반복되는 구간은 keepalive로 마지막 entry의 `endTime`만 연장합니다
- 패널 / popup의 수동 저장과 파일 내보내기는 확정되어 `state.entries`에 들어간 `수집된 자막` 누적 목록만 사용합니다
- fallback preview는 같은 normalized raw가 2회 이상 또는 400ms 이상 안정적으로 관측된 뒤 `sourceCaptureMode: "fallback"` entry로 커밋되고, 그 전까지는 저장/export 대상으로 승격하지 않습니다
- 자동 저장, 중지, pagehide / beforeunload 직전 snapshot도 preview-only 텍스트를 materialize 하지 않고 확정 entry만 저장합니다
- structured row snapshot에 stable/unstable row가 함께 있어도 stable row만 `sourceCaptureMode: "structured"`로 commit되고 unstable row는 preview-only로 남습니다
- 하늘색 등 배경 highlight 또는 background-image highlight가 남아 있는 `인식 중` 자막은 확정 전까지 commit / 저장 / export 대상에서 제외합니다

## 1차 범위

- 이미 열린 `https://assembly.webcast.go.kr/main`, `https://assembly.webcast.go.kr/main/`, `https://webcast.assembly.go.kr/main`, `https://webcast.assembly.go.kr/main/`, `https://assembly.webcast.go.kr/main/player*`, `https://webcast.assembly.go.kr/main/player*` 페이지 지원
- 페이지 오른쪽 패널에서 시작 / 중지 / 저장 / 파일 저장
- options에서 수집 설정 조정
- history에서 저장된 기록 목록, 삭제, 재열기, 즐겨찾기, 세션 메모, 파일 저장, 기록 내부 검색 / 복사
- history에서 선택 entry 기준 부분 복사 / 부분 export, 전체 JSON 백업 / JSON 가져오기
- history의 `전체 삭제`는 현재 화면이 아니라 저장소 전체를 기준으로 동작하고, 선택 삭제는 성공/실패 건수를 요약해 표시합니다

## 제외 범위

- PyQt6 GUI
- Selenium / WebDriver
- SQLite 직접 운용
- DOCX / HWP / RTF
- 데스크톱 병합 UI
- 데스크톱 단축키 체계
- 고급 preset / xcode -> xcgcd 자동 보완 UX
- 영상 캡처
- 중요 표시 / 발언자 편집

## 저장소 구조

```text
manifest.json
src/
  background/
  content/
  core/
  history/
  options/
  popup/
  shared/
  storage/
tests/
```

현재 Git 추적 기준의 핵심 문서는 루트의 `README.md`, `CLAUDE.md`, `GEMINI.md`, `DEPLOYMENT.md`, `CODEBASE_AUDIT.md`, `CAPTURE_RETENTION_AND_STABILITY.md`, `CHROME_WEB_STORE_PERMISSION_JUSTIFICATIONS.md`, `PRIVACY_POLICY_DRAFT_KO.md` 입니다. 과거 Python 데스크톱 아카이브나 종료된 구현 계획 문서는 로컬 작업 환경에만 남아 있을 수 있으며 Git 추적 대상으로 전제하지 않습니다.

- `DEPLOYMENT.md`
- `CLAUDE.md`
- `GEMINI.md`
- `CODEBASE_AUDIT.md`
- `CAPTURE_RETENTION_AND_STABILITY.md`
- `CHROME_WEB_STORE_PERMISSION_JUSTIFICATIONS.md`
- `PRIVACY_POLICY_DRAFT_KO.md`

## 설치 방법

### 1. 의존성 설치

```bash
npm install
```

### 2. 개발 서버

```bash
npm run dev
```

`dev` 스크립트는 page-world observer 번들(`public/injected-observer.js`)을 먼저 생성한 뒤 Vite를 실행합니다.

### 3. 테스트

```bash
npm run test
```

정적 점검까지 포함한 기본 검증은 아래 명령을 기준으로 합니다.

```bash
npm run check:version
npm run check:injected
npm run lint
npm run typecheck
npm run test
npm run build
```

커버리지 threshold까지 포함한 회귀 검증은 아래 명령을 추가로 사용합니다.

```bash
npm run test:coverage
```

### 4. 빌드

```bash
npm run build
```

빌드 결과물은 `dist/`에 생성됩니다.

## 크롬에서 unpacked extension 로드하기

1. `npm run build`
2. Chrome 주소창에 `chrome://extensions` 입력
3. 우측 상단 `개발자 모드` 활성화
4. 좌측 상단 `압축해제된 확장 프로그램을 로드합니다(Load unpacked)` 버튼 클릭
5. 저장소의 `dist/` 폴더 선택
6. 확장프로그램 툴바에 새롭게 추가된 **국회 로고+CC(자막)** 아이콘이 표시되는지 확인
7. 브라우저 우측 상단의 퍼즐 조각 아이콘 확장 프로그램 목록에서 `국회 AI 자막 추출기`를 핀 고정
8. 국회 의사중계 `main` / `main/` 홈 또는 `main/player*` 페이지를 열고 새로고침하면 오른쪽에 패널이 자동으로 나타납니다. 홈(`main`/`main/`)에서는 패널/진단 UI가 바로 보이고, 실제 자막 수집은 플레이어(`main/player*`)에서만 시작할 수 있습니다.

## 사용 방법

1. `https://assembly.webcast.go.kr/main`, `https://assembly.webcast.go.kr/main/`, `https://webcast.assembly.go.kr/main`, `https://webcast.assembly.go.kr/main/`, `https://assembly.webcast.go.kr/main/player*`, `https://webcast.assembly.go.kr/main/player*` 중 지원 페이지를 연다
2. 페이지 오른쪽의 `국회 자막 도우미` 패널을 확인한다
3. 홈(`main`/`main/`)에서는 패널과 진단 UI만 먼저 확인하고, 실제 수집은 플레이어(`main/player*`)로 들어간 뒤 `자막 모으기`를 눌러 시작한다
4. 확장은 `AI 자막보기` 레이어를 자동으로 열려고 시도하며, 레이어/텍스트/control 신호는 접근 가능한 frame 전체를 기준으로 판정한다. 레이어가 실제로 보이고 텍스트 또는 활성화 control 신호가 확인되지 않으면 패널 notice 로 수동 클릭 안내를 실제 텍스트로 표시한다. 기본 idle 안내만 숨기고, 오류/복구/자동 조정 notice 는 패널에서 바로 확인할 수 있다
5. `실시간 내용`은 패널 상단의 큰 미리보기 영역에서 먼저 확인하고, 바로 아래 `수집된 자막`에서 확정된 누적 목록의 최신 `300`건 렌더를 본다. 본회의처럼 structured row 대신 container fallback으로만 잡히는 경우에도 안정 관측 뒤 commit된 entry가 이 목록에 남고, 전체 세션 기록 / 저장 / export 기준은 누적 committed entry 전체를 그대로 유지한다
6. 필요하면 패널의 `저장 / 내보내기` 버튼으로 `텍스트(TXT) / 자막(SRT) / 웹자막(VTT) / 기록(JSON)` 저장을 실행한다. 수동 저장 / 내보내기는 확정된 `수집된 자막` 누적 목록만 기준으로 하며, fallback preview는 같은 normalized raw가 2회 이상 또는 400ms 이상 안정적으로 관측된 뒤에만 저장 대상으로 승격한다. 반대로 preview-only 상태나 notice-only 오류 상태에서도 `화면 비우기`로 패널을 직접 리셋할 수 있다
7. 실행 중 세션이 현재 threshold(`balanced` 기본값: 2000문장 / 120000자 / 90분, options preset/숫자 필드에서 조정 가능)를 넘기면, 현재 구간을 저장한 뒤 같은 lineage의 다음 `세그먼트`로 자동 전환한다
8. 필요하면 페이지 패널 또는 history에서 `최근 N줄 복사`를 실행한다. 페이지 패널에서도 현재 화면 조각이 아니라 세션에 누적된 최근 `N`줄을 복사한다
9. `멈추기`를 누르면 수집이 끝나고 저장소 fallback 정책에 따라 정지 상태로 저장된다
10. 직전 stopped 세션 저장이 실패한 상태에서 다시 `자막 모으기` 또는 `화면 비우기`를 시도하면, 확장은 먼저 저장을 재시도하고 계속 실패할 때만 폐기 확인을 묻는다
11. 브라우저/확장을 다시 시작하면 먼저 page-exit 시점에 남겨둔 stopped 저장 replay queue를 복구하고, 그 다음 남아 있던 `running` 세션을 `stopped`로 정리한다
12. history에서는 회의 lineage 단위 목록에서 `즐겨찾기`, `메모 저장`, 삭제, lineage export를 사용할 수 있고, 상세 화면에서는 segment 목록과 개별 segment entry 체크박스 기반 `선택한 항목 복사`, `선택 TXT/SRT/VTT/JSON` export를 유지한다. 대용량 lineage는 `segment-001` suffix가 붙은 분할 저장을 실행할 수 있다
13. history 상단에서는 저장된 기록 전체 `JSON 백업`과 단일 세션/번들 `JSON 가져오기`를 실행할 수 있으며, 두 작업 모두 현재 단계와 진행량을 표시하고 취소를 지원한다. 가져오기는 허용 필드만 sanitize 하고 지원하지 않는 wrapper version / 잘못된 timestamp를 거부하며, 취소 시 이미 저장된 일부 레코드는 유지된다. 전체 라이브러리 작업은 `25 MiB` 하드 제한을 넘기면 명시적 오류로 중단된다
14. 확장 아이콘 popup은 `페이지 패널 열기`, `저장된 기록`, `환경 설정`, `수집 진단`을 빠르게 여는 보조 화면으로 사용하며, 상세 진단은 options 페이지의 `수집 진단` 탭과 `저장 복구 상태` 섹션에서 확인한다. 진단 화면에서는 `persistabilityState` / `persistabilityHint`로 preview-only, unstable-only, filtered, duplicate 상태를 구분하고, stable/unstable row 수, unconfirmed 필터 차단 수, row key source, fallback commit 상태, 현재 세그먼트 threshold 사용량과 포맷별 예상 export 크기도 함께 본다
15. 현재 세션에 저장 가능한 내용이 없으면 popup의 `지금 저장` 버튼은 비활성화되며, 우회 호출이 들어와도 패널과 popup 모두 `저장할 자막이 아직 없습니다.` 문구로 일관되게 응답한다

주의:
- 수집 중 페이지를 이동하거나 새로고침하면 브라우저가 경고를 표시합니다.
- 탭이 숨겨지거나 페이지를 떠날 때도 preview-only 텍스트를 entry로 flush 하지 않고, 확정 자막만 포함한 running/stopped 스냅샷을 background에 넘겨 자동 저장을 시도합니다.

## 권한 설명

- `storage`: options, 저장된 세션 본문, 즐겨찾기/메모 같은 세션 메타데이터, page-exit replay queue, phase별 저장 복구 diagnostics, 탭 단위 frame-forward nonce 저장
- `downloads`: TXT/SRT/VTT/JSON 파일 다운로드
- `offscreen`: 대용량 export용 Blob URL 생성
- `activeTab`: 현재 탭 상태 조회
- `scripting`: MV3 런타임 보조 권한
- `host_permissions: https://assembly.webcast.go.kr/*`, `https://webcast.assembly.go.kr/*`
  국회 의사중계 고정 도메인 2개만 대상으로 제한합니다

## 동작 구조

### content script

- 현재 탭에서 세션 상태를 보유합니다
- popup이 닫혀도 수집은 계속됩니다
- top frame에 우측 패널을 삽입해 현재 상태를 바로 보여 줍니다
- subframe content script는 background에서 탭 단위 frame-forward nonce를 bootstrap 받고, 15초 주기 및 nonce mismatch 시점에 다시 동기화합니다
- page-world `MutationObserver`, local polling, top-frame fallback을 모두 같은 `normalized capture event` 형태로 파이프라인에 전달합니다
- top frame에서는 `framePath + nodeKey` 기준 live row ledger를 유지하고, 같은 row 보정은 live view와 마지막 entry를 제자리 갱신합니다
- 본회의 fallback capture에서는 commit/diff용 container raw를 잘라내지 않고 유지하며, structured row가 비어 있어도 안정 관측 뒤 commit된 entry를 `수집된 자막` 패널 목록으로 재구성합니다
- 새 row는 바로 append하지 않고 carry-over trim과 글로벌 히스토리 비교를 거쳐 실제 신규 delta만 확정합니다
- structured row snapshot에서는 stable row만 commit이 발생하고, 같은 snapshot 안의 unstable row는 `실시간 내용` preview만 갱신합니다. raw/container fallback은 같은 normalized raw가 2회 이상 또는 400ms 이상 안정적으로 유지된 경우에만 fallback entry로 commit합니다
- 하늘색 등 불투명 배경이나 background-image highlight가 남아 있는 `인식 중` 자막은 미확정으로 보고 fallback/container 읽기와 commit 양쪽에서 제외합니다
- 수집 시작 시 page function 호출/버튼 클릭을 통해 AI 자막 레이어 활성화를 먼저 시도하며, 실제 성공은 `visible && (hasText || controlActive)` 기준으로 판정합니다
- 자막 레이어 판정에 쓰이는 `#viewSubtit`, 자막 텍스트, visible control active 상태는 접근 가능한 frame 전체를 함께 순회해 집계합니다
- 패널 notice는 기본 idle 안내만 숨기고, `정상 수집 / 자동 조정 중 수집 / reset 복구 중 / 수동 클릭 안내 / 오류·액션 피드백`을 실제 텍스트로 구분해 표시합니다
- 패널과 popup은 `수집 진단` 화면으로 이동하는 진입점을 제공하고, 상세 진단(`structured / fallback / polling`, observer, selector, frame path, 최근 저장 시각, 저장 복구 상태, 현재 세그먼트 threshold 사용량, 예상 export 크기)은 options 페이지의 `수집 진단` 탭에서 live 상태로 표시합니다
- 수집 진단에는 `persistabilityState` / `persistabilityHint`, stable/unstable row count, unconfirmed 필터 count, row key source, fallback commit 상태도 포함되며, panel/popup/options가 같은 이유 문구로 preview-only / unstable-only / filtered / duplicate 상태를 공유합니다
- stopped 세션 최종 저장이 실패하면 다음 `자막 모으기`/`화면 비우기` 전에 한 번 더 저장을 재시도하고, 계속 실패할 때만 사용자 확인 후 폐기합니다
- 저장 가능한 자막이 없을 때 `SAVE_SESSION` 요청은 조용히 무시하지 않고 패널/popup 모두 `저장할 자막이 아직 없습니다.` 피드백을 남깁니다
- 패널 `화면 비우기`는 저장/복사/export 와 별도 gating을 사용해, running 상태이거나 preview/notice가 남아 있을 때도 수동 reset 을 허용합니다

### injected observer

- page context에서 DOM 변화를 감시합니다
- `window.postMessage`로 `subtitle:update`, `subtitle:reset`, `subtitle:health`를 브리지합니다
- `subtitle:update`에는 raw preview 외에 `.smi_word` row 메타도 함께 실립니다
- 같은 `nodeKey`의 텍스트가 보정되면 새 key만 보내는 대신 현재 row 스냅샷 전체를 다시 보내 제자리 갱신을 가능하게 합니다

### pipeline

- `normalized capture event -> live reconcile -> normalize -> preview gate -> history/rfind suffix -> placeholder/noise filter -> merge/add`
- structured row 가 안정적으로 잡히면 row별 baseline과 글로벌 history를 함께 써서 commit/update를 분리하고, 아니면 raw/container fallback 안정 관측 후보로 내려갑니다
- `confirmedCompact`, `trailingSuffix`, history anchor, overlap fallback, soft resync 의미론을 유지합니다
- running capture 가 내부 threshold를 넘기면 현재 세션을 `saved` segment 로 저장한 뒤 같은 lineage 의 다음 running segment 로 자동 전환합니다
- recent compact tail 기반 중복 차단
- `로딩중..`, `로딩 중...`, `Loading...` 같은 placeholder 문구는 noise filter 설정과 무관하게 commit/persist/export 대상에서 제외합니다
- 기본 noise filter는 한글/영문 중심으로 언어 텍스트를 판정하며, 외국어 원문을 최대한 보존하려면 options에서 noise filter를 꺼야 합니다
- export 정규화는 마지막 안전망으로만 exact carry-over duplicate 를 한 번 더 정리합니다
- keepalive / reset / finalize 처리
- 자동 저장 / 중지 / pagehide 계열 prepared snapshot은 preview-only 텍스트를 materialize 하지 않고 이미 확정된 structured/fallback entry만 저장합니다

### storage

- 세션 본문은 `IndexedDB`를 우선 사용합니다
- `IndexedDB`에서는 세션 메타데이터와 `entries` 본문 chunk를 분리해 저장하며, 본문은 기본 `250개` 단위 chunk store로 관리합니다
- IndexedDB schema `5`부터 `lineageId` index 를 유지하며, migration 에서 기존 세션의 `lineageId` / `segmentNumber` 기본값을 채웁니다
- `IndexedDB` open/capability 실패 시에만 런타임 전체를 fallback 모드로 내리고, 개별 read/write 실패는 현재 연산만 `chrome.storage.local` per-session fallback으로 우회합니다
- `loadSession`/`listSessions`는 `IndexedDB`와 fallback 저장소를 함께 읽고, `updatedAt`이 더 최신인 레코드를 우선 사용합니다. 동률이면 `IndexedDB`를 우선합니다
- 같은 세션을 다시 저장할 때는 chunk digest를 비교해 바뀐 chunk만 갱신하고, 줄어든 세션은 초과 chunk만 삭제합니다
- 성공한 `IndexedDB` write/delete는 동일 id의 stale fallback copy를 best-effort로 정리합니다
- 두 저장소가 모두 실패하는 극단적 상황에서는 현재 런타임 동안 메모리 fallback을 유지합니다
- pagehide/beforeunload 직전 최종 stopped 스냅샷은 세션별 replay queue에도 함께 적재하고, background 저장이 성공하면 같은 세션의 stale queued snapshot을 즉시 정리합니다
- content script에서 replay queue storage write가 실패하면, background에도 동일 stopped snapshot queue 적재를 한 번 더 요청해 종료 직전 durable queue를 최대한 보존합니다
- replay queue 조회는 `chrome.storage.local` snapshot과 메모리 snapshot을 merge 하며, 같은 `sessionId` 충돌 시 `updatedAt`이 더 최신인 레코드와 동률 시 더 늦은 `queuedAt`을 우선합니다
- queue write가 실패해도 메모리 queue는 유지되며, `lastQueueWriteError`, `lastReplayError`, `lastCleanupError`, `lastError` diagnostics를 통해 phase별 실패를 추적합니다
- 브라우저/확장 cold start 시에는 queued stopped snapshot replay를 먼저 수행한 뒤 남아 있던 `running` 세션 cleanup을 진행하고, replay/cleanup 결과는 `chrome.storage.local` diagnostics snapshot으로 남깁니다
- JSON import는 허용 필드 재구성 기준으로 sanitize 하며, 지원하지 않는 backup wrapper version과 parse 불가능한 timestamp를 가져오기 단계에서 거부합니다
- JSON import는 들어오는 `running` 레코드를 모두 `saved`로 정규화해 실제로 종료된 기록이 `수집 중`으로 남지 않게 합니다
- 전체 JSON 백업은 페이지 단위로 라이브러리를 읽어 진행률을 갱신한 뒤 세션 단위 incremental packaging 동안에도 abort 를 확인하고, JSON 가져오기는 chunked file read -> JSON 파싱 -> sanitize/dedupe -> 저장 단계로 나눠 진행률과 취소를 처리합니다
- 전체 JSON 백업 다운로드는 history page 에서 Blob URL 로 직접 시작하며, 대형 payload 를 `DOWNLOAD_REQUEST` runtime message 로 service worker 에 보내지 않습니다
- 단일 세션 export는 content/history가 대형 문자열을 직접 background로 보내지 않고, `sessionId + 옵션`만 전달한 뒤 service worker가 저장소에서 세션을 읽어 조립합니다
- lineage 전체 export도 history가 `lineageId + 옵션`만 넘기고, service worker가 segment들을 병합해 조립합니다
- 단일 JSON export 와 backup/import sanitize 경로는 `lineageId`, `segmentNumber` 를 보존하고, 기존 JSON 에 두 필드가 없으면 기본값을 적용합니다
- 전체 라이브러리 `JSON 백업` / `JSON 가져오기` 는 모두 `25 MiB` 하드 제한으로 보호되며, 이를 넘기면 부분 진행 없이 명시적 오류로 중단합니다
- 설정은 `chrome.storage.local`
- `filenamePattern` 은 `{date}`, `{committee}`, `{time}` 만 허용하며, 금지 문자가 있으면 options에서 저장을 막고 export 직전에도 남은 금지 문자를 모두 제거합니다
- 숫자 설정은 모두 정수만 허용하며, UI draft 검증과 storage sanitize가 같은 최소값 정책을 공유합니다
- 세그먼트 preset과 최대 문장/글자/시간 threshold 도 settings로 저장되며, running capture roll-over 판정에 바로 반영됩니다. 숫자 필드를 직접 바꾸면 `custom` preset으로 전환됩니다
- 실행 중 autosave는 옵션에서 켜고 끌 수 있으며, 중지 시 최종 저장은 항상 유지됩니다
- running autosave는 확정 `수집된 자막`이 있을 때만 동작하며, preview-only/notice-only 상태로 빈 `running` 세션을 영구 저장하지 않습니다
- 자동 segmentation 이 켜진 상태에서는 세션 레코드에 `lineageId`, `segmentNumber` 메타데이터가 함께 저장되며, history 에서는 lineage summary 목록, `세그먼트 N`, lineage segment 전환, `연속 캡처 전체 보기`, lineage export/분할 저장으로 활용합니다
- 세션 레코드에는 `starred`, `pinnedAt`, `note` 메타데이터가 포함되며, history의 즐겨찾기/메모 기능과 JSON 백업/복원에서 함께 유지됩니다
- history 즐겨찾기/메모 저장은 lineage 전체 segment의 최신 저장 레코드를 다시 읽어 `starred` / `pinnedAt` / `note` 만 갱신하므로, stale detail view 가 더 최신 `entries` / `status` 를 덮어쓰지 않습니다
- history에서 저장하지 않은 메모가 있는 상태로 새로고침/`즐겨찾기만 보기` 전환을 하면서 폐기를 확인하면, draft는 실제 저장값으로 즉시 되돌아갑니다
- fallback 레코드가 없을 때 history paging/count 는 IndexedDB index 기반으로 처리해 전체 preload 비용을 줄입니다

### background

- 단일 세션 / lineage export 는 offscreen Blob 우선 + bounded data URL fallback 다운로드 처리
- history lineage export 예상 용량이 `8 MiB`를 넘으면 segment별 `segment-001` suffix 분할 저장 액션을 제공합니다
- 전체 JSON 백업은 history page Blob URL 다운로드를 사용하고 완료/실패 또는 timeout 뒤 URL을 revoke 합니다
- Blob URL 다운로드가 이미 성공한 뒤 metadata persist만 실패하면 fallback 재다운로드를 다시 열지 않고 경고만 남깁니다
- 매우 큰 단일 export는 offscreen Blob URL을 chunked part 기준으로 만들고, data URL fallback이 비현실적인 크기에서는 명시적 오류와 분할 저장 안내를 제공합니다
- history/options 페이지 열기
- content script 준비 여부 확인
- 이미 열려 있던 탭에는 필요 시 content script 재주입 시도
- storage-backed frame forwarding nonce 발급, 탭 `loading` 시 회전, 탭 제거 시 정리
- service worker 재기동 뒤에도 content script의 nonce 재조회로 frame forwarding을 다시 수렴시킵니다
- startup persistence maintenance에서 queued stopped snapshot replay -> stale running cleanup -> diagnostics snapshot 저장 순서를 유지합니다

## 알려진 한계

- 국회 사이트 DOM 구조가 바뀌면 selector 우선순위와 fallback 성능이 달라질 수 있습니다
- cross-origin frame 내부 DOM은 브라우저 보안 정책 때문에 직접 순회하지 못할 수 있습니다
- 일부 페이지는 observer보다 polling fallback 의존도가 높을 수 있습니다
- `xcode -> xcgcd` 자동 보완 흐름은 이번 1차 범위에 포함하지 않았습니다
- 확장 설치 전에 열려 있던 탭은 재주입으로 복구를 시도하지만, 탭 상태에 따라 새로고침이 필요할 수 있습니다
- 브라우저 저장소가 모두 실패하면 세션 persistence는 현재 탭 런타임 범위로 제한됩니다
- 매우 큰 export는 Blob 경로를 우선 사용하며, lineage 단위에서는 segment별 분할 저장을 제공합니다. 단일 payload의 data URL fallback이 비현실적인 크기에서는 명시적 오류로 중단합니다
- 전체 라이브러리 `JSON 백업` / `JSON 가져오기` 는 `25 MiB`를 넘는 payload를 지원하지 않습니다
- noise filter의 언어 판정은 아직 한글/영문 중심이며, 외국어 텍스트 지원 확대는 이번 배치 범위에 포함하지 않았습니다

## 향후 계획

- 전체 기록을 가로지르는 통합 검색
- 사용자 태그 / 카테고리
- 페이지/위원회 preset 관리
- 세션 품질 점수 / 수집 건강도 표시
- DOM 구조 변화에 대한 selector profile 추가
- 중요 표시 / 발언자 편집
- 브라우저 E2E 테스트 추가


## 검증 기준

현재 기준 기본 검증은 아래 명령입니다.

```bash
npm run check:version
npm run check:injected
npm run lint
npm run typecheck
npm run test
npm run build
```

전체 검증을 한 번에 실행하려면 아래 명령도 사용할 수 있습니다.

```bash
npm run verify
```

로컬 Chrome 확장 smoke 테스트는 `dist/` 확장을 Playwright로 로드해 panel mount, manual/autostart, structured/fallback commit, iframe forwarding, history 접근을 확인합니다.

```bash
npm run test:e2e:extension
```
