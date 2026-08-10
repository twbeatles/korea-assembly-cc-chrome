# 국회 중계 사이트 호환성 검토 (2026-08-10)

이 문서는 `https://assembly.webcast.go.kr/main/` 및 관련 플레이어·API·자막 렌더 스크립트를 코드베이스 가정과 대조한 결과다.

**결론: 당장 코드 수정은 필요하지 않다.**  
중계 미진행 상태에서도 홈·플레이어 HTML, `live_*` API, 자막 DOM 계약(`openos_util.js` 등)을 확인했고, 확장 프로그램이 의존하는 URL·셀렉터·화자색·placeholder 계약은 유지되고 있다.

---

## 1. 검토 범위와 한계

### 1.1 검토한 것

| 대상 | 방법 |
|------|------|
| 홈 `https://assembly.webcast.go.kr/main/` | HTML 수집 |
| 플레이어 `main/player.asp?xcode=…` | HTML + 인라인 스크립트 |
| 기자회견 `main/pressplayer.asp` | HTML 일부 |
| 루트 `/` | redirect/`meta refresh` |
| API `service/live_list.asp`, `live_play.asp`, `period_info.asp` | JSON 응답 |
| 자산 `player.js`, `openos_util.js`, `sub.css` 등 | 셀렉터·자막 렌더 로직 |
| 보조 호스트 `webcast.assembly.go.kr` | DNS / HTTP 도달 |

### 1.2 한계 (중계 미진행)

- 실제 생중계 중 WebSocket / socket.io 메시지 payload 는 관측하지 못함
- `.smi_word` 실시간 생성·제자리 갱신·미확정→확정 전환은 라이브에서만 최종 검증 가능
- 설치형 플레이어(RTSP) 전환 시 자막 case 전환도 미검증

→ **구조 호환은 확인**, **런타임 스모크는 중계 재개 후 권장**.

---

## 2. 사이트 현재 상태 (2026-08-10)

| 항목 | 결과 |
|------|------|
| 홈 `/main/` | HTTP 200, 정상 |
| 루트 `/` | `meta refresh` → `/main/` |
| 플레이어 `player.asp` | HTML 200. 오프라인 시 JS가 `xstat` 보고 처리 |
| 생중계 목록 `live_list.asp` | **전부 `xstat: "0"`** (생중계 없음) |
| 본회의 `live_play.asp` (샘플 `xcode=10`) | `xstat: "0"`, `xsami: "wss://smi-dw.webcast.go.kr/10"` |
| 예정 항목 | `xcode: "IV"` 등 **중계예정** 항목 존재 |
| 자산 캐시 버전 | CSS/JS `?v=2026080304` (약 2026-08-03 배포로 추정) |
| `webcast.assembly.go.kr` | **DNS 해석 실패** (현재 도달 불가) |

### 오프라인 플레이어 동작

`player.asp` 인라인 로직은 `xstat == 0` 이면 `location.href = '/'` 로 보낸다.  
루트 `/` 는 `/main/` 으로 다시 넘어가므로, 확장 content script 가 붙는 홈 범위 안으로 복귀한다.

---

## 3. 확장 가정 vs 실측

### 3.1 URL / 호스트

코드 가정 (`src/shared/constants.ts`, `manifest.json`):

- 호스트: `assembly.webcast.go.kr`, `webcast.assembly.go.kr`
- 홈: `/main`, `/main/`
- 수집 가능: `/main/player*`, `/main/pressplayer*`
- 본회의: `xcode=10` 또는 `xcgcd` 가 `DCM000010…`

실측:

- 주 호스트·경로·`player.asp` / `pressplayer.asp` 패턴 **유지**
- 영문·숫자 혼합 `xcode=IV` 도 경로상 `/main/player*` 에 포함 → **지원 범위 안**
- 본회의 판별 규칙과 샘플 URL 파라미터 형식 **일치**
- 보조 호스트만 현재 DNS 실패 (주 호스트만으로 동작 가능)

### 3.2 자막 DOM 계약

플레이어 정적 HTML + `openos_util.js` 기준 구조:

```text
#smi_btn
  a.btn.btn_subtit.btn_subtit_ai   (title: AI 자막보기 켜기/끄기)
  a.btn.btn_subtit.btn_subtit_def
  #viewSubtit.view_subtit
    #smiLoading > .loadingmsg "로딩중.."
    .incont
      p.smi_word.stxt{segment}     ← AI 경로 (segment class 로 stable key)
        span#segarr_{seg}_{i}
      p.smi_word                   ← 일반 자막(socket.io) 경로
```

| 의존 항목 | 확장 측 | 사이트 실측 |
|-----------|---------|-------------|
| `#viewSubtit` | layer / probe | 유지 |
| `.smi_word` | structured row | 유지 (`sub.css` 에도 `.incont .smi_word`) |
| `.incont` | container fallback | 유지 |
| `.btn_subtit_ai` / `.btn_subtit_def` / `#smi_btn` | 자동 활성화 | 유지 |
| placeholder `로딩중..` | commit/export 제외 | 유지 |
| class `stxt{segment}` | stable `nodeKey` | AI 경로에서 계속 사용 |
| 화자색 `#237c93` / `#1e1e1e` | `PRIMARY` / `SECONDARY` | 유지 |
| 미확정 배경 `#cfe5f7` (mhwa=-1) | unconfirmed 필터 | 유지 |
| 인식 중 `rgba(54,160,255,0.2)` | unconfirmed 후보 | 유지 |

