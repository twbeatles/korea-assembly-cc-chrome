# 코드베이스 감사 보고서 (2026-03-23)

> 이 문서는 `CLAUDE.md` 스펙과 실제 코드 구현을 대조하여 잠재적 문제, 스펙 불일치, 엣지 케이스를 정리한 감사 보고서입니다.
> 기준 커밋: `496fad3` (Harden plenary fallback capture for 1.0.1)
>
> 2026-04-07 업데이트:
> - 이 문서는 과거 감사 기준 문서이며, 현재 배포 준비 기준 구현은 이 보고서 작성 시점보다 뒤에 있습니다.
> - 현재 스토어 제출 준비 버전은 `1.0.6` 입니다.
> - 현재 수동 저장 / export 경로는 prepared snapshot 전체를 그대로 쓰지 않고, 패널에 보이는 `수집된 자막` row 를 우선 직렬화하며, row 가 없을 때만 정제 뒤에도 의미가 남는 `실시간 내용` preview 1건으로 내려갑니다.
> - 현재 popup / panel 저장 가능 조건은 공통 `hasPersistableContent` 판정으로 통일되었고, replay queue merge race / title parser / subtitle visibility / history JSON progress+cancel 관련 지적도 이후 배치에서 반영되었습니다.
> - 따라서 아래의 save/export, replay queue, popup enablement, history long-task 관련 일부 지적은 역사적 참고용으로만 읽어야 하며, 현재 릴리스 기준 판단은 `README.md`, `CLAUDE.md`, `GEMINI.md`, `DEPLOYMENT.md` 를 우선합니다.

---

## 요약

| 심각도 | 건수 |
|--------|------|
| 🔴 HIGH (스펙 불일치 / 동작 버그) | 2 |
| 🟡 MEDIUM (잠재적 문제 / 엣지 케이스) | 5 |
| 🟢 LOW (UX/구조 개선 여지) | 7 |

---

## 🔴 HIGH

### H-1. `ensureSubtitleLayerActive` 반환값이 스펙과 불일치

**파일:** `src/content/content-script.ts:767`
**관련 스펙:** `CLAUDE.md` → "자막 자동 활성화 성공은 `visible && (hasText || controlActive)`를 만족할 때만 인정해야 합니다."

**현재 코드:**
```typescript
// subtitle-layer.ts:214-229
export async function waitForSubtitleLayer(...): Promise<SubtitleLayerState> {
  while (Date.now() - startedAt <= timeoutMs) {
    const state = readSubtitleLayerState();
    if (state.visible && (state.hasText || state.controlActive)) {
      return state;  // ✅ 스펙 조건 충족 시 early return
    }
    ...
  }
  return readSubtitleLayerState();  // ⚠️ 타임아웃 시 현재 상태 반환 (visible만 true일 수 있음)
}

// content-script.ts:761-768
async function ensureSubtitleLayerActive(): Promise<boolean> {
  requestSubtitleLayerActivation();
  const layer = await waitForSubtitleLayer({ ... });
  return layer.visible;  // ⚠️ visible만 확인, hasText||controlActive 미확인
}
```

**문제:**
`waitForSubtitleLayer`가 타임아웃으로 종료되면 `layer.visible = true`이지만 `hasText || controlActive`가 false인 상태를 반환할 수 있습니다.
이 경우 `ensureSubtitleLayerActive`가 `true`를 반환해 활성화 성공으로 처리되고, "AI 자막 레이어를 열지 못했습니다" 안내 메시지가 노출되지 않습니다.

**영향:**
자막 레이어가 표시는 되지만 실제로 자막이 수신되지 않는 상태에서 사용자에게 아무 안내도 없이 수집이 시작됩니다.

**수정 방향:**
```typescript
return layer.visible && (layer.hasText || layer.controlActive);
```

---

### H-2. `shouldPersistFinalSession` vs `hasPersistableContent` 불일치

**파일:**
- `src/content/autosave.ts:20-25` — `shouldPersistFinalSession`
- `src/popup/App.tsx:20-21` — `hasPersistableContent`

