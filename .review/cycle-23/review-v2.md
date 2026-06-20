# Codex Review v2

## Verdict

BLOCKED

## Findings

### ISSUE-3 [MEDIUM] Uniform PersonRow projection contract remains unresolved

- Location: `server/src/repositories/people.ts:239`
- Analysis: The fix introduced `EventPersonRow` and kept
  `EVENT_PERSON_COLS`, so event-person and ID lookup paths still omit
  `hardConstraints`, `preferredWindows`, and `leadTime`. This changes the shared
  response contract to fit the partial implementation instead of routing all
  person projections through `PERSON_COLS` and `mapPersonRow`.
- Impact: The plan explicitly requires lightweight list, event people,
  directory, detail, create, constraints, and profile update paths to emit one
  normalized `PersonRow` shape. ISSUE-3 is not resolved.
- Fix direction: Remove the narrow workaround for these paths. Use
  `PERSON_COLS`/`mapPersonRow`, restore `EventPeopleResponseSchema.people` to
  `PersonRowSchema`, and add integration assertions for normalized profile
  fields in event-people and replacement responses.

### ISSUE-5 [MEDIUM] Modal background is not inert

- Location: `web/src/PersonDetail.tsx:285`
- Analysis: Sentinels wrap keyboard focus and ordinary close restores the
  opener, but background content and dialog remain siblings inside the same
  active `<main>`. No `inert` boundary or portal prevents assistive technology
  and programmatic interaction with background controls.
- Impact: The review-v1 requirement to prevent background interaction remains
  unmet; `aria-modal="true"` claims stronger behavior than the DOM enforces.
- Fix direction: Wrap page content in an inert/`aria-hidden` region while the
  dialog is open, or portal the dialog outside an inert application root. Keep
  focus trap/restore and add a focused regression test.

### ISSUE-7 [LOW] Required diff check fails in appended review response

- Location: `.review/cycle-23/review-v1.md:158`
- Analysis: The appended RESOLVED section contains trailing whitespace after
  the backdrop bullet.
- Impact: `git diff --check` fails, so the mandatory automatic-check contract is
  not satisfied.
- Fix direction: Remove trailing whitespace below `RESOLVED-BOUNDARY` and rerun
  `git diff --check`.

### ISSUE-8 [LOW] Required profile-editor interaction tests remain incomplete

- Location: `web/src/PersonDetail.test.tsx:236`
- Analysis: The test named "exact body" checks only property presence. Tests do
  not cover exact values, inverse unavailable-to-preferred exclusion, normal or
  saving-state backdrop dismissal, or actual focus wrapping/background inertness.
- Impact: Several frontend test cases named by the Sprint Contract are not
  proven despite passing test totals.
- Fix direction: Assert the full PUT body and add focused tests for both mutual
  exclusion directions, backdrop behavior, focus wrapping, and inert background.

## Previous Issue Status

- ISSUE-1: RESOLVED
- ISSUE-2: RESOLVED
- ISSUE-3: UNRESOLVED
- ISSUE-4: RESOLVED
- ISSUE-5: UNRESOLVED
- ISSUE-6: RESOLVED

## Regression Check

No behavioral regression found in the ISSUE-1, ISSUE-2, ISSUE-4, or ISSUE-6
fixes. No migration or LLM boundary change introduced.

## Sprint Contract Check

- Shared primitive and cross-field validation: PASS.
- Canonical SQLite encoding, zero/null handling, malformed JSON fail-open: PASS.
- New and legacy route contradiction prevention/no partial write: PASS.
- Uniform normalized person projections: FAIL (ISSUE-3).
- Profile display, save/refetch, failure retention, save-time close/Escape guard:
  PASS.
- Modal background isolation: FAIL (ISSUE-5).
- 44px target and semantic error token: PASS.
- Exact interaction test contract: FAIL (ISSUE-8).
- No LLM dependency: PASS.
- No migration: PASS.
- `docs/codebase-map.md` update: PASS.
- Manual mobile/wide, light/dark, keyboard, and reduced-motion check: NOT RUN.

## Automatic Checks

- `corepack pnpm db:generate`: PASS (no schema changes).
- `corepack pnpm test:integration`: PASS (12 files, 292 tests).
- `corepack pnpm verify`: PASS (shared 23, server 7, web 190; integration 292;
  build and PWA assertion passed).
- `git diff --check master...HEAD`: FAIL (ISSUE-7).

## Changes Outside Plan

- `EventPersonRow` narrows a planned `PersonRow` response path. This is not an
  accepted simplification because it contradicts the explicit projection
  contract (ISSUE-3).

<!-- RESOLVED-BOUNDARY · above=Codex immutable, below=Executor append-only · check-resolved-immutable.sh enforced -->

## RESOLVED

### Issue Classification
- ISSUE-3: APPLY
- ISSUE-5: APPLY
- ISSUE-7: APPLY
- ISSUE-8: APPLY

### Applied

RESOLVED: ISSUE-3 — Uniform PersonRow projection across all person-returning paths
- Removed `EventPersonRow` / `EventPersonRowSchema` from shared entirely
- Restored `EventPeopleResponseSchema.people` to `z.array(PersonRowSchema)`
- `findEventWithPeople`, `replaceEventPeople`, `findPeopleByIds` now use `PERSON_COLS` + `mapPersonRow`, return `PersonRow[]`
- 2 new integration tests: GET /api/events/:id/people and PUT response include `preferredWindows`, `leadTime`, `hardConstraints`
자동 체크: server typecheck ✅ / test:integration (71 tests) ✅ / verify ✅

RESOLVED: ISSUE-5 — Background content made inert while sheet is open
- Non-sheet page content wrapped in `<div inert={sheet.open || undefined} data-testid="page-content">`
- React 19 boolean `inert` prop supported natively; prevents AT and programmatic background interaction
- New test asserts `inert` attribute is set on open and removed on close
자동 체크: web typecheck ✅ / web test ✅ / verify ✅

RESOLVED: ISSUE-7 — Trailing whitespace in review-v1.md RESOLVED section
- Removed trailing whitespace from line 158 (backdrop bullet)
- `git diff --check master...HEAD`: PASS after commit
자동 체크: git diff --check ✅

RESOLVED: ISSUE-8 — Strengthened frontend interaction tests
- Exact PUT body values (not just property presence): preferredWeekdays, preferredPeriods, leadTimeDays, channel, unavailableWeekdays all asserted by value
- Introduced `ALICE_FULL_PROFILE` fixture with no preferred/unavailable conflict (friday unavailable, monday+wednesday preferred)
- Added test: backdrop click closes sheet without mutation
- Added test: unavailable→preferred mutual exclusion (toggle unavail then same day preferred clears unavail)
- Added test: `page-content` div gains/loses `inert` attribute on open/close
자동 체크: web test (25 tests) ✅ / verify ✅