### 3.3 자막 전송 경로

사이트는 이중 경로를 유지한다.

1. **AI**: raw WebSocket (`echo-protocol`), HLS 시 URL 에 `/hls` 추가  
2. **일반**: socket.io `io(smi_server)` + `receive message`

둘 다 최종 DOM 은 `#viewSubtit .incont` 아래 `.smi_word` 이므로, **DOM 스크래핑 전략은 유효**하다.

`live_play` 의 `xsami` 분류 (사이트 JS):

```js
// smi(-hy|-dw)?…webcast.go.kr 매칭 → 일반(ai_txt_flag=0)
// 그 외 (예: smiai.webcast.go.kr) → AI(ai_txt_flag=1)
```

본회의 샘플 `wss://smi-dw.webcast.go.kr/10` 은 위 정규식에 걸려 **일반 분기**로 분류된다.  
pressplayer 는 `wss://smiai.webcast.go.kr:8091/aistt/press` 계열로 **AI 분기** 쪽이다.  
어느 쪽이든 확장 수집 지점은 DOM 이라 즉시 깨지지 않는다.

### 3.4 프레임

- 자막 레이어는 플레이어 **top document** (`#video_01` 영역)
- 자막 전용 cross-origin iframe 의존 없음
- frame probe / top fallback 은 여분 경로로 계속 유효

---

## 4. 변경·리스크 메모 (코드 수정 필수 아님)

### (A) 보조 호스트 DNS 다운 — 정보성

`webcast.assembly.go.kr` 는 현재 DNS 실패.  
주 호스트만으로 동작하므로 **호스트 목록 제거는 권장하지 않음** (복구 대비).  
문서·진단 문구에 “보조 호스트는 비활성일 수 있음” 정도만 선택적으로 보강 가능.

### (B) 자산 `v=2026080304`

캐시 버전 갱신은 확인됨.  
자막 셀렉터·DOM 트리·화자색 계약이 깨진 증거는 없음 → **스타일/스크립트 재배포 수준**으로 판단.

### (C) 기존 설계 한계 (사이트 변경 아님)

- 한 `.smi_word` 안 다중 `span` 화자일 때 `readSpeakerColor` 는 **첫 span** 기준
- 일반 자막 경로는 `stxt*` class 없이 `smi_word` 만 사용 → **generated nodeKey** 로 떨어질 수 있음

---

## 5. 코드 수정 판정

| 우선순위 | 내용 | 판정 |
|----------|------|------|
| **필수** | 셀렉터 / URL / 호스트 / 화자색 / 미확정 필터 / placeholder | **수정 불필요** |
| **권장** | 중계 재개 시 실기 스모크 | 본회의 + 상임위 1건, AI 자막 on, 저장·export |
| **선택** | 보조 호스트 상태 문서·진단 문구 | 코드 제거 없이 안내만 |
| **선택** | 오프라인 홈 UX | 이미 capture 금지·안내 있음 → 유지 |

**이 검토 시점 기준, 기능 패치·셀렉터 변경·manifest 수정은 하지 않는다.**

---

## 6. 중계 재개 시 체크리스트

1. `https://assembly.webcast.go.kr/main/` 에서 생중계 카드 → `player.asp` 진입  
2. 확장 패널 자동 삽입, **AI 자막보기** 자동/수동 on  
3. DevTools 로 확인  
   - `#viewSubtit .smi_word.stxt*` 생성  
   - 미확정 `#cfe5f7` / 확정 화자색  
4. 패널 `수집된 자막` 누적, 같은 row 제자리 갱신  
5. 저장 → history → TXT / SRT / JSON  
6. (가능하면) 상임위 1건 + pressplayer 1건  
7. 진단: mode `structured`/`fallback`, selector, `persistabilityState`

---

## 7. 관련 코드 앵커

| 영역 | 위치 |
|------|------|
| 호스트·URL 판별 | `src/shared/constants.ts` (`ASSEMBLY_HOSTS`, `isSupportedAssemblySiteUrl`, `isAssemblyPlenaryUrl`) |
| content_scripts matches | `manifest.json` |
| 셀렉터 후보 | `SUBTITLE_SELECTOR_CANDIDATES` in `src/shared/constants.ts` |
| 레이어·버튼 활성화 | `src/content/subtitle-layer.ts` |
| row / nodeKey / unconfirmed | `src/content/subtitle-rows.ts` |
| page-world observer | `public/injected-observer.js` (빌드: `scripts/build-injected.mjs`) |
| 화자색 상수 | `PRIMARY_SPEAKER_COLOR` / `SECONDARY_SPEAKER_COLOR` |

---

## 8. 요약 한 줄

**2026-08-10 오프라인 기준, 국회 중계 사이트 구조와 확장 가정은 호환된다. 당장 코드 변경 없음. 중계 재개 후 실기 스모크만 권장.**
