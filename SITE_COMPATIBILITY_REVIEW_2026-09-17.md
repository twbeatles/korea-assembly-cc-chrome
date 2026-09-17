# 국회 중계 사이트 호환성 검토 (2026-09-17)

이 문서는 `https://assembly.webcast.go.kr` 의 **실제 생중계 목록·플레이어 URL·자막 렌더 스크립트**를 현재 코드 가정과 대조한 결과다.  
이전 오프라인 검토는 `SITE_COMPATIBILITY_REVIEW_2026-08-10.md`(이후 저장소에서 삭제)와 `PROJECT_AUDIT.md` 2026-09-09 법사위 실측이다.

**결론: 당장 코드 수정은 필요하지 않다.**  
URL·셀렉터·버튼·화자색·미확정 배경·본회의 판별 계약은 유지된다. 제품 소스는 이 검토에서 바꾸지 않았다.

관측 시각: **2026-09-17 약 11:18~11:20 KST**  
기준 커밋: **`34becb2`** (`main`, 제품 버전 1.0.14)

---

## 1. 검토 범위와 한계

### 1.1 검토한 것

| 대상 | 방법 |
|------|------|
| 홈 `https://assembly.webcast.go.kr/main/` | HTTP 200, HTML + `js/main.js?v=2026090232` |
| 생중계 목록 `service/live_list.asp` | JSON (UTF-8), 당일 19개 카드 |
| 플레이어 `live_play.asp` | 개의 중 2건 + 예정 본회의·법사위·국방위·재경위 |
| 기자회견 `live_press.asp` / `pressplayer.asp` | JSON + HTML |
| 플레이어 HTML `main/player.asp?xcode=&xcgcd=` | 외통위·복지위·본회의·법사위 |
| 자막 렌더 `js/openos_util.js`, `js/player.js` | AI WebSocket / 일반 socket.io DOM 계약 |
| 보조 호스트 `webcast.assembly.go.kr` | DNS NXDOMAIN |

### 1.2 한계

- 이 환경에서 Chrome 확장 `dist/` 로드 후 `.smi_word` 실시간 생성까지는 실행하지 않았다.
- 자막 행 DOM은 사이트 JS가 WebSocket 수신 뒤에만 붙인다. 정적 HTML에는 `#viewSubtit .incont`만 있다.
- 2026-09-09 법사위 브라우저 실측(`PROJECT_AUDIT.md`)이 같은 DOM 계약을 라이브에서 확인한 기록이 있다.
- 본회의는 관측 시점 기준 14:00 중계예정이라 일반 자막(socket.io) 런타임은 보지 못했다. `xsami`와 분기 코드는 확인했다.

---

## 2. 당일 실제 중계

회기: **제439회 국회(정기회)**  
주 호스트: `assembly.webcast.go.kr` → CDN `assembly.webcast.go.kr.gtmc.hscdn.com` (`115.71.58.140`)  
자산 캐시: CSS/JS `?v=2026090232` (약 2026-09-02 배포로 추정)

### 2.1 개의 중 (`xstat=1`) — 수집 가능 플레이어

사이트 홈의 생중계 버튼은 아래와 같다.

```text
./player.asp?xcode={xcode}&xcgcd={xcgcd}&
```

| 위원회 | 회의 | 플레이어 | xsami |
|---|---|---|---|
| 외통위 | 제01차 외교통일위원회 | https://assembly.webcast.go.kr/main/player.asp?xcode=48&xcgcd=DCM000048224390101& | `wss://smiai.webcast.go.kr:8091/aistt/oetong2` |
| 복지위 | 제02차 보건복지위원회 | https://assembly.webcast.go.kr/main/player.asp?xcode=33&xcgcd=DCM000033224390201& | `wss://smiai.webcast.go.kr:8091/aistt/bokji` |

두 건 모두 AI 자막 서버(`smiai.webcast.go.kr`)다. content script 매칭 `https://assembly.webcast.go.kr/main/player*` 안에 들어간다.

### 2.2 같은 날 예정·종료

