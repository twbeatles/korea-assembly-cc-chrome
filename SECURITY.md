# Security & Threat Model

국회 AI 자막 추출기(Chrome Extension MV3)의 보안 경계와 전제를 고정한다.  
권한 문안: `CHROME_WEB_STORE_PERMISSION_JUSTIFICATIONS.md`

## 1. 신뢰 경계

| 영역 | 신뢰 |
|------|------|
| 확장 isolated world (content script, service worker, popup/history/options) | 자사 코드 |
| 페이지 world (`injected-observer.js`) | **의사중계 호스트와 동일 origin** — 호스트 XSS 가 있으면 신뢰 붕괴 |
| 로컬 저장 (IndexedDB / `chrome.storage.local`) | 사용자 브라우저 프로필 보호에 위임 |
| 외부 네트워크 | 자막·설정을 개발자/제3자 서버로 **전송하지 않음** (제품 설계) |

**지원 범위 밖:** 의사중계 페이지에 임의 악성 스크립트가 이미 주입된 환경.  
이 경우 page world 브리지 token·CustomEvent·DOM 자막 위조가 가능하다.

## 2. 호스트·권한 최소성

- `host_permissions` / content_scripts matches: `assembly.webcast.go.kr`, `webcast.assembly.go.kr` 만.
- `web_accessible_resources` (`injected-observer.js`): 동일 호스트 매치.
- `scripting` 재주입: manifest 에 선언된 content script 파일만.
- Background 명령: `isMessageFromOwnExtension` 으로 타 확장 메시지 거부.
- `DOWNLOAD_REQUEST` 본문 상한 2 MiB; 대형 export 는 세션/라인리지 경로.
- `unlimitedStorage`: page-exit 복구 큐·fallback 세션이 `chrome.storage.local` 10MB 한도에 잘리지 않도록 한다. 외부 전송에는 쓰지 않는다.
- Persist 메시지: entry 5만 개 · 8 MiB · 세션 id 128자 상한.
- Host command (`assembly-subtitle-panel-command`) 는 `data-assembly-e2e="1"` 일 때만 받는다.

## 3. DOM XSS 완화

- 제품 `src` 는 `innerHTML` / `dangerouslySetInnerHTML` 을 사용하지 않는다. UI 는 `textContent` 중심.
- In-page 패널 production shadow: **`mode: "closed"`** (페이지 스크립트가 패널 내부를 직접 조작하기 어렵게 함).
- 발언자 accent 색: hex/rgb/rgba 화이트리스트 (`sanitizeSpeakerColorForCss`).
- CSV export: spreadsheet formula prefix neutralize.

## 4. Page-world 브리지

- `MutationObserver` 는 page world 에 두고, 변경 신호 + selector 재읽기 결과를 `postMessage`/`CustomEvent` 로 content script 에 전달한다.
- Observer **token** 과 frame-forward **nonce** 로 단순 위조를 완화한다.
- token 은 `OBSERVER_CONFIG_EVENT` detail 로 page world 에 전달된다 → **동일 origin 페이지 스크립트는 token 을 알 수 있다** (신뢰 호스트 전제).
- Frame forward: 탭 단위 nonce, loading 시 회전, mismatch 시 resync + top fallback probe.

## 5. E2E / 테스트 훅

- production closed shadow 를 유지한다.
- 스모크/e2e 는 host 에 `data-assembly-e2e="1"` 을 켠 뒤에만 light DOM `data-assembly-*` 미러를 읽고, `assembly-subtitle-panel-command` CustomEvent 로 버튼을 누른다.
- **명령과 자막 미러 모두 e2e 마커가 있을 때만** 동작한다. 마커가 없으면 start/stop/save 를 받지 않고, preview/notice 미러도 쓰지 않는다.
- 호스트 XSS 가 마커를 켜면 조작이 가능하다 → §1 신뢰 호스트 전제와 동일. 민감 원격 명령·외부 origin 은 받지 않는다.

## 6. 데이터 보호

- 자막·메모·태그는 로컬에만 저장. at-rest 암호화는 브라우저 프로필에 위임.
- JSON import: allow-list sanitize, 미지원 URL `sourceUrl` 제거, running→saved 정규화.
- 개인정보 정책 초안: `PRIVACY_POLICY_DRAFT_KO.md` (스토어 게시 전 운영자 정보 필수).

## 7. Side panel

- `sidePanel` 권한은 **실험·보조 UI**. 기본 수집 UX 는 사이트 안 우측 패널.
- 추가 host 접근·외부 전송에 사용하지 않는다. 자세한 심사 문안은 permission justifications 문서.

## 8. 보고

보안 이슈 보고: 저장소 이슈 트래커 또는 스토어 등록 개발자 연락처 (개인정보 정책의 문의 이메일).
