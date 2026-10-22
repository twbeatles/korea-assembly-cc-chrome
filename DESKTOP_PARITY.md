# 데스크톱 ↔ Chrome 확장 수집 알고리즘 정합 (2026-10-22)

이 문서는 Chrome 확장(`korea-assembly-cc-chrome`, 이 저장소)과 데스크톱 앱(`korea-assembly-cc`, PySide6 + Selenium)의 자막 수집 알고리즘을 대조한 결과, 2026-10-22 국회 의사중계 사이트 실측, 양쪽에 반영한 수정, 앞으로 두 저장소를 같이 유지하는 방법을 정리합니다.

- 공유 계약: [`parity/`](parity/README.md) (두 저장소에 같은 사본)
- 데스크톱 측 대응 문서: `korea-assembly-cc/docs/CHROME_EXTENSION_PARITY.md`
- 이전 사이트 실측: [`SITE_COMPATIBILITY_REVIEW_2026-09-17.md`](SITE_COMPATIBILITY_REVIEW_2026-09-17.md)

## 1. 두 저장소를 잇는 방식

코드 공유(서브모듈·공통 패키지)는 하지 않습니다. 런타임이 TypeScript(MV3 content script)와 Python(Selenium `execute_script`)으로 달라 공통 패키지가 오히려 양쪽 빌드를 묶기 때문입니다. 대신 **계약 파일 + 공유 테스트 벡터 + 동기화 검사**로 연결합니다.

| 장치                  | Chrome 확장                                                         | 데스크톱                                                              |
| --------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 계약 사본             | `parity/capture-contract.json`                                      | `parity/capture-contract.json`                                        |
| 테스트 벡터 사본      | `parity/pipeline-vectors.json`                                      | `parity/pipeline-vectors.json`                                        |
| 계약·벡터 검증 테스트 | `tests/parity-contract.test.ts`                                     | `tests/test_parity_contract.py`                                       |
| 사본 동기화 검사      | `npm run check:parity` (`verify`, CI 포함, 형제 저장소 없으면 skip) | `python scripts/check_parity_sync.py` (`check_before_push.py`에 포함) |
| 사본 복사             | `node scripts/check-parity-sync.mjs --write`                        | `python scripts/check_parity_sync.py --write`                         |

벡터는 정규화, 증분 추출(suffix `rfind`/overlap/ambiguous), 문장부호 결합, commit 가능 판정(placeholder·노이즈), entry 병합 경계, keepalive, 미확정 하이라이트, 샘플링을 다룹니다. 2026-10-22 기준 Chrome 77건, 데스크톱 79건이 같은 벡터를 통과합니다.

## 2. 사이트 실측 (2026-10-22, 국정감사 기간)

`live_list.asp` 기준 9개 위원회가 생중계 중이었습니다(예: 정무위 `xcode=26&xcgcd=DCM00002622439A701`). 플레이어 HTML과 `js/openos_util.js`(v=20261020)를 직접 내려받아 확인했습니다. 브라우저 자동화 확장이 연결되지 않아 렌더된 DOM 대신 사이트 스크립트의 DOM 생성 코드를 읽었습니다.

### 2.1 자막 레이어 마크업

```html
<li id="smi_btn">
  <a class="btn btn_subtit btn_subtit_ai" style="display:none;">AI 자막보기</a>
  <a class="btn btn_subtit btn_subtit_def">자막보기</a>
  <div id="viewSubtit" class="view_subtit">
    <div class="lp_wrap" id="smiLoading">
      <div class="loadingmsg">로딩중..</div>
      …
    </div>
    <div class="incont"></div>
  </div>
</li>
```

- `xsami` 가 `smi(-hy|-dw)?N.webcast.go.kr` 이면 일반 자막(`btn_subtit_def`), 아니면 AI 자막(`btn_subtit_ai`). 이 분기는 2026-09-17 실측과 같습니다.
- `#smiLoading` 의 `로딩중..` 문구가 `#viewSubtit` 안에 있습니다. `.incont` 가 비어 있는 시작 직후 `#viewSubtit` container fallback 이 이 문구를 읽을 수 있습니다.

### 2.2 행(row) 생성 규칙

| 모드                            | 생성 DOM                                               | stable key                                 | 미확정 표시                                                                        |
| ------------------------------- | ------------------------------------------------------ | ------------------------------------------ | ---------------------------------------------------------------------------------- |
| AI + 화자분리                   | `p.smi_word.stxt{segment} > span#segarr_{segment}_{n}` | `class:stxt{segment}` (+ `#segarr_…` 분할) | `mhwa=-1` → `background:#cfe5f7; color:#0c2b80`                                    |
| AI + 화자분리 없음              | `p.smi_word.stxt{segment} > span`                      | `class:stxt{segment}`                      | 최신 줄 span 에 항상 `background:rgba(54,160,255,0.2)` (다음 segment 가 오면 해제) |
| 일반 자막(socket.io, 본회의 등) | `p.smi_word` (stxt 클래스·id 없음)                     | **없음 → unstable**                        | 없음                                                                               |

