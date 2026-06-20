# Codex Review v2

## Verdict

BLOCKED

## Findings

### ISSUE-1 [MEDIUM] Opener focus restore is still non-functional

- Location: `web/src/Today.tsx:427`
- Analysis: `conflictOpenerRef` is created and passed to
  `ConflictResolvedSheet`, but no code assigns the conflict trigger element to
  `.current`. `handleOpenConflictSheet` receives only `pairId`, and its caller
  discards the click target. The cleanup focus call therefore always sees
  `null`. `Today.test.tsx` also has no assertions for initial focus, focus
  wrapping, Escape, inert background, or opener restoration.
- Impact: ISSUE-1 is only partially fixed. Layout, inert state, sentinels, and
  Escape handling exist, but the Sprint Contract's opener restoration and
  component-test requirements remain unmet.
- Fix direction: Capture the trigger element before the async conflict fetch,
  restore focus to it when the resolved sheet unmounts, and add focused tests
  for initial focus, both sentinel wraps, Escape/close, inert state, and opener
  restoration.

### ISSUE-7 [LOW] Codebase map still contains the stale profile-schema claim

- Location: `docs/codebase-map.md:203`
- Analysis: The map still says `UpdatePersonProfileRequestSchema` validates
  shape only and the server enforces cross-field rules. The shared schema
  itself has both half-empty-window and weekday-overlap refinements. The Today
  entry also claims opener focus restoration even though ISSUE-1 remains.
- Impact: The plan's required Cycle 23 correction and accurate Cycle 24 UI map
  are incomplete.
- Fix direction: Document the shared cross-field refinements accurately and
  describe opener restoration only after it is wired and tested.

### ISSUE-8 [LOW] Changed-event and outcome rendering lacks regression tests

- Location: `web/src/Today.test.tsx:1385`
- Analysis: The resolved state now renders `changedEvent.title` and the outcome,
  but no frontend test asserts `미팅 B — 이동` or `미팅 B — 취소`. Existing
  moved/cancelled tests assert sheet presence, draft
  copy, or clipboard feedback only.
- Impact: ISSUE-2's code defect is fixed, but its requested exact moved and
  cancelled UI coverage and the Sprint Contract proof remain incomplete.
- Fix direction: Add exact resolved-heading assertions for both outcomes and
  verify the title comes from the parsed response's `changedEvent`.

## Previous Issue Status

- ISSUE-1: UNRESOLVED
- ISSUE-2: RESOLVED
- ISSUE-3: RESOLVED
- ISSUE-4: RESOLVED
- ISSUE-5: RESOLVED
- ISSUE-6: RESOLVED
- ISSUE-7: UNRESOLVED

## Regression Check

No regression found in response validation, Clipboard API fallback,
transaction executor typing, notification ordering, combined unknown reasons,
or exact backend templates. ISSUE-8 is a missing frontend regression test, not
a confirmed runtime regression.

## Sprint Contract Check

- Existing resolve validation/error/status/annotation behavior: PASS.
- Draft selection, transaction atomicity, deterministic templates, profile
  honesty, ordering, and combined reasons: PASS.
- Required success-response runtime validation: PASS.
- Clipboard rejection and unavailable-API fallback: PASS.
- Resolved sheet layout, inert state, focus sentinels, and Escape code: PASS.
- Opener focus restoration and accessibility component tests: FAIL (ISSUE-1).
- Changed event plus outcome rendering: PASS in code; required exact frontend
  coverage: FAIL (ISSUE-8).
- No automatic delivery, persistence, LLM dependency, or migration: PASS.
- `docs/codebase-map.md` accuracy: FAIL (ISSUE-7).
- Manual mobile/wide, light/dark, deployed-HTTPS clipboard, keyboard,
  screen-reader, 44px, and reduced-motion checks: NOT RUN.

## Automatic Checks

- `corepack pnpm db:generate`: PASS (no schema changes).
- `corepack pnpm test:integration`: PASS (12 files, 302 tests).
- `corepack pnpm verify`: PASS (shared 33, server 25, web 203; integration 302;
  build and PWA assertion passed).
- `git diff --check 403c841..HEAD`: PASS.

## Changes Outside Plan

None found.

## Cycle Artifact Check

- Cycle plan, status, four advisor-feedback files, and review-v1 are tracked.
- Worktree was clean before this review artifact was added.
- `status.txt` correctly remains `in_progress`.

<!-- RESOLVED-BOUNDARY · above=Codex immutable, below=Executor append-only · check-resolved-immutable.sh enforced -->

## RESOLVED

### Issue Classification
- ISSUE-1: APPLY
- ISSUE-7: APPLY
- ISSUE-8: APPLY

### Applied

RESOLVED: ISSUE-1 — opener element captured + opener focus restore made resilient to the post-resolve Today refetch, with focused accessibility tests
- `web/src/Today.tsx`: `handleOpenConflictSheet(pairId, opener)` now captures the trigger element (`conflictOpenerRef`) and its `pairId` (`conflictOpenerPairRef`) on click; conflict card opener carries `data-conflict-opener={pairId}`.
- Because completing/dismissing the resolved sheet refetches Today (`refresh()` flips to `loading` and remounts the card list), the sheet's unmount-cleanup `openerRef.current?.focus()` would target a detached node. `handleCompleteResolved` now re-queries the live opener via `document.querySelector('[data-conflict-opener=…]')` inside `requestAnimationFrame` (after `refresh()`) and restores focus to it. The unmount cleanup is retained as a harmless defensive no-op; the rAF re-query is the effective restore. When the resolved conflict no longer exists post-refetch, `live` is null and focus falls back to the document body rather than stranding on the detached node.
- `web/src/Today.test.tsx`: added a focused accessibility test asserting initial focus on 닫기, `inert` on `main.today-live`, both sentinel wraps (start→완료, end→닫기), Escape close, and opener focus restore to the live re-rendered element.
자동 체크: verify (lint/typecheck/build/web 206) ✅ / test:integration 302 ✅ / git diff --check ✅

RESOLVED: ISSUE-8 — exact resolved-heading assertions for both outcomes
- `web/src/Today.test.tsx`: added two tests asserting `getByRole("heading", { name: "미팅 B — 이동" })` and `"미팅 B — 취소"`, with the title sourced from the parsed response's `changedEvent` (eventB).
자동 체크: web test 206 ✅

RESOLVED: ISSUE-7 — codebase-map corrections
- `docs/codebase-map.md`: `UpdatePersonProfileRequestSchema` entry now states the shared schema itself carries both cross-field `.refine` checks (half-empty window: preferredWeekdays/preferredPeriods both-or-neither; preferred/unavailable weekday overlap), rejecting at the shared boundary — removing the stale "validates shape only; server enforces cross-field rules" claim (verified against `shared/src/people.ts:59-73`).
- Today resolved-draft entry now describes opener restoration precisely (`data-conflict-opener` capture + rAF live re-query after `refresh()`), accurate only now that ISSUE-1 is wired and tested.
자동 체크: verify ✅
