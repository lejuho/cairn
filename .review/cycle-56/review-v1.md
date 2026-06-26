# Codex Review v1

## Verdict
BLOCKED

## Findings
### ISSUE-1 [HIGH] `ThreadRow` API responses leak raw resume columns
- 위치: server/src/repositories/threads.ts:33
- 분석: Cycle 56 adds resume columns to `server/src/db/schema.ts`, but existing `listThreads` and `findThreadById` still use `select().from(threads)` and cast the full Drizzle row to `ThreadRow`. At runtime those rows now include `resumeRelevant`, `starSituation`, `starAction`, `starResult`, and raw `skillsTags`. `getThreadDetail` then returns that row as `thread` while also returning the intended `resume` object. The plan and Advisor both require keeping `ThreadRow` stable and reading resume data through a dedicated helper.
- 영향: `GET /api/threads` and `GET /api/threads/:id` can expose CV/resume fields outside the explicit `resume` contract, including raw `skills_tags` storage shape. This violates the Sprint Contract boundary that resume fields are exposed as `ThreadResumeData`, not by widening `ThreadRow`.
- 수정 방향: Make `listThreads` and `findThreadById` select only the stable `ThreadRow` columns, or map DB rows through an explicit `toThreadRow` helper. Add integration assertions that `detail.thread` and summary `thread` do not contain `resumeRelevant`, `starSituation`, `starAction`, `starResult`, or `skillsTags`.

### ISSUE-2 [MEDIUM] Resume editor does not sync local fields when refreshed resume props change
- 위치: web/src/Thread.tsx:1002
- 분석: `ResumeSection` initializes `situation`, `action`, `result`, and `skills` local state from `resume` props once. After `StarDraftSection` saves an ephemeral STAR draft to `/resume`, it calls `onSaved()`, which refreshes parent thread detail. The child `ResumeSection` instance remains mounted, so the refreshed `resume` prop does not update the input values. The current test only asserts the PATCH body for "save STAR draft to resume"; it does not assert that the saved values appear in the resume editor after refresh.
- 영향: The Sprint Contract says generated STAR draft can be explicitly saved to resume fields and the UI displays saved resume fields as user-owned editable data. In the current UI, the save can succeed while the visible editor still shows stale values until remount/reload.
- 수정 방향: Add a `useEffect` keyed on `resume.starSituation`, `resume.starAction`, `resume.starResult`, and `resume.skillsTags` to resync local state when props change, or remount the editor with a stable resume version key. Add a frontend test where `/resume` PATCH succeeds, subsequent `GET /api/threads/:id` returns the saved STAR fields, and the inputs update to those values.

### ISSUE-3 [HIGH] Required web test suite currently fails
- 위치: web/src/Thread.test.tsx:643
- 분석: `corepack pnpm --filter @cairn/web test -- Thread.test.tsx` fails in `Thread — resource-focus section > Escape closes the ego sheet (ISSUE-2 keyboard)`. After Escape, `ego-sheet` remains in the document.
- 영향: The cycle's automatic checks are not green, so merge criteria are not met. Even if unrelated to resume code, this branch's current `Thread.tsx` test run is failing.
- 수정 방향: Restore the Escape close behavior or, if the test assumption is stale, update the test with a narrow justification and equivalent accessibility coverage. Re-run the web test suite.

## Sprint Contract Check
- `threads` has exactly the five spec-listed resume columns: PASS.
- Migration is generated and applies cleanly to a temporary SQLite database: PASS by migration-backed integration tests.
- `ThreadDetail` includes `resume` with stable defaults: PASS.
- `PATCH /api/threads/:id/resume` succeeds only for completed threads: PASS.
- Unknown/invalid thread ids return stable errors: PASS.
- Invalid body and injected fields return `400 VALIDATION_ERROR`: PASS.
- Updating one resume field preserves unspecified fields: PASS.
- Blank text clears to `NULL`; `skillsTags=[]` clears skills: PASS.
- `skillsTags` is stored as JSON and parsed back as an array: PASS.
- The route mutates only the target `threads` row resume columns: PASS.
- Existing `POST /api/threads/:id/star-draft` remains ephemeral and does not write to DB: PASS.
- UI exposes completed-thread-only save/edit controls: PASS.
- UI presents saved resume fields as user-owned editable data after refresh: BLOCKED by ISSUE-2.
- UI does not expose export/download/apply/recommend/score controls: PASS.
- No new LLM calls, parser prompts, gateway wiring, Gmail, GCal, Telegram, watcher, mirror, slot, decision, resource, relation, or movement behavior: PASS.
- `docs/codebase-map.md` reflects the new boundary: PASS.
- Stable `ThreadRow` contract is preserved while resume fields live in `resume`: BLOCKED by ISSUE-1.