- 화자색: `mhwa=0` → `#1e1e1e`(secondary), `mhwa=1` → `#237c93`(primary). 계약과 같습니다.
- 화자 전환 표시는 텍스트 앞 `-` 를 지우고 `mhwa0`/`mhwa1` 클래스로 남깁니다. 현재 두 제품 모두 이 클래스는 쓰지 않습니다(후보 과제).
- 줄 수가 6을 넘으면 가장 오래된 `.smi_word` 를 지웁니다. 일반 자막은 10초 무수신 시 `.incont` 를 비웁니다.
- 보조 호스트 `webcast.assembly.go.kr` 는 여전히 DNS NXDOMAIN 입니다.

**결론:** 셀렉터·화자색·미확정 색 계약은 바뀌지 않았습니다. 다만 일반 자막 행에 stable key 가 없다는 점과 로딩 문구 위치가 두 제품의 처리 차이를 드러냈습니다(아래 §3).

## 3. 알고리즘 대조 결과

양쪽 코드를 줄 단위로 대조했습니다. "동일"은 같은 입력에서 같은 결과를 낸다는 뜻입니다.

### 3.1 이미 동일했던 부분

- 증분 추출(`extractIncrementalTextFromHistory` ↔ `extract_incremental_text_from_history`): empty / no_history / identical / contained / suffix `rfind` / history / overlap / full 순서와 ambiguous 판정이 1:1 이식본입니다.
- recent history 우선 추출, confirmed history 재구성, soft resync(최근 5 entry), desync 10회 / ambiguous 6회 임계.
- live row ledger(`reconcileLiveCapture` ↔ `reconcile_live_capture`), 300행 상한, `framePath::nodeKey` 키.
- structured row 읽기(`readObservedSubtitleRows` ↔ probe JS `readObservedRows`): stable class key, 다중 화자 span 분할, 같은 compact 연속 행 치환.
- reset grace 1초, keepalive 1초, 본회의 판별.

### 3.2 차이와 조치

| #   | 차이                                                                                           | 영향                                                                                               | 조치                                                                            |
| --- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| D1  | 데스크톱 `clean_text_display` 가 `\b\d{4}년\b` 를 **본문에서 삭제** (최초 커밋부터, 근거 없음) | "2026년 예산안" → "예산안" 데이터 손실                                                             | 데스크톱에서 제거                                                               |
| D2  | 데스크톱에 placeholder(`로딩중..`, `Loading...`) 필터 없음                                     | 시작 직후 `#viewSubtit` fallback 이 로딩 문구를 자막으로 저장                                      | 데스크톱 `is_meaningful_subtitle_text` 에 추가                                  |
| D3  | 데스크톱 미확정 판정이 배경색만, 하위 노드 앞 48개만 검사                                      | 배경 이미지 하이라이트·긴 노드 말단 하이라이트 누락                                                | Chrome 규칙(배경 이미지 + 텍스트 노드 우선 96개 샘플 + 마지막 노드) 이식        |
| D4  | 데스크톱 container fallback 차단이 `.smi_word` 존재 시에만, 연속 차단 해제 없음                | 미확정 container 텍스트 commit / 장시간 정지                                                       | Chrome `shouldBlockContainerFallbackForUnconfirmed` + 연속 6회 허용 streak 이식 |
| D5  | 데스크톱은 unstable row 도 commit                                                              | 일반 자막(본회의)에서 줄마다 별도 entry, Chrome 과 출력 형태가 다름                                | stable row 만 commit, unstable-only 는 fallback 경로                            |
| D6  | 데스크톱 container/fallback 은 즉시 commit                                                     | 흔들리는 fallback 텍스트 조기 확정                                                                 | Chrome 안정 관측 게이트(같은 raw 2회 또는 400ms) 이식                           |
| D7  | 데스크톱 기본 셀렉터 순서에서 `#viewSubtit span` 이 container 보다 앞                          | fallback 시 첫 span(가장 오래된 줄)만 읽음                                                         | Chrome 순서로 정렬(사용자 지정 셀렉터 위치는 의도적 차이로 유지)                |
| D8  | 데스크톱 container 내부 raw 를 400자/3줄로 잘라 diff 에 사용                                   | 본회의 fallback diff 복원력 저하                                                                   | 내부 raw 4KB tail(본회의 전체), UI preview 만 400자 축약                        |
| D9  | 데스크톱 코어 `_join_stream_text` 에 곡선 따옴표·말줄임표 없음                                 | `”`, `…` 앞 불필요한 공백                                                                          | Chrome 집합으로 통일                                                            |
| M1  | Chrome 은 `unknown` channel 도 화자 경계로 봄, 데스크톱은 알려진 channel 만                    | 같은 화자 텍스트 분리 여부가 다름                                                                  | **양쪽 모두 알려진 channel(primary/secondary)만 경계**                          |
| M2  | 데스크톱만 structured → container fallback 전환을 병합 경계로 봄                               | Chrome 이 fallback 텍스트를 structured entry 에 이어 붙임                                          | **양쪽 모두 fallback 경계 적용**                                                |
| M3  | Chrome 만 fallback 경로에 짧은 merge gap(5초 × 0.4)                                            | 데스크톱 fallback entry 가 더 길게 병합                                                            | **양쪽 모두 0.4 배율**                                                          |
| M4  | 데스크톱 파이프라인은 `speaker_changed` 를 설정하지 않음                                       | 화자 전환 표시 누락                                                                                | 데스크톱도 화자 경계 새 entry 에 설정                                           |
| K1  | Chrome keepalive 는 raw 와 무관하게 마지막 entry 연장, 데스크톱은 raw == 마지막 entry 일 때만  | Chrome: 무관한 preview 중에도 연장 / 데스크톱: structured 미리보기(최근 3행)에서는 거의 연장 안 됨 | **양쪽 모두 "raw 가 마지막 entry 로 끝나면 연장"**                              |
| C1  | Chrome `applyPreview` 가 resync 없이도 추출을 한 번 더 수행                                    | 결과 동일, 불필요한 연산                                                                           | resync 직후에만 재추출                                                          |