**현재 코드:**
```typescript
// autosave.ts
export function shouldPersistFinalSession(isTopFrame: boolean, entryCount: number): boolean {
  return isTopFrame && entryCount > 0;  // entries.length만 확인
}

// popup/App.tsx
const hasPersistableContent =
  (snapshot?.subtitleCount ?? 0) > 0 || Boolean(snapshot?.previewText?.trim());  // previewText도 포함
```

**문제:**
팝업의 `저장` 버튼은 `previewText`가 있으면 활성화됩니다. 그러나 `saveCurrentSessionSnapshot` → `buildPreparedSessionRecord` → `flushPendingPreviews` 이후에도 `previewText`가 중복 텍스트로 판정되거나(`duplicate=true`) 필터링되면, `record.entries.length === 0`이 됩니다.
이때 `shouldPersistFinalSession(isTopFrame, 0) → false`가 되어 "저장할 자막이 아직 없습니다."를 반환합니다.

**발생 시나리오:**
1. 자막이 한 번 수집되어 history에 저장된 상태에서 세션을 초기화
2. 동일한 자막이 다시 `previewText`에만 존재하는 경우
3. `flushPendingPreviews`에서 duplicate 판정 → `entries.length === 0`
4. 팝업 버튼은 enabled (previewText가 있으므로), 클릭 시 "저장 없음" 피드백

**영향:**
UX 불일치. 빈번한 시나리오는 아니지만, 사용자가 저장 버튼이 켜져 있어 저장이 될 것이라 기대하고 클릭했지만 아무것도 저장되지 않는 경우가 발생합니다.

**수정 방향:**
인페이지 패널과 popup의 활성화 조건을 통일하거나, `shouldPersistFinalSession`에서 `previewText` 포함 여부도 확인하도록 조정.

---

## 🟡 MEDIUM

### M-1. `listQueuedExitPersistRecords` — 메모리 큐 side effect (잠재적 race condition)

**파일:** `src/storage/persist-recovery.ts:216-237`

**현재 코드:**
```typescript
export async function listQueuedExitPersistRecords(): Promise<QueuedExitPersistRecord[]> {
  ...
  const mergedRecords = mergeQueuedRecordCollections(storageRecords, [...memoryQueuedRecords.values()]);

  memoryQueuedRecords.clear();               // ⚠️ 메모리 큐 초기화
  mergedRecords.forEach((record) => {
    memoryQueuedRecords.set(record.sessionId, cloneQueuedRecord(record));  // 재구성
  });
  return mergedRecords.map(cloneQueuedRecord);
}
```

**문제:**
`listQueuedExitPersistRecords`가 `await chrome.storage.local.get(null)` 실행 중(비동기 대기 동안), 별도 흐름에서 `queueExitPersistRecord`가 호출되어 `memoryQueuedRecords`에 새 레코드를 추가할 수 있습니다.
이후 `memoryQueuedRecords.clear()`가 실행되면 그 새 레코드가 소실됩니다.

**영향:**
페이지 종료 직전에 복수 세션이 동시에 종료되는 경우(SPA 네비게이션 등) 일부 replay 레코드가 유실될 수 있습니다.

**수정 방향:**
merge 시 `clear()` 대신, storageRecords에서 온 정보를 memoryQueuedRecords의 기존 항목과 개별 비교해 갱신하는 방식으로 변경.

---

### M-2. `deriveCommitteeName` 정규식이 날짜 포함 제목을 잘못 파싱

**파일:** `src/content/content-script.ts:273-275`

**현재 코드:**
```typescript
function deriveCommitteeName(title: string): string {
  return title.replace(/\s*[-|].*$/, "").trim();
}
```

**문제:**
`-` 또는 `|` 뒤를 모두 잘라냅니다. 국회 페이지 제목에 날짜가 포함되면 의도치 않게 위원회 이름이 잘립니다.

| 입력 | 결과 | 기대값 |
|------|------|--------|
| `"행정안전위원회 2026-03-23 전체회의"` | `"행정안전위원회 2026"` | `"행정안전위원회 2026-03-23 전체회의"` |
| `"교육위원회 \| 국회TV"` | `"교육위원회"` | `"교육위원회"` ✅ |
| `"과학기술정보방송통신위원회 - 1"` | `"과학기술정보방송통신위원회"` | `"과학기술정보방송통신위원회 - 1"` |