| 상태 | 위원회 | xcode / xcgcd | xsami |
|---|---|---|---|
| 개의예정 | 법사위 제05차 | `25` / `DCM000025224390501` | `wss://smiai.webcast.go.kr:8091/aistt/beopsa` |
| 13:10 중계예정 | 국방위 제03차 | `37` / `DCM000037224390301` | `wss://smiai.webcast.go.kr:8091/aistt/gukbang` |
| 14:00 중계예정 | 본회의 제09차 | `10` / `DCM000010224390901` | `wss://smi-dw.webcast.go.kr/10` |
| 본회의 산회 직후 속개 | 재경위 제03차 | `65` / `DCM000065224390301` | `wss://smiai.webcast.go.kr:8091/aistt/jaejeong` |
| 산회 | 정무위, 농해수위 | — | — |

기자회견 `pressplayer.asp` 는 11:18경 `xstat=1`이었다가 11:19에 `0`으로 내려갔다. 경로 자체는 `https://assembly.webcast.go.kr/main/pressplayer.asp` 로 유지된다.

### 2.3 개의 전 플레이어 리다이렉트

`player.asp` 인라인 로직은 `live_play.asp` 의 `xstat == 0` 이면 홈(`/`)으로 보낸다.  
법사위·본회의 URL을 개의 전에 열면 확장이 붙는 홈 범위로 돌아온다. 수집은 개의 이후 플레이어에 머물 때만 가능하다. 기존 홈 vs 플레이어 정책과 맞다.

---

## 3. 확장 가정 vs 실측

### 3.1 URL / 호스트

코드 가정 (`src/shared/constants.ts`, `manifest.json`):

- 호스트: `assembly.webcast.go.kr`, `webcast.assembly.go.kr`
- 홈: `/main`, `/main/`
- 수집: `/main/player*`, `/main/pressplayer*`
- 본회의: `xcode=10` 또는 `xcgcd` 가 `DCM000010…`

실측:

- 주 호스트·`player.asp` / `pressplayer.asp` 패턴 **유지**
- 본회의 샘플 `xcode=10`, `xcgcd=DCM000010224390901` **일치**
- VOD 퀵보기 `w3.assembly.go.kr/main/player.do` 는 별도 호스트이며 수집 대상이 아니다
- 보조 호스트는 이번에도 DNS 실패. 주 호스트만으로 동작한다. 목록에서 빼지 않는다

### 3.2 자막 DOM 계약

플레이어 정적 HTML + `openos_util.js` 기준:

```text
#smi_btn
  a.btn.btn_subtit.btn_subtit_ai   (상임위: 표시 / 초기 HTML은 display:none)
  a.btn.btn_subtit.btn_subtit_def  (본회의 일반 자막)
  #viewSubtit.view_subtit
    #smiLoading > .loadingmsg "로딩중.."
    .incont
      p.smi_word.stxt{segment}     ← AI 경로 (stable class key)
        span#segarr_{seg}_{i}
      p.smi_word                   ← 일반 자막(socket.io) 경로
```

| 의존 항목 | 확장 측 | 2026-09-17 실측 |
|-----------|---------|-----------------|
| `#viewSubtit` | layer / probe | 유지 (player HTML id) |
| `.smi_word` | structured row | AI/일반 렌더 모두 유지 |
| `.incont` | container fallback | 유지 |
| `.btn_subtit_ai` / `.btn_subtit_def` / `#smi_btn` | 자동 활성화 | 유지. 상임위는 AI, 본회의는 일반 |
| placeholder `로딩중..` | commit/export 제외 | 유지 |
| class `stxt{segment}` | stable `nodeKey` | AI 경로에서 계속 사용 |
| 화자색 `#237c93` / `#1e1e1e` | `PRIMARY` / `SECONDARY` | `openos_util.js` 유지 |
| 미확정 배경 `#cfe5f7` (`mhwa=-1`) | unconfirmed 필터 | 유지 |
| 인식 중 `rgba(54,160,255,0.2)` | unconfirmed 후보 | 화자분리 없을 때 유지 |
| iframe 속 자막 | frame probe 여분 | 관측 player HTML에 iframe/frame 없음 |

