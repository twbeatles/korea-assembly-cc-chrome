# Chrome Web Store Permission Justifications

## 2026-05-10 Permission Update

- `sidePanel`: 사용자가 국회 의사중계 페이지를 계속 보면서도 브라우저 측면에서 수집 상태와 최근 자막을 확인하고 저장/기록/설정 화면으로 이동할 수 있도록 보조 패널을 열기 위해 사용합니다. 기존 in-page panel은 계속 기본 UI이며, side panel은 popup처럼 닫히는 임시 화면이 아니라 회의 중 보조 모니터 역할을 하는 확장 UI입니다. Chrome side panel API를 사용할 수 없는 환경에서는 일반 확장 페이지 fallback을 엽니다.
- `storage`: 기존 설정/세션/진단 데이터에 더해 로컬 메타데이터인 `tags`, `category`, `speakerLabels`, `highlighted`, `entryNote`, `labels`, `originalText`, `sourceEntryIds`, 그리고 preset 목록을 저장합니다. 모든 새 데이터는 로컬 IndexedDB 또는 `chrome.storage.local`에만 저장됩니다.
- `downloads`: 기존 TXT/SRT/VTT/JSON 외에 Markdown/CSV export 파일 저장에도 사용합니다. 사용자가 직접 export 버튼을 누른 경우에만 동작합니다.
- 외부 AI 요약, 외부 전송, 영상 캡처, 넓은 host permission은 포함하지 않습니다.

Chrome Web Store 제출 폼에 바로 붙여넣을 수 있도록 간략 문안만 정리한 파일입니다.

## storage 사용 근거

확장 설정값과 저장된 자막 세션 기록을 보관하기 위해 사용합니다. 사용자가 설정한 자동 저장, 자동 스크롤, 파일명 패턴, 최근 N줄 복사, TXT export 세부 옵션, preset 같은 옵션을 유지하고, 저장한 자막 기록의 즐겨찾기 상태, 메모(최대 4096자), 태그, 카테고리, 세션/entry 발언자 라벨, 중요 표시, entry note, labels를 다시 열람할 수 있게 보관합니다. JSON 가져오기로 복원한 기록도 같은 로컬 저장소에 저장합니다. 페이지 종료 직전 저장 복구를 위한 임시 대기 기록, history 화면의 최신 목록 동기화를 위한 내부 revision 신호, queue write / replay / cleanup 단계별 저장 복구 진단 정보, 탭 단위 프레임 메시지 무결성 검증용 nonce 같은 내부 상태도 브라우저 로컬 저장소에서만 관리합니다. 같은 의사중계 페이지에서 사용자가 명시적으로 수집을 중단했을 때 자동 시작을 잠시 보류하기 위해 탭 단위 `sessionStorage` 마커를 사용합니다. 이 마커는 탭이 닫히면 사라지며 외부로 전송되지 않습니다. background 명령은 다른 확장에서 흉내 낸 메시지를 거부하기 위해 발신자 식별자가 본 확장과 일치하는지 함께 확인합니다.

## downloads 사용 근거

사용자가 직접 요청한 자막 기록을 TXT, SRT, VTT, JSON 파일로 저장하기 위해 사용합니다. 자동 다운로드는 하지 않으며, 페이지 패널이나 history 화면에서 저장 버튼을 눌렀을 때만 동작합니다. 수동 저장 / 내보내기에서는 확정된 `수집된 자막` 누적 목록만 직렬화하며, fallback `실시간 내용`은 같은 normalized raw가 2회 이상 또는 400ms 이상 안정적으로 관측되어 확정 entry가 된 뒤에만 저장 대상으로 포함됩니다. 단일 세션 export, lineage export, 전체 기록 JSON 백업도 모두 사용자의 명시적 요청일 때만 실행됩니다.

## activeTab 사용 근거

현재 활성 탭이 국회 의사중계 페이지인지 확인하고, popup에서 현재 탭의 확장 연결 상태를 점검하기 위해 사용합니다. 사용자가 보고 있는 탭 기준으로 패널 열기나 상태 확인을 안전하게 처리할 때만 사용합니다.

## scripting 사용 근거

이미 열려 있는 국회 의사중계 탭에 content script를 재주입하거나 연결을 복구해야 할 때 사용합니다. 이를 통해 페이지 오른쪽 자막 패널을 열고, 확장이 정상적으로 자막을 수집할 수 있도록 보조합니다.

## offscreen 사용 근거

단일 세션 또는 연속 캡처 lineage 내보내기 파일 생성 시 Blob 기반 다운로드를 안정적으로 처리하기 위해 사용합니다. 대용량 자막 데이터를 브라우저 정책에 맞게 파일로 저장할 때만 사용하며, 사용자 요청이 있을 때만 동작합니다. 전체 기록 JSON 백업은 history 페이지에서 Blob URL 다운로드를 직접 시작하므로 대형 백업 본문을 service worker 메시지로 전달하지 않습니다.

## sidePanel 사용 근거

Chrome 114+에서 지원되는 브라우저 측면 보조 패널을 열기 위해 사용합니다. 사용자는 국회 의사중계 영상을 보는 탭을 유지한 채, 별도 popup을 계속 다시 열지 않고도 현재 수집 상태, 최근 자막, 저장 가능 여부, 저장된 기록/환경 설정/진단 바로가기를 확인할 수 있습니다. 이는 긴 회의 중 popup이 닫혀도 수집 상황을 계속 확인해야 하는 사용 흐름을 보완하기 위한 UI 권한입니다.

기본 UI는 기존 사이트 안 우측 in-page panel이며, side panel은 같은 로컬 세션 상태를 보여주는 보조 화면으로 제한됩니다. side panel은 지원 국회 도메인 밖의 페이지 내용을 읽기 위한 권한이 아니며, 외부 AI 요약, 외부 서버 전송, 영상 캡처, 추가 host permission을 요구하지 않습니다. Chrome side panel API를 사용할 수 없는 환경에서는 일반 확장 페이지 fallback을 사용합니다.

Chrome Web Store 제출용 간략 문안:

`sidePanel` 권한은 사용자가 국회 의사중계 페이지를 보면서 브라우저 측면에서 현재 자막 수집 상태, 최근 자막, 저장/기록/설정 바로가기를 계속 확인할 수 있도록 보조 패널을 열기 위해 사용합니다. 기본 수집 UI는 사이트 안 우측 패널이며, side panel은 같은 로컬 세션 상태를 보여주는 선택적 보조 화면입니다. 이 권한은 추가 웹사이트 접근, 외부 전송, 영상 캡처에 사용하지 않습니다.

## 호스트 권한 사용 근거

`https://assembly.webcast.go.kr/*` 와 `https://webcast.assembly.go.kr/*` 호스트 안에서도 실제 동작 범위는 `main` / `main/` 홈과 `main/player*` 플레이어에 한정됩니다. 홈에서는 자막 수집 패널과 진단 UI를 표시하고, 플레이어에서는 AI 자막 DOM을 읽어 사용자가 보고 있는 국회 중계 자막을 저장할 수 있도록 합니다. 다른 사이트에서는 동작하지 않으며 권한 범위도 해당 두 도메인으로 제한되어 있습니다.