**영향:**
내보내기 파일명의 `{committee}` placeholder와 history 목록 표시에 영향.

**수정 방향:**
`|` 구분자만 처리하거나, 날짜 패턴(`\d{4}-\d{2}-\d{2}`)을 정규식에서 제외하는 방향으로 조정.

---

### M-3. `applyPreviewStateOnly`가 module-level state를 직접 변이

**파일:** `src/content/content-script.ts:431-441`

**현재 코드:**
```typescript
function applyPreviewStateOnly(previewText: string, now: number): boolean {
  if (previewText === state.previewText) {
    return false;
  }
  state.previewText = previewText;         // ⚠️ 직접 변이
  state.lastObservedRaw = previewText;     // ⚠️ 직접 변이
  state.updatedAt = new Date(now).toISOString();
  state.lastObserverEventAt = now;
  return true;
}
```

**문제:**
파이프라인의 다른 함수들(예: `applyPreview`, `commitLiveRow`, `applyKeepalive`)은 모두 `cloneState`를 통해 불변(immutable) 패턴을 유지하고 새 state를 반환합니다. 이 함수만 module-level `state`를 직접 변이합니다.

**영향:**
구조적 문제보다는 일관성 위반. 미래에 unit test를 추가하거나 상태를 다른 흐름에서 참조할 때 숨겨진 mutation으로 인해 디버깅이 어려울 수 있습니다.

---

### M-4. `isNoiseOnly` 폴백 — 비한글/비영어 문자 전체를 noise로 처리

**파일:** `src/core/noise-filter.ts:52-68`

**현재 코드:**
```typescript
export function isNoiseOnly(text: string): boolean {
  ...
  if (hasLanguageCharacters(normalized)) {  // 한글/영문만 언어 문자로 인정
    return false;
  }
  if (isNumericOnly(normalized) || isSymbolOnly(normalized)) {
    return true;
  }
  // Mixed digit/symbol fragments such as "123_456" are also treated as noise.
  return true;  // ⚠️ 위 조건을 통과한 모든 나머지 문자도 noise로 처리
}
```

**문제:**
일본어, 중국어, 아랍어 등 비한글/비영어 언어는 `LANGUAGE_RE = /[가-힣A-Za-z]/`에 매칭되지 않으므로 `isNoiseOnly = true`로 처리됩니다.
이 동작은 현재 테스트에 명시적으로 문서화(`"continues to treat non-Korean foreign text as unsupported noise"`)되어 있지만, 사용자 대상 설명서나 옵션 UI에는 노출되지 않습니다.

**영향:**
국제 회의 등에서 영어 이외 언어 자막이 전혀 수집되지 않는 silent failure. 옵션 페이지의 noise filter 설명이 이 동작을 명시하지 않으면 사용자가 이유를 알 수 없습니다.

---

### M-5. `flushPendingPreviews` — `previewText` 전용 flush 시 noise filter 우회 가능성

**파일:** `src/core/subtitle-pipeline.ts:427-445`

**현재 코드:**
```typescript
export function flushPendingPreviews(state, now, settings): SessionState {
  const preparedState = cloneState(state);
  const normalizedPreview = normalizeRawText(preparedState.previewText);
  if (!normalizedPreview) {
    return preparedState;
  }
  const result = applyPreview(preparedState, normalizedPreview, now, settings, { ... });
  return result.state;
}
```

**문제:**
`save/stop/pagehide` 직전에 호출되는 `flushPendingPreviews`는 `previewText`를 `applyPreview`로 처리합니다. 이때 noise filter(`noiseFilterEnabled = false`이면 숫자/기호만도 통과)가 적용됩니다.
그런데 이 흐름에서는 `isMeaningfulSubtitleText`가 아닌 `hasRequiredSubtitleContent`가 gate 역할을 하며, `hasRequiredSubtitleContent`는 placeholder 문자만 걸러냅니다.
결과적으로 `noiseFilterEnabled = false`일 때 preview-only 텍스트는 `commitLiveRow`가 아닌 `applyPreview`를 통해 commit되어, `sanitizeCommittedText` 내부의 noise filter 경로와 다른 조건을 거칩니다.

