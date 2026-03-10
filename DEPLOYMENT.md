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

## 3. 배포 전 검증

루트에서 아래 명령을 실행합니다.

```bash
npm install
npm run lint
npm run test
npm run build
```

설명:
- `npm run build` 는 먼저 `scripts/build-injected.mjs` 로 `public/injected-observer.js` 를 재생성한 뒤 Vite 빌드를 수행합니다.
- 최종 배포 산출물은 `dist/` 에 생성됩니다.

추가 확인 권장:
- 국회 의사중계 페이지에서 실제 자막 추출
- 페이지 오른쪽 패널이 자동으로 뜨는지 확인
- 패널에서 `자막 모으기`, `멈추기`, `지금 저장`, `텍스트(TXT) / 자막(SRT) / 웹자막(VTT) / 기록(JSON)` 저장 확인
- popup 에서 `페이지 패널 열기`, `저장된 기록`, `환경 설정` 이동 확인
- history 검색 / 전체 내용 복사 / 찾은 내용 복사 확인
- options 페이지에서 자동 저장 관련 설정 변경 확인

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
3. 기존에 열려 있던 국회 탭은 새로고침이 필요한지
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
Compress-Archive -Path dist\* -DestinationPath korea-assembly-cc-chrome.zip -Force
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
- `activeTab`
- `scripting`
- host permission: `https://assembly.webcast.go.kr/*`

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
- `storage` 권한은 설정 및 세션 저장 fallback 용

## 7. 릴리스 체크리스트

- `package.json` 버전 증가
- `manifest.json` 버전 증가
- `npm run lint` 통과
- `npm run test` 통과
- `npm run build` 통과
- `dist/manifest.json` 생성 확인
- `dist/injected-observer.js` 생성 확인
- unpacked 로드 테스트 완료
- 실제 국회 페이지 자막 추출 확인
- exporter 결과물 확인

## 8. 배포 후 확인 항목

배포 후에는 아래를 다시 봅니다.

1. service worker 가 정상 등록되는지
2. content script 가 `https://assembly.webcast.go.kr/*` 에서 동작하는지
3. observer 실패 시 polling fallback 이 계속 동작하는지
4. SRT / VTT 시간이 상대 cue time 으로 생성되는지
5. IndexedDB 실패 시 세션 저장 fallback 이 동작하는지
6. 페이지 패널과 popup 에 마지막 자동 저장 시각이 보이는지

## 9. 자주 발생하는 문제

### 9.1 확장을 로드했는데 페이지 패널이 보이지 않음

- 국회 페이지가 이미 열려 있었다면 새로고침이 필요할 수 있습니다.
- 대상 URL 이 `https://assembly.webcast.go.kr/*` 범위인지 확인합니다.

### 9.2 zip 업로드가 실패함

- zip 최상위에 `manifest.json` 이 있는지 확인합니다.
- `dist/` 폴더를 통째로 감싸서 압축하지 않았는지 확인합니다.

### 9.3 observer 가 붙지 않음

- 페이지 구조 변경 가능성이 있습니다.
- 현재 구현은 observer 실패 시 polling fallback 으로 내려가므로, 완전 중단보다는 성능 저하 형태로 나타나는 경우가 많습니다.

### 9.4 저장이 실패함

- 현재 구현은 `IndexedDB -> chrome.storage.local -> 메모리` fallback 순서로 내려갑니다.
- 브라우저 저장소 정책이나 시크릿 모드 설정에 따라 persistence 동작이 달라질 수 있습니다.

### 9.5 Chrome Web Store 참고 기능과 차이가 있음

- 현재 범위에는 `영상 캡처`, `중요 표시`, `발언자 편집` 기능이 포함되지 않습니다.
- 이번 배포는 검색 / 복사 / autosave UX 개선을 중심으로 합니다.

## 10. 권장 운영 방식

- 개발 빌드는 unpacked 로 검증
- 배포 빌드는 항상 새 `dist/` 를 생성
- 스토어 제출용 zip 은 매번 새로 생성
- 릴리스 태그나 커밋 메시지에 manifest 버전을 같이 남김