### 3.3 의도적으로 남긴 차이

`parity/capture-contract.json` 의 `intentionalDifferences` 에도 같은 내용이 있습니다.

| 항목                            | Chrome                   | 데스크톱                                                             | 이유                                             |
| ------------------------------- | ------------------------ | -------------------------------------------------------------------- | ------------------------------------------------ |
| entry 최대 길이 `mergeMaxChars` | 1000                     | 300                                                                  | 제품별 문단 정책. 추출 의미론과 무관             |
| 사용자 지정 셀렉터 위치         | 기본 후보 뒤             | `.smi_word` 다음, container 앞                                       | 데스크톱만 셀렉터 입력 UI 가 있음                |
| 중지 시 preview 확정            | 안 함(committed 만 저장) | 함 (`PIPELINE_LOCK` §4.6)                                            | 저장 정책 차이                                   |
| noise filter 토글               | 옵션                     | 항상 on                                                              | 기본값 결과는 같음                               |
| 레거시 문자열 preview 경로      | 없음                     | `_prepare_preview_raw` → `_process_raw_text` 가 호환용으로 남아 있음 | 워커는 dict payload 만 보내므로 운영 경로가 아님 |

## 4. 이 저장소(Chrome)에서 바꾼 것

- `src/core/subtitle-pipeline/entry-policy.ts` 신설: `shouldMergeIntoLastEntry`, `isSpeakerBoundary`, `shouldApplyKeepalive` (M1–M3, K1). `commit.ts` 의 병합·`speakerChanged` 판정과 `lifecycle.ts` 의 `applyKeepalive(state, now, raw?)` 가 이를 사용합니다.
- `capture-events.ts`: keepalive 호출에 현재 preview raw 를 넘기고, 실제로 연장됐을 때만 autosave 를 예약합니다.
- `commit.ts` `applyPreview`: soft resync 직후에만 재추출 (C1, 결과 동일).
- `PIPELINE_DEFAULTS.fallbackMergeGapFactor = 0.4` 상수화.
- `subtitle-rows.ts`: `hasVisibleBackgroundHighlightValues`, `sampleEvenly` export (벡터 검증용, 동작 동일).
- `parity/`, `tests/parity-contract.test.ts`, `scripts/check-parity-sync.mjs`, `npm run check:parity`(verify·CI 단계 추가).

## 5. 데스크톱 저장소에서 바꾼 것 (요약)

- `core/text_utils.py`: `RE_YEAR` 삭제 중단(D1), `is_placeholder_subtitle_text` 추가(D2), `format_fallback_preview_text`(D8).
- `core/subtitle_pipeline_impl/entry_policy.py` 신설(M1–M4, K1), `entries.py` 결합 문장부호(D9).
- `ui/main_window_impl/capture_dom.py` probe JS: 미확정 판정(D3), container 차단·streak(D4), 내부 raw 보존(D8), 셀렉터 순서(D7).
- `ui/main_window_impl/pipeline_state.py`: stable row 만 commit(D5), fallback 안정 관측 게이트(D6). `pipeline_stream.py` keepalive 가 fallback 재관측으로도 집계됩니다.
- `core/subtitle_confirmation.py`(probe JS 미러), `tests/test_parity_contract.py`, `scripts/check_parity_sync.py`, `PIPELINE_LOCK.md` §2.1 이력.

## 6. 후속 후보

- `mhwa0`/`mhwa1` 화자 전환 클래스를 speaker change 신호로 쓰기 (양쪽 동시 적용, 벡터 추가 필요).
- AI 자막(화자분리 없음) 모드는 최신 줄이 다음 segment 전까지 미확정이므로, 중지 직전 마지막 줄은 Chrome 에서 저장되지 않습니다. 사이트 동작이라 필터 예외를 둘지는 실중계 스모크(`LIVE_CAPTURE_SMOKE_CHECKLIST.md`)로 판단합니다.
- 렌더된 DOM 실측(브라우저 연결 시)으로 §2.2 표를 재확인합니다.