**영향:**
`noiseFilterEnabled` 토글의 일관성 미흡. 표준 경로(commit)와 flush 경로에서 noise filter 적용 방식이 다를 수 있습니다. 실제 문제가 드러나려면 edge case가 겹쳐야 하므로 현재는 잠재적 위험입니다.

---

## 🟢 LOW

### L-1. history `busyAction` 락이 개별 작업 구분 없이 블록

**파일:** `src/history/App.tsx:166-188`

모든 history 비동기 작업(backup, import, delete, export, favorite 등)이 `busyAction` 단일 상태로 관리됩니다. 한 작업이 진행 중일 때 다른 작업이 어떤 작업인지 UI에서 명확히 알기 어렵습니다. 버튼들이 모두 `disabled`되는 것은 맞지만, "무엇이 진행 중인지"를 사용자가 알 수 없는 경우가 있습니다.

---

### L-2. `options/App.tsx` — `getFieldMin` 기본값이 `1`로 통일

**파일:** `src/options/App.tsx:82-95`

`recentCopyLineCount`의 최소값이 `1`로 기본값에 의존합니다. `0`을 입력하면 "최근 0줄 복사" 버튼이 표시될 수 있으며, `buildCopyText`에서 `limit: 0`으로 처리되어 아무것도 복사되지 않는 UX가 됩니다. 명시적으로 `case "recentCopyLineCount": return 1;`을 추가하는 것이 안전합니다.

---

### L-3. `isVisible` 함수가 `opacity: 0`을 visible로 판단

**파일:** `src/content/subtitle-layer.ts:29-36`

```typescript
function isVisible(element: HTMLElement | null): boolean {
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}
```

`opacity: 0`이거나 `pointer-events: none` 상태인 레이어를 visible로 판단합니다. 일부 방송 페이지에서 자막 레이어가 opacity로 숨겨지는 경우 자동 활성화가 불필요하게 트리거될 수 있습니다.

---

### L-4. frame probe `depth > maxDepth` 조건이 `>=`가 아닌 `>`

**파일:** `src/content/subtitle-layer.ts:87-90`

```typescript
function walkFramesForControl(rootDocument, depth = 0, maxDepth = 3) {
  if (depth > maxDepth) {  // depth가 4 이상일 때 종료 → 실제로 depth 0~3, 즉 4단계까지 탐색
    return null;
  }
```

`frame-probe.ts`의 `frameProbeMaxDepth: 3` 상수와 동일한 값이지만, `>` 조건으로 depth 0~3까지(총 4레벨) 탐색합니다. CLAUDE.md에는 이 제한이 명시되지 않아 의도된 것인지 확인이 필요합니다.

---

### L-5. `stopCapture` 후 popup 버튼이 snapshot 상태에 의존

**파일:** `src/popup/App.tsx:314-330`

```typescript
{snapshot?.status === "running" ? (
  <button ... onClick={() => sendCommand({ type: "STOP_CAPTURE" }, ...)}>
    {UI_TEXT.stopCapture}
  </button>
) : (
  <button ... onClick={() => sendCommand({ type: "START_CAPTURE" }, ...)}>
    {UI_TEXT.startCapture}
  </button>
)}
```

`snapshot`이 null(연결 전)이면 항상 "자막 모으기" 버튼이 표시됩니다. 연결이 불안정한 경우 수집 중임에도 "자막 모으기" 버튼이 보일 수 있습니다. `disabled={!tabReady}` 속성이 이를 완화하지만, 연결 복구 직후 snapshot이 갱신되기 전까지 잘못된 버튼 레이블이 짧게 보일 수 있습니다.

---

### L-6. `session-store.ts` — legacy fallback migration이 매 CRUD 호출마다 시도됨

**파일:** `src/storage/session-store.ts:579`, `599` 등 (fallback 뮤테이션 내부)

`migrateLegacyChromeFallbackIfNeeded()`는 `saveChromeFallbackRecord`, `deleteChromeFallbackRecord` 등 내부에서 매번 호출됩니다. 마이그레이션이 완료된 상태에서도 매 호출마다 `chrome.storage.local.get([FALLBACK_INDEX_STORAGE_KEY, LEGACY_FALLBACK_STORAGE_KEY])`를 실행합니다. 마이그레이션 완료 여부를 메모리 플래그로 캐시하면 불필요한 storage read를 줄일 수 있습니다.