회의 제목은 플레이어 JS가 `document.title = xsubj` 로 넣는다. 예: `제439회 국회(정기회) 제01차 외교통일위원회`.  
`deriveCommitteeName()` 은 끝의 `\| 브랜드`만 떼므로 이 제목은 그대로 위원회명으로 쓰인다.

### 3.3 자막 전송 경로

사이트는 이중 경로를 유지한다. 확장은 WebSocket에 붙지 않고 DOM만 읽는다.

1. **AI** (`smiai.webcast.go.kr`): raw WebSocket (`echo-protocol`). HLS면 URL 끝에 `/hls` 추가. 오늘 외통위·복지위.
2. **일반** (`smi-dw.webcast.go.kr` 등): socket.io `io(smi_server)` + `receive message`. 오늘 본회의 `xsami`.

사이트 분류 (`player.asp` 인라인):

```js
// smi(-hy|-dw)?(\d{1})?\.webcast\.go\.kr  → 일반 (ai_txt_flag=0, btn_subtit_def)
// 그 외 (smiai.webcast.go.kr)            → AI   (ai_txt_flag=1, btn_subtit_ai)
```

본회의 샘플 `wss://smi-dw.webcast.go.kr/10` 은 일반 분기다.  
일반 경로는 `stxt*` 클래스가 없어 generated `nodeKey`로 떨어질 수 있다. 본회의 container fallback 전체 raw 보존은 이 이유와 맞다.

### 3.4 위원회 xcode 재편 (수집 로직 영향 없음)

확장은 본회의만 `xcode=10` / `DCM000010` 으로 판별하고, 나머지 위원회명은 페이지 제목에서 온다.

| 오늘 xcode | 약칭 | 정식명 | 비고 |
|---|---|---|---|
| 65 | 재경위 | 재정경제기획위원회 | 구 기재위 `38` 자리 |
| 62 | 기후노동위 | 기후에너지환경노동위원회 | 구 환노위 `34` |
| 63 | 성평등가족위 | 성평등가족위원회 | 구 여가위 `36` |
| 91 | 특별위 | 특별위 | 구 `ED` |
| 97 | 청문회/공청회 | 청문회/공청회 | 구 `99` |

`player.asp?xcode=65&…` 도 `main/player*` 에 포함된다.

---

## 4. 코드 수정 판정

| 우선순위 | 내용 | 판정 |
|----------|------|------|
| **필수** | 셀렉터 / URL / 호스트 / 화자색 / 미확정 필터 / placeholder / 본회의 판별 | **수정 불필요** |
| **권장** | 개의 중 외통위·복지위에서 확장 실기 스모크 | `LIVE_CAPTURE_SMOKE_CHECKLIST.md` |
| **권장** | 본회의 개의 후 일반 자막(`btn_subtit_def`) 경로 스모크 | 14:00 이후 |
| **선택** | 보조 호스트 DNS 실패 안내 | README에 이미 있음. 호스트 목록 유지 |

**이 검토 시점 기준, 기능 패치·셀렉터 변경·manifest 수정은 하지 않는다.**

---

## 5. 관련 코드 앵커

| 영역 | 위치 |
|------|------|
| 호스트·URL 판별 | `src/shared/constants.ts` |
| content_scripts matches | `manifest.json` |
| 셀렉터 후보 | `SUBTITLE_SELECTOR_CANDIDATES` |
| 레이어·버튼 활성화 | `src/content/subtitle-layer.ts` |
| row / nodeKey / unconfirmed | `src/content/subtitle-rows.ts` |
| 위원회명 | `deriveCommitteeName` in `src/content/app/runtime/orchestrator/helpers.ts` |
| 화자색 상수 | `PRIMARY_SPEAKER_COLOR` / `SECONDARY_SPEAKER_COLOR` |

---

## 6. 요약 한 줄

**2026-09-17 실제 개의 중 외통위·복지위 링크와 자막 렌더 계약은 확장 가정과 호환된다. 당장 코드 변경 없음. 확장 로드 실기 스모크와 본회의 일반 자막 경로는 별도 체크리스트로 남긴다.**
