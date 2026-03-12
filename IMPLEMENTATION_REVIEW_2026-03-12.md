# Implementation Review 2026-03-12

## Closure Update (2026-03-12)

This review is now a baseline record, not an open findings list.

- All high/medium findings in this document have been implemented in the active MV3 codebase.
- Preview-only subtitles are now materialized into prepared save/export/unload/stop snapshots.
- Failed stopped-session persistence is now retried before `start`/`clear`, with explicit discard confirmation only after the retry fails.
- Session storage now separates record version from IndexedDB schema version, keeps transient IDB failures operation-scoped, merges IDB + fallback reads, and heals stale fallback copies on successful IDB writes.
- History view now live-syncs `recentCopyLineCount` and `filenamePattern`.
- Local polling change-detection now has focused regression scaffolding.
- Follow-up UI stability work also landed: the in-page `화면 자막` list now accumulates recent live rows and avoids scroll resets on preview-only updates.

## Scope

- Reference docs reviewed: `CLAUDE.md`, `README.md`
- Active implementation reviewed: `src/`, `tests/`
- Archived desktop app under `legacy/` was excluded per current project guidance

## Overall Assessment

The active MV3 extension is in a solid state overall. The original persistence and settings-coherency gaps called out below have been closed, and the current README/CLAUDE/GEMINI/DEPLOYMENT notes now match the implementation baseline.

## Historical Findings

The evidence references below are preserved from the original review snapshot and are not intended to describe current `HEAD` line numbers after the fixes landed.

### 1. [High] Preview-only subtitle content can trigger warnings but still be lost on save/export/navigation

- Evidence
  - `hasPersistableRunningContent` treats `previewText` and `pendingPreviews` as persistable content in `src/content/autosave.ts:27-42`
  - `buildPreparedSessionState` delegates to `flushPendingPreviews`, but `flushPendingPreviews` is currently a no-op in `src/content/content-script.ts:345` and `src/core/subtitle-pipeline.ts:395`
  - background snapshot paths bail out when `record.entries.length === 0` in `src/content/content-script.ts:617-619` and `src/content/content-script.ts:632-634`
  - manual save/export paths also operate on committed entries only in `src/content/content-script.ts:640-651` and `src/content/content-script.ts:1082-1099`
- Impact
  - A subtitle line that is already visible to the user in the preview can still disappear if it never became a committed entry before page hide, refresh, manual save, or export
  - The unload warning can imply recoverability that the save path does not actually provide
- Recommendation
  - Either materialize preview-only text into a real pending/committable structure before save/unload/export, or stop treating `previewText` alone as persistable state
  - Add a regression test for "preview shown, no committed entries, then page hide/save/export"

### 2. [High] A stopped session can be discarded after a save failure when the user starts a new capture

- Evidence
  - `stopCapture` finalizes in-memory state before persistence in `src/content/content-script.ts:1071-1078`
  - `persistStoppedSession` only reports failure and does not mark the stopped session as recoverable/dirty in `src/content/content-script.ts:533-544`
  - `cleanupPersistedSessionBeforeReset` only preserves state when `state.status === "running"` in `src/content/content-script.ts:1003-1006`
  - `startCapture` immediately resets runtime state after that check in `src/content/content-script.ts:1035-1037`, with the reset logic in `src/content/content-script.ts:988-1000`
- Impact
  - If final save fails because of quota, transient storage failure, or fallback failure, the user can lose the just-captured stopped session by clicking `자막 모으기` again
- Recommendation
  - Track an explicit `persistFailed` or `dirtyStoppedSession` state
  - On next reset/start, retry save first or require an explicit discard confirmation
  - Add a regression test for "stop save fails -> user starts again"

### 3. [Medium] Any IndexedDB operation failure disables IndexedDB for the full runtime and can split history across backends

- Evidence
  - `tryIndexedDb` disables IndexedDB on any operation error in `src/storage/session-store.ts:139-148`
  - That affects all subsequent save/load/list calls in `src/storage/session-store.ts:437-502`
- Impact
  - A single transient IndexedDB failure can push the runtime into fallback-only mode until reload
  - Existing IndexedDB sessions may temporarily disappear from history if fallback storage is empty or incomplete
  - New sessions can end up split between IndexedDB and fallback backends
- Recommendation
  - Only hard-disable IndexedDB on open/capability failures, not every transaction error
  - Retry or isolate transaction-level failures
  - Add recovery/reconciliation behavior when switching persistence backends

### 4. [Medium] Session schema/version handling is internally inconsistent

- Evidence
  - Record version constant is `2` in `src/shared/constants.ts:6`
  - IndexedDB still opens database version `1` in `src/storage/session-store.ts:81`
- Impact
  - Future schema migrations are easy to miss
  - Record metadata can claim a newer schema version than the actual IndexedDB schema
- Recommendation
  - Introduce a dedicated numeric DB schema constant
  - Keep record format version and DB schema version intentionally separated if both are needed
  - Add migration tests so schema bumps are not silent

## Remaining Recommended Work

### A. Local polling still needs real-world miss traces before heuristic changes

- Current status
  - The generic heuristic rewrite was intentionally deferred
  - Focused regression scaffolding now exists in `tests/local-polling.test.ts`
- Recommendation
  - Capture one or two real DOM mutation traces from the assembly site where polling missed a change
  - Turn those traces into deterministic regression fixtures before altering the polling heuristic further

### B. Test coverage is still light around page-shell/runtime orchestration

- Observation
  - Current tests are strongest around pipeline/probe/storage helpers
  - I did not find dedicated regression tests for popup reconnect flow, history settings refresh behavior, or service-worker persistence handoff failure paths
- Recommendation
  - Add focused tests for:
    - preview-only save/unload/export behavior
    - stopped-session save failure then restart
    - transient IndexedDB failure and recovery behavior
    - history settings staleness

## Verification Notes

- `npm install`: passed
- `npm run lint`: passed
- `npm run typecheck`: passed
- `npm run test`: passed (`20` files, `70` tests)
- `npm run build`: passed

## Suggested Next Implementation Order

1. Add integration coverage for popup reconnect + content reinjection paths
2. Add service-worker persistence handoff failure-path tests
3. Collect real assembly-site traces before changing local polling heuristics further
