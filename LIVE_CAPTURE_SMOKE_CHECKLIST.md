# 실중계 수집 스모크 체크리스트

**목적:** 국회 의사중계가 진행 중일 때, 단위 테스트·정적 HTML 호환 검토만으로 놓칠 수 있는 **런타임 수집 품질**을 수동(또는 반자동)으로 확인한다.  

## 사전 준비

1. `npm run build` 후 `chrome://extensions` 에서 `dist/` 로드
2. 의사중계 **플레이어** URL 접속 (주 호스트 권장: `assembly.webcast.go.kr`)
3. 확장 팝업 → **수집 진단** 탭을 열어 둔다
4. 필요 시 옵션에서 자동 시작·노이즈 필터·발언자 표시를 시험 조건에 맞게 설정

## 체크리스트

| # | 항목 | 기대 | 결과 (통과/실패/메모) |
|---|------|------|------------------------|
| 1 | 우측 패널 자동 삽입 | 플레이어에서 「국회 자막 도우미」 패널 표시 | |
| 2 | AI 자막 레이어 | 자동 열기 또는 수동 「AI 자막보기」 후 자막 DOM 표시 | |
| 3 | structured 수집 | 진단 수집 방식 `structured`, observer 활성 | |
| 4 | 제자리 갱신 | 같은 줄 보정 시 목록이 중복 추가되지 않고 수정 | |
| 5 | 미확정 필터 | 인식 중(하이라이트) 문구가 저장·export에 안 들어감 | |
| 6 | fallback 전환 | iframe/셀렉터 이슈 시 fallback/polling 후 수집 지속 | |
| 7 | multi-span 화자 | 한 줄 안 색 전환 시 발언자 A/B 분리(옵션 on) | |
| 8 | 본회의 raw | 본회의(`xcode=10` 등) 장시간 fallback 시 누락 최소화 | |
| 9 | 수동 저장 | 확정 자막 1건 이상일 때만 저장 활성 | |
| 10 | 내보내기 | TXT/SRT/VTT/JSON/MD/CSV 각 1회 다운로드 | |
| 11 | 발언자 옵션 | on/off 시 TXT·복사 접두 / MD·CSV 열 일치 | |
| 12 | 세그먼트 분할 | 임계값 낮춘 뒤 롤오버 notice, History lineage 연결 | |
| 13 | 롤오버 드롭 | 진단 「롤오버 중 버린 이벤트」가 비정상 폭증하지 않음 | |
| 14 | 페이지 이탈 | 탭 닫기/이동 후 재시작 시 기록 복구 또는 저장 복구 진단 확인 | |
| 15 | 다중 탭 | 두 탭 동시 수집 시 soft 경고, 기록 분기 이해 | |
| 16 | 홈 vs 플레이어 | `/main` 은 패널만, 수집 시작은 플레이어만 | |

## 실패 시 수집할 정보

- 플레이어 URL (쿼리 `xcode` / `xcgcd` 포함)
- 진단 스냅샷: 수집 방식, selector, frame path, persistability, 롤오버 버퍼/드롭
- 대략 시각·위원회명
- Console `[assembly-subtitle]` 로그 (debugLogging on 시)

## 최근 실측 플레이어 (2026-09-17)

주 호스트만 사용한다. 보조 호스트 `webcast.assembly.go.kr` 는 DNS 실패가 반복된다.

개의 중 확인한 링크 (`live_list.asp` / `live_play.asp`, 약 11:19 KST):

- 외통위(AI): https://assembly.webcast.go.kr/main/player.asp?xcode=48&xcgcd=DCM000048224390101&
- 복지위(AI): https://assembly.webcast.go.kr/main/player.asp?xcode=33&xcgcd=DCM000033224390201&

같은 날 참고:

- 본회의 제09차 14:00 예정 — `xcode=10` `DCM000010224390901`, **일반 자막** (`smi-dw`, `btn_subtit_def`)
- 법사위 개의예정 — `xcode=25` `DCM000025224390501`. `xstat=0` 이면 사이트가 홈으로 보낸다.

호환 검토 전문: `SITE_COMPATIBILITY_REVIEW_2026-09-17.md`.  
상임위는 「AI 자막보기」, 본회의는 「자막보기」가 켜져야 한다(항목 2).

## 완료 기록

### 2026-09-17 구조 호환 실측

- 일시: 2026-09-17 약 11:18~11:20 KST
- 빌드/버전: 1.0.14 (`34becb2`)
- 방법: `live_list` / `live_play` JSON, 개의 중 player HTML, `openos_util.js` 자막 렌더. Chrome 확장 로드 스모크는 하지 않음
- 종합 판정: **조건부 통과** (URL·DOM 계약 호환, 런타임 수집 항목 1~16은 미실시)
- 후속 이슈: 외통위·복지위 확장 스모크, 본회의 개의 후 일반 자막 경로 스모크

- 일시:
- 빌드/버전:
- 담당:
- 종합 판정: 통과 / 조건부 통과 / 실패
- 후속 이슈:
