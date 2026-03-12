# 기능 구현 리뷰 — korea-assembly-cc-chrome

> 작성일: 2026-03-12
> 검토 기준: `CLAUDE.md`, `README.md`, 전체 소스 직접 분석
> 상태: 초안 (우선순위별 정리)

---

## 요약

코드베이스는 전반적으로 견고하게 설계되어 있으나, 아래 항목들은 **버그**, **미구현 기능**, **race condition**, **UX 갭**, **코드 품질** 측면에서 추가 대응이 필요하다고 판단됨.

---

## 1. 버그 / 동작 오류

### 1-1. `PIPELINE_DEFAULTS.mergeGapSeconds` 미사용 — `appendOrMergeEntry` 시간 경계 누락

**파일**: `src/core/subtitle-pipeline.ts:356–393`, `src/shared/constants.ts:51`

`PIPELINE_DEFAULTS`에 `mergeGapSeconds: 5`가 정의되어 있지만, `appendOrMergeEntry` 함수에서 전혀 참조되지 않는다. 현재 병합 조건은 **글자 수 제한만** 적용된다:

```typescript
const canMerge =
  !structuredBoundary &&
  lastEntry.text.length + text.length < PIPELINE_DEFAULTS.mergeMaxChars;
```

**결과**: 발언 간 5분 이상의 침묵이 있어도 `mergeMaxChars(1000자)` 미만이면 동일 entry로 병합될 수 있다. SRT/VTT export에서 타임스탬프가 의도치 않게 길어지고, 다른 화자의 발언이 이어지는 경우 entry가 섞일 수 있다.

**제안**: `appendOrMergeEntry`에 `nowMs` 파라미터를 추가하고, `lastEntry.endTime`과의 차이가 `mergeGapSeconds * 1000`을 초과하면 강제 새 entry를 생성하도록 조건 추가.

---

### 1-2. `PIPELINE_DEFAULTS.recentHistoryEntries` / `recentHistoryCompactLength` 미사용

**파일**: `src/shared/constants.ts:54–55`

```typescript
recentHistoryEntries: 12,
recentHistoryCompactLength: 5000,
```

전체 소스(`src/`, `tests/`)에서 이 두 상수를 참조하는 코드가 없다. `softResyncHistory`는 `PIPELINE_DEFAULTS.recentResyncEntries`(5)를 사용하며, recent history 조회 로직도 없다. 정의만 되고 구현이 빠진 상태.

**영향**: 직접적인 버그는 아니지만 "최근 N개 entry만으로 history anchor 검색"하는 최적화 경로가 없어, 매우 긴 세션에서 `extractIncrementalTextFromHistory`의 탐색 범위가 전체 `confirmedCompact`(최대 50KB)에 걸쳐 실행된다.

---

### 1-3. `noise-filter.ts` — CJK 문자가 symbol-only로 분류됨

**파일**: `src/core/noise-filter.ts:5`

```typescript
const SYMBOL_ONLY_RE = /^[\W_]+$/u;
```

`\W`는 `[^A-Za-z0-9_]`이므로, 한글(`가-힣`) 이외의 모든 유니코드 문자(중국어·일본어·아랍어 등)는 `isSymbolOnly` = true로 판정된다. `LANGUAGE_RE = /[가-힣A-Za-z]/`가 한글과 영문만 허용하므로:

- 중국어 발화 → `hasLanguageCharacters` = false → `isSymbolOnly` = true → noise로 차단
- 일본어 발화 동일

**현재 서비스 범위**(국회 한국어 방송)에서는 의도된 동작일 수 있으나, 국제 행사나 외국 의원 발언이 포함될 경우 자막이 전부 탈락한다. CLAUDE.md에 명시적 제한이 없으므로 문서화 또는 `LANGUAGE_RE` 확장 검토 필요.

---

### 1-4. `withTransaction` — `oncomplete` 핸들러 설정 타이밍 fragile

**파일**: `src/storage/session-store.ts:56–75`

```typescript
callback(store)
  .then((result) => {
    transaction.oncomplete = () => resolve(result); // ← .then() 내부에서 설정
    ...
  })
  .catch(reject);
```

`oncomplete` 핸들러를 callback Promise `.then()` 안에서 설정한다. IndexedDB spec상 transaction `oncomplete`는 macrotask로 dispatch되므로 microtask인 `.then()`이 먼저 실행돼 현재 브라우저에서는 정상 동작한다. 그러나:

- 향후 브라우저 구현 변경 시 race condition 발생 가능
- `callback`이 매우 빨리 완료될 경우(`readonly` 단순 get 등) 엣지 케이스 존재

**제안**: `transaction.oncomplete` / `onerror` / `onabort`를 `callback` 호출 **이전에** 등록하고, 결과값을 공유 변수로 전달하는 패턴으로 변경.

---

### 1-5. `deleteAllSessions` — fallback 삭제 후 IndexedDB 에러 throw시 비대칭 상태

**파일**: `src/storage/session-store.ts:701–717`

```typescript
export async function deleteAllSessions(): Promise<void> {
  const indexedDbResult = await tryIndexedDb(...clear...);
  await clearFallbackRecords("전체 세션 삭제"); // fallback 먼저 지워짐

  if (!indexedDbResult.ok && indexedDbResult.error) {
    throw new Error(...); // 이미 fallback은 삭제된 상태
  }
}
```

IndexedDB clear가 실패하고 fallback clear는 성공한 경우, 에러를 throw하지만 fallback 데이터는 이미 삭제된 상태다. UI에서 에러 메시지를 보여주더라도 실제로는 fallback 기록이 소멸한 상태.

**제안**: IndexedDB clear 시도를 먼저 하고 성공 여부를 판단한 뒤 fallback을 삭제하거나, 양쪽 실패를 독립적으로 처리하고 합산 결과를 반환하는 방식으로 변경.

---

## 2. 미구현 / 기능 갭

### 2-1. `injected-observer.ts` 상수 중복 선언 — import 누락

**파일**: `src/content/injected-observer.ts:4–6`

```typescript
// injected-observer.ts 내부 로컬 선언
const OBSERVER_CONFIG_EVENT = "assembly-subtitle-observer:config";
const OBSERVER_STOP_EVENT = "assembly-subtitle-observer:stop";
const OBSERVER_BRIDGE_SOURCE = "assembly-subtitle-observer";
```

`src/shared/constants.ts`에 동일한 이름의 상수가 export되어 있지만, injected-observer.ts는 이를 import하지 않고 로컬로 재선언한다. 주석으로 "page world 주입 스크립트이므로 import 불가" 등의 설명이 없어 의도 불명확. 두 파일에서 값이 다르게 변경될 경우 silent mismatch 발생.

**제안**: 빌드 시 injected-observer.ts가 번들 분리됨을 CLAUDE.md 또는 코드 주석에 명시하거나, 공통 상수를 빌드 타임에 인라인 치환하는 방식 도입.

---

### 2-2. `capture-notice.ts` — `resolveCaptureNotice`가 `RESET_CAPTURE_NOTICE`를 반환하지 않음

**파일**: `src/content/capture-notice.ts`

`RESET_CAPTURE_NOTICE`는 `content-script.ts:433`에서 직접 `setPanelNotice(RESET_CAPTURE_NOTICE)`로 호출되어 설정된다. 하지만 이후 다음 subtitle event가 오면 `resolveCaptureNotice(...)` 결과로 즉시 덮어씌워진다.

- reset 후 즉시 자막이 다시 들어오면 "reset 복구 중" 메시지가 사용자에게 거의 보이지 않음
- `resolveCaptureNotice`에는 `isResetting` 파라미터가 없어 외부에서 reset 상태를 전달할 방법이 없음

CLAUDE.md: *"capture notice는 정상 수집, fallback 수집, reset 복구 중 상태를 구분해 사용자에게 드러내야 합니다."*

**제안**: `resolveCaptureNotice`에 `isResetting?: boolean` 파라미터를 추가하거나, `state.lastCommittedResetAt`을 기준으로 최소 노출 시간(예: 2초)을 보장하는 별도 로직 추가.

---

### 2-3. `popup/App.tsx` — charCount 미표시, 수집 직접 제어 불가

**파일**: `src/popup/App.tsx`

팝업은 `subtitleCount`(문장 수)만 표시하고 `charCount`(글자 수)는 표시하지 않는다. CLAUDE.md의 "즉시 노출되는 내보내기 버튼"도 팝업에 없다. 인페이지 패널 없이 팝업만 사용하는 경우 자막 수집 시작/정지/저장이 불가능하다.

CLAUDE.md 설계 의도상 "팝업은 보조 화면"이므로 일부는 의도적일 수 있으나, 패널이 보이지 않는 상황(스크롤로 숨겨진 경우 등)에서 백업 제어 경로가 없다.

**제안**: 팝업에 최소한의 Start/Stop 버튼 추가(옵션) 또는 현재 세션 export 버튼 추가.

---

### 2-4. `autoStartEnabled` 설정 — options.html에서 UI 표시 여부 확인 필요

**파일**: `src/options/App.tsx:464–465`

`autoStartEnabled` 체크박스가 options.html에 있다고 확인되었으나, 기본값이 `true`이므로 설치 직후 사용자가 의도치 않게 모든 국회 페이지에서 자동으로 자막 수집이 시작된다. 첫 방문 안내나 기본값 설명 문구가 없는 경우 혼란 가능.

---

## 3. Race Condition / 동시성 문제

### 3-1. `saveChromeFallbackRecord` — read-modify-write 패턴, 동시 쓰기 시 index 불일치

**파일**: `src/storage/session-store.ts:406–422`

```typescript
const index = (await readChromeFallbackIndex()) ?? [];
const nextIndex = index.includes(record.id) ? index : [...index, record.id];
await chrome.storage.local.set({ [FALLBACK_INDEX_STORAGE_KEY]: nextIndex, ... });
```

두 개의 서로 다른 세션이 동시에 fallback에 저장될 경우(예: running auto-save와 stopped session 저장가 겹칠 때):

1. A가 index 읽음: `["id1"]`
2. B가 index 읽음: `["id1"]`
3. A가 씀: `["id1", "id2"]`
4. B가 씀: `["id1", "id3"]` (A의 id2가 소멸)

결과적으로 fallback index에서 id2가 누락되고, 해당 기록은 `listSessions` 시 불러오지 못한다.

**제안**: fallback index 쓰기를 직렬 처리하는 락 또는 Promise 큐를 도입하거나, IndexedDB를 primary로 사용하는 정상 경로를 강화해 fallback 동시 쓰기 빈도를 줄임.

---

### 3-2. `handleDeleteAll` (history) — 모달 표시 중 신규 세션 추가 가능

**파일**: `src/history/App.tsx:246–277`

```typescript
const storedSessions = await listSessions({ limit: Number.MAX_SAFE_INTEGER });
// ...
if (!confirmDeleteSessions(storedSessions, "전체")) { // ← 동기 모달이지만 await 이전에 새 세션이 추가될 수 있음
```

`listSessions` 후 확인 모달이 뜨는 동안 다른 탭에서 새 세션이 저장되면, 실제 `deleteAllSessions()`는 확인 당시보다 많은 세션을 삭제한다.

**제안**: 확인 메시지에 "현재 이후에 저장된 기록 포함"이라는 문구를 추가하거나, 삭제 전 최종 count를 재확인하는 것을 고려.

---

### 3-3. `importSessionRecords` — 비원자적 루프, 중간 실패 시 부분 import

**파일**: `src/storage/session-store.ts:719–763`

```typescript
for (const record of importedById.values()) {
  await writeSessionRecord(record); // 각 record가 독립적으로 저장됨
}
```

100개 중 50번째에서 오류가 나면 1~49는 저장되고 50~100은 저장되지 않은 채로 에러가 throw된다. 사용자는 어떤 기록이 들어왔는지 알 수 없다.

**제안**: 개별 write 실패를 catch하여 `failedIds`를 집계하고, 완료 후 성공/실패 개수를 `SessionImportSummary`에 포함. 이미 `addedCount`/`updatedCount`/`keptCount` 반환 구조가 있으므로 `failedCount` 필드 추가로 해결 가능.

---

## 4. 보안 고려사항

### 4-1. `injected-observer.ts` 초기 `installBridge()` 빈 token으로 실행

**파일**: `src/content/injected-observer.ts:542`

```typescript
installBridge(); // token: "" 상태로 실행됨
```

스크립트 로드 직후 `installBridge()`가 즉시 호출되는데, 이 시점에 `state.token`은 빈 문자열이다. 따라서 content script가 `OBSERVER_CONFIG_EVENT`로 token을 설정하기 전까지 emit되는 `subtitle:update` / `subtitle:health` 이벤트는 모두 `token: ""`을 가진다.

content script에서 빈 token 이벤트를 어떻게 처리하는지에 따라:
- 거절하면: 초기 자막 이벤트 유실
- 허용하면: token 검증의 의미가 퇴색

**제안**: `injected-observer.ts`의 초기 `installBridge()` 직접 호출을 제거하고, content script의 `OBSERVER_CONFIG_EVENT`(token 포함) 수신 시에만 bridge를 초기화하도록 변경. 또는 content script가 token 발급 후 즉시 config event를 emit하여 token 없는 구간을 최소화.

---

### 4-2. `ASSEMBLY_HOST` 하드코딩 — 도메인 변경 대응 불가

**파일**: `src/shared/constants.ts:63`

```typescript
export const ASSEMBLY_HOST = "https://assembly.webcast.go.kr/";
```

국회 방송 사이트 도메인이 변경되면 확장 전체가 작동하지 않는다. `manifest.json`의 `host_permissions`도 같이 변경해야 하므로 배포 없이는 대응 불가.

**제안**: `ASSEMBLY_HOST`를 옵션 페이지에서 변경 가능한 설정으로 전환하거나, 여러 도메인 패턴을 지원하는 구조 도입(최소한 `webcast.assembly.go.kr` 등 대체 패턴 허용).

---

## 5. 성능 / 메모리

### 5-1. `listSessions` — IndexedDB 전체 `getAll()` 후 JS 정렬

**파일**: `src/storage/session-store.ts:655–679`

```typescript
const all = await withRequest(store.getAll()); // 전체 rows fetch
```

세션 수가 수백~수천 개가 되면 IndexedDB의 `getAll()`이 모든 entry(entries 포함)를 메모리로 올린다. IndexedDB의 `updatedAt` 인덱스가 생성되어 있으므로 cursor 기반으로 최신 N개만 가져오는 방식으로 최적화 가능.

**제안**: `listSessions(options)` 호출 시 `options.limit`가 있으면 `index.openCursor(null, "prev")`로 역순 커서를 사용하여 limit만큼만 fetch.

---

### 5-2. `history/App.tsx` — 최대 1000개 세션을 DOM에 단순 렌더링

**파일**: `src/history/App.tsx:40, 485–529`

```typescript
const HISTORY_PAGE_SESSION_LIMIT = 1000;
// ...
sessions.map((session) => (...)) // 최대 1000개 DOM 노드 생성
```

1000개 세션이 모두 DOM에 렌더링되면 초기 렌더링 성능과 스크롤 성능이 저하된다. 각 세션 아이템은 비교적 가볍지만, 각 세션의 entries가 선택 여부를 포함해 useMemo로 계산되는 구조라 추가 부담이 있다.

**제안**: `react-window` 또는 간단한 인터섹션 옵저버 기반 가상 스크롤 도입. 단기적으로는 limit를 200~300으로 낮추고 페이지네이션 추가.

---

### 5-3. `blobDownloadUrls` Map — service worker 재시작 시 미해제 Blob URL

**파일**: `src/background/service-worker.ts:17, 351–364`

MV3 service worker가 비활성화 후 재시작되면 `blobDownloadUrls` Map이 초기화된다. 이미 시작된 다운로드의 `onChanged` 이벤트를 수신하지 못해 Blob URL이 revoke되지 않을 수 있다. Offscreen document도 재시작될 수 있어 Blob 자체가 소멸될 수 있지만, 주의가 필요한 엣지 케이스.

---

## 6. UX 개선 필요

### 6-1. history entry 체크박스 — "보이는 항목만 해제" 버튼 없음

**파일**: `src/history/App.tsx:629–631`

"보이는 항목 전체 선택" 버튼은 있지만 "보이는 항목 전체 해제" 버튼이 없다. "선택 해제" 버튼은 필터 밖의 항목 포함 **전체 entry 선택 해제**이다. 사용자가:

1. 전체 entry 중 일부 선택
2. 검색 필터로 좁힘
3. "보이는 항목 전체 선택" 클릭
4. 보이는 항목만 해제하려 할 때 → 방법 없음

**제안**: "보이는 항목 선택 해제" 버튼 추가 또는, `allVisibleEntriesChecked` 조건일 때 같은 버튼이 "보이는 항목 해제"로 토글되도록 변경.

---

### 6-2. history — 메모 미저장 상태에서 세션 전환 또는 새로고침 시 경고 없음

**파일**: `src/history/App.tsx:137–142`

```typescript
useEffect(() => {
  setNoteDraft(selectedSession?.note ?? ""); // 세션 변경 시 draft 덮어씀
}, [selectedSession]);
```

사용자가 메모를 입력 중("메모 저장" 버튼을 누르지 않은 상태)에 다른 세션을 클릭하거나 "목록 새로고침"을 누르면 입력 내용이 사라진다. 저장되지 않았다는 시각적 표시(예: 버튼 강조, 잠금 등)도 없다.

**제안**: `noteDraft !== selectedSession?.note`일 때 세션 전환 전 `window.confirm`으로 확인하거나, 입력란에 "저장되지 않음" 뱃지 표시.

---

### 6-3. 전체 삭제 / 선택 삭제 후 선택 상태 초기화 누락

**파일**: `src/history/App.tsx:246–244`

`handleDeleteAll` 성공 후 `setSearchQuery("")`와 `setCheckedEntryIds([])`는 리셋하지만 `setCheckedIds([])`는 하지 않는다. `refresh()` 후 session list가 비워지면서 `resolveSelectedSessionIds`로 자연 정리되긴 하지만, 명시적으로 `setCheckedIds([])`를 호출하지 않아 코드 의도가 불명확.

---

### 6-4. 패널 접힘 상태에서 `OPEN_INPAGE_PANEL` 명령의 시각적 피드백 없음

팝업에서 "페이지 패널 열기" 버튼을 눌러도 팝업은 닫히지 않으며 패널이 열렸는지 확인할 방법이 없다. 패널 열기 성공/실패를 팝업에 반영하는 피드백 경로가 없다.

---

## 7. 코드 품질 / 유지보수성

### 7-1. `content-script.ts` 단일 파일 복잡도 (55KB+)

**파일**: `src/content/content-script.ts`

55KB 이상의 단일 파일로, 세션 관리, 팝업 포트 통신, 인페이지 패널 마운트, 자막 수집 이벤트 처리, auto-save, frame forward, 진단 조회 등 매우 많은 책임을 담당한다. 개별 테스트와 변경 영향 범위 파악이 어렵다.

**제안**: 단계적으로 아래 단위로 분리:
- `session-lifecycle.ts`: 세션 상태 전환(start/stop/clear/save)
- `popup-bridge.ts`: 팝업 포트 연결 및 메시지 처리
- `subtitle-event-handler.ts`: observer 이벤트 → pipeline 처리
- `frame-coordinator.ts`: frame forward 및 top/sub frame 조율