---

### L-7. `README.md` 설치/빌드 섹션 누락

**파일:** `README.md`

`README.md`에 `npm install`, `npm run dev`, `npm run build` 이후 Chrome 확장 로드 방법(unpacked extension 설치 절차)이 기술되어 있지 않습니다. 신규 기여자가 개발 환경을 설정하는 데 불편함이 있습니다. `DEPLOYMENT.md`에 배포 절차가 있지만 개발 환경 셋업은 README에 있는 것이 일반적입니다.

---

## 테스트 커버리지 갭

| 영역 | 현황 | 개선 여지 |
|------|------|----------|
| `subtitle-layer.ts` | `waitForSubtitleLayer` 타임아웃 케이스 미테스트 | `hasText=false, controlActive=false`인 visible 상태에서 타임아웃 시나리오 |
| `persist-recovery.ts` | 동시 `queue` + `list` race condition 미테스트 | `queueExitPersistRecord` 중 `listQueuedExitPersistRecords` 동시 호출 |
| `content-script.ts` | 통합 테스트 없음 | `startCapture` → `stopCapture` → `saveSession` 전체 흐름 |
| `deriveCommitteeName` | 별도 테스트 없음 | 날짜/특수문자 포함 제목 파싱 케이스 |
| `flushPendingPreviews` noise path | preview-only flush + noise filter 조합 미테스트 | `noiseFilterEnabled=false` 상태에서 숫자만 있는 previewText flush |

---

## 스펙 준수 현황 (CLAUDE.md Sync Deltas)

| 델타 | 항목 | 상태 |
|------|------|------|
| 2026-03-20 | 본회의 fallback 실시간 내용 누적 | ✅ 구현됨 |
| 2026-03-20 | 본회의 fallback 수집된 자막 목록 표시 | ✅ 구현됨 |
| 2026-03-20 | 로딩중 placeholder noise filter 무관 제외 | ✅ 구현됨 (`PLACEHOLDER_TEXT_SET`) |
| 2026-03-19 | frame-forward nonce 탭 단위 15초 재동기화 | ✅ 구현됨 |
| 2026-03-19 | replay queue storage+memory merge | ✅ 구현됨 |
| 2026-03-19 | diagnostics lastQueueWriteError 등 phase별 | ✅ 구현됨 |
| 2026-03-19 | popup 저장 버튼 persistable content 조건 | ⚠️ H-2 참조 |
| 2026-03-19 | 자막 자동 활성화 `visible && (hasText\|\|controlActive)` | ⚠️ H-1 참조 |
| 2026-03-16 | `listSessionsPage` store-level paging | ✅ 구현됨 |
| 2026-03-16 | `filenamePattern` strict validation | ✅ 구현됨 |
| 2026-03-16 | 최근 N줄 복사 history 의미론 통일 | ✅ 구현됨 |
| 2026-03-14 | `startCapture` 빈 persisted running 세션 미생성 | ✅ 구현됨 |
| 2026-03-14 | `saveSession`/`updateRunningSession` starred 보존 | ✅ 구현됨 (`mergeEditableSessionMetadata`) |
| 2026-03-13 | page-exit stopped snapshot replay queue | ✅ 구현됨 |
| 2026-03-13 | session import allow-list sanitize | ✅ 구현됨 |
| 2026-03-12 | preview-only 저장/export 보존 | ✅ 구현됨 (`flushPendingPreviews`) |
| 2026-03-12 | failed persist retry + discard confirm | ✅ 구현됨 |

---

## 권장 우선순위

1. **즉시 수정 권장:** H-1 (`ensureSubtitleLayerActive` 반환값) — 스펙 명시 사항 위반, 1줄 수정
2. **단기 검토:** H-2 (`shouldPersistFinalSession` vs `hasPersistableContent`) — UX 불일치, 조건 통일 필요
3. **중기 검토:** M-1 (persist-recovery race condition) — 페이지 동시 종료 시나리오 시 발생
4. **문서화/개선:** M-2 (위원회명 파싱), L-7 (README 개발 설정)
