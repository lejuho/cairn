# Codex Review v3

## Verdict

BLOCKED

## Findings

### ISSUE-8 [LOW] Profile-editor interaction test contract remains incomplete

- Location: `web/src/PersonDetail.test.tsx:283`
- Analysis: The newly added mutual-exclusion test repeats the already covered
  unavailable-to-preferred direction. There is still no test for
  preferred-to-unavailable clearing, saving-state backdrop blocking, or actual
  start/end focus wrapping.
- Impact: ISSUE-8's explicit fix contract is only partially applied. Passing
  component totals do not prove all required interaction boundaries.
- Fix direction: Add focused tests for the opposite mutual-exclusion direction,
  backdrop click during a pending save, and both focus-trap wrap directions.

## Previous Issue Status

- ISSUE-1: RESOLVED
- ISSUE-2: RESOLVED
- ISSUE-3: RESOLVED
- ISSUE-4: RESOLVED
- ISSUE-5: RESOLVED
- ISSUE-6: RESOLVED
- ISSUE-7: RESOLVED
- ISSUE-8: UNRESOLVED

## Regression Check

No regression found. Uniform PersonRow projections, inert background, shared
validation, cross-route guard, safe saving dismissal, focus restore, 44px
targets, and semantic tokens now satisfy their implementation contracts.

## Sprint Contract Check

- Shared validation and SQLite profile behavior: PASS.
- Cross-route contradiction prevention/no partial write: PASS.
- Uniform normalized PersonRow projections: PASS.
- Profile display, exact PUT body, save/refetch, and failure retention: PASS.
- Inert background and ordinary focus restore: PASS.
- Complete mutual-exclusion/backdrop/focus-wrap test coverage: FAIL (ISSUE-8).
- No LLM dependency or migration: PASS.
- `docs/codebase-map.md` update: PASS.
- Manual mobile/wide, light/dark, keyboard, and reduced-motion check: NOT RUN.

## Automatic Checks

- `corepack pnpm db:generate`: PASS (no schema changes).
- `corepack pnpm test:integration`: PASS (12 files, 294 tests).
- `corepack pnpm verify`: PASS (shared 23, server 7, web 193; integration 294;
  build and PWA assertion passed).
- `git diff --check master...HEAD`: PASS.

## Changes Outside Plan

None found.

<!-- RESOLVED-BOUNDARY · above=Codex immutable, below=Executor append-only · check-resolved-immutable.sh enforced -->

## RESOLVED

### Issue Classification
- ISSUE-8: APPLY

### Applied

RESOLVED: ISSUE-8 — Complete interaction test coverage (preferred→unavailable direction, backdrop-saving block, focus trap both directions)
- Added: preferred→unavailable mutual exclusion test (toggle preferred day first, then mark same day unavailable → preferred clears)
- Added: backdrop click blocked while saving (pending save → sheet stays open on backdrop click)
- Added: end sentinel focus wraps to first dialog button (Tab-forward wrap)
- Added: start sentinel focus wraps to last dialog button (Shift+Tab-backward wrap)
- No production code changed; 197 web tests pass
자동 체크: web test (197 tests) ✅ / verify ✅ / git diff --check ✅