---

### 7-2. `options.html` 노출 설정 범위 미검증

**파일**: `src/storage/types.ts`, `src/options/App.tsx`

`ExtensionSettings` 인터페이스에 `maxBufferLength`, `runningAutoSaveDebounceMs`, `pollingFallbackIntervalMs`, `keepaliveIntervalMs`, `recentDuplicateMinLength` 등 고급 설정이 있지만, options UI에서 이 중 일부가 노출되지 않을 수 있다. 기본값 이외의 값으로 변경하는 유일한 방법이 `chrome.storage`를 직접 편집하는 것이라면 사실상 설정 불가.

---

### 7-3. `PIPELINE_DEFAULTS.mergeGapSeconds`가 사용되지 않아 코드-문서 불일치

**파일**: `src/shared/constants.ts:51`

이 상수가 존재하면 "시간 기반 entry 분리가 구현되어 있다"고 오해할 수 있다. 미구현 상태라면 주석(`// TODO`) 또는 제거 필요.

---

### 7-4. `isNoiseOnly` — 암묵적 fallback `return true` 설명 부재

**파일**: `src/core/noise-filter.ts:35–50`

```typescript
export function isNoiseOnly(text: string): boolean {
  ...
  if (isNumericOnly(normalized) || isSymbolOnly(normalized)) {
    return true;
  }

  return true; // ← 이 케이스가 언제 발생하는지 주석 없음
}
```

이 마지막 `return true`는 숫자+밑줄 혼합(`123_456`) 같이 `isNumericOnly`도 `isSymbolOnly`도 아닌 경우를 잡는다. 의도가 명확하지 않아 리뷰 시 혼란을 줄 수 있다. 주석 추가 또는 `return false`로 변경 후 별도 테스트로 검증 필요.

---

## 8. 부가 확인 사항 (검증 권장)

| 항목 | 위치 | 확인 내용 |
|------|------|-----------|
| SRT/VTT 부분 export 번호 | `src/core/exporters/srt.ts` | 선택 export 시 index가 1부터 시작하는지, 원본 entry 번호를 그대로 사용하는지 |
| `autoScroll` 패널 미적용 | `src/content/inpage-panel.ts` | `autoScroll = false`일 때 preview-only update가 스크롤을 유발하지 않는지 |
| `화면 자막` 누적 뷰 | `src/content/inpage-panel.ts` | live ledger 전체 row가 누적되는지, active row만 표시되는지 |
| frame forward nonce 누락 tabId | `src/background/service-worker.ts:290–295` | `sender.tab?.id`가 없는 경우(팝업에서 직접 메시지 등) 에러 처리 |
| `pendingPreviews` 필드 | `src/core/subtitle-models.ts` | `flushPendingPreviews`에서 `pendingPreviews` 배열 실제 사용 경로 확인 |

---

## 9. 현재 잘 구현된 부분 (참고)

- **3단 fallback storage**: IndexedDB → chrome.storage.local → in-memory, per-operation fallback
- **startup cleanup**: `closeRunningSessionsOnStartup`에서 양쪽 backend merge + dedup
- **bridge token 보안**: frame-forward nonce 탭별 발급·로테이션
- **flushPendingPreviews**: unload/stop 직전 preview-only 텍스트 materialize
- **failed-stopped-session retry**: 저장 실패 세션 재시도 후 discard 확인
- **history live-sync**: `chrome.storage.onChanged`로 설정 변경 즉시 반영
- **JSON backup/import**: `updatedAt` 기준 충돌 해결

---

> 이 문서는 코드 직접 분석 기반이며, 실제 런타임 테스트로 보완이 필요한 항목이 포함되어 있습니다.
> 다음 우선 처리 권장 순서: **1-1 (mergeGapSeconds) → 3-1 (fallback race) → 4-1 (token) → 2-2 (reset notice) → 1-5 (deleteAll 순서)**