## Automatic Checks
- `corepack pnpm db:generate`: PASS, no schema changes.
- `git diff --check master..HEAD`: PASS.
- `corepack pnpm lint`: PASS.
- `corepack pnpm typecheck`: PASS.
- `corepack pnpm --filter @cairn/shared test -- threads.test.ts`: PASS, 378 shared tests.
- `corepack pnpm --filter @cairn/server test:integration -- thread-resume.integration.test.ts`: PASS, 625 integration tests.
- `corepack pnpm --filter @cairn/web test -- Thread.test.tsx`: FAIL, 1 failed / 390 passed. Failing test: `Escape closes the ego sheet`.
- `corepack pnpm verify`: NOT RUN by reviewer because the required web test stage already fails in isolation. Executor pass-001 recorded `verify EXIT=0`, but current reviewer run contradicts that state.
- Static no-export / no-new-LLM scan: PASS with expected matches only in docs/codebase-map context and strict reject tests.
- Static write-scope scan: PASS. The only server `.set(` match is `db.update(threads).set(set)` in the resume update helper.

## Changes Outside Plan
No code scope creep found in changed files. The working tree still has pre-existing uncommitted workflow files outside cycle 56; I left them untouched.

<!-- RESOLVED-BOUNDARY · 위=Codex immutable, 아래=Executor append-only · check-resolved-immutable.sh가 강제 -->

## RESOLVED (Executor 응답, 파일 끝에 append)


### Issue Classification
- ISSUE-1: APPLY
- ISSUE-2: APPLY
- ISSUE-3: APPLY

### Applied

RESOLVED: ISSUE-1 — ThreadRow no longer leaks raw resume columns
- `server/src/repositories/threads.ts`: added a `THREAD_ROW_COLUMNS` projection (the 8 stable columns) and switched `createThread` (`.returning(...)`), `listThreads`, `findThreadById`, `findThreadsByIds`, and `findCompletedThreadsByKind` from `select()`/`.returning()` to the explicit projection. ThreadRow's shape/consumers are unchanged; resume fields are read only via `findThreadResume`.
- Gap surfaced by the completion Advisor: `server/src/services/threadDraft.ts` `createThreadDraft` also did `.insert(threads).returning()` and returned the row to the client, so the 5 resume keys (null at create) appeared on the draft-create response thread. Exported `THREAD_ROW_COLUMNS` and applied `.returning(THREAD_ROW_COLUMNS)` there too.
- `server/src/routes/thread-resume.integration.test.ts`: new test asserts `detail.thread` and every `GET /api/threads` summary `thread` contain none of `resumeRelevant/starSituation/starAction/starResult/skillsTags`, while `detail.resume` still exposes them.

RESOLVED: ISSUE-2 — resume editor re-syncs after a save-driven refresh
- `web/src/Thread.tsx` `ResumeSection`: added a `useEffect` keyed on `resume.starSituation/starAction/starResult` and the joined `skillsTags` string that re-seeds the four inputs when the saved resume props change. The instance stays mounted; saving a STAR draft to resume now updates the visible editor after `onSaved()` refreshes detail.
- `web/src/Thread.test.tsx`: new test — first `GET` returns empty resume (input empty), `resume-save-btn` PATCH succeeds, the next `GET` returns the saved STAR fields, and the inputs update to those values.

RESOLVED: ISSUE-3 — "Escape closes the ego sheet" no longer flaky
- Root cause: `ResourceFocusDetail` passed an inline `onClose` (new identity each render); `EgoSheet`'s document-keydown effect is keyed on `[onClose]`, so it re-subscribed and re-ran its cleanup (which refocuses the opener) on every render — churn that made the Escape close intermittent.
- `web/src/Thread.tsx`: wrapped `onClose` in `useCallback` (stable identity) so the effect subscribes once. EgoSheet itself is untouched (its Escape mechanism was ruled out-of-scope in a prior cycle). The Escape test passes 3/3 isolated runs.

자동 체크: `corepack pnpm verify` EXIT=0 (626 tests, was 625) ✅ / `corepack pnpm db:generate` no schema changes ✅ / `git diff --check master..HEAD` clean ✅
