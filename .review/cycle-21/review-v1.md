# Codex Review v1

## Verdict
BLOCKED

## Findings

### ISSUE-1 [MEDIUM] Relationship history compares RFC3339 timestamps lexically
- Location: `server/src/repositories/people.ts:63`
- Analysis: `queryMeetingStats` uses `r.end < nowIso`, and `lastMet` uses string
  ordering at line 71. RFC3339 strings with different offsets are not
  chronologically sortable as plain text. A past `+09:00` event can be treated
  as future against a `Z` clock, and the wrong event can become `lastMet`.
- Impact: `totalMeets`, `lastMet`, frequency bands, effective social cost, and
  advisory suggestion ordering can be wrong. This violates the deterministic
  relationship-stat and social-adjustment Sprint Contract.
- Fix direction: compare finite epoch milliseconds (or SQLite `unixepoch`) for
  both the past filter and latest-event selection while preserving the original
  RFC3339 string in the response. Add real SQLite integration coverage for
  mixed offsets, `lastMet`, and the explicitly required threshold boundaries
  `2` and `7` in addition to the existing `0/1/3/8` cases.

### ISSUE-2 [MEDIUM] Required `pnpm verify` fails lint
- Location: `web/src/InputHub.test.tsx:1`
- Analysis: web lint rejects unused `within`. Server lint also rejects unused
  `lt` and `or` in `server/src/repositories/people.ts:1`, unused `inArray` in
  `server/src/routes/decisions.ts:1`, and unused `idB` locals in
  `server/src/routes/decisions.integration.test.ts:598` and `:636`.
- Impact: the mandatory automatic check stops before typecheck, unit tests,
  integration tests, and build complete through the root `verify` contract.
- Fix direction: remove the six unused imports/locals, then rerun the full root
  verification command.

### ISSUE-3 [LOW] Codebase map claims both-blocked actions are absent
- Location: `docs/codebase-map.md:236`
- Analysis: the map says a both-blocked conflict has "no action buttons", but
  `web/src/Today.tsx:235` always renders both move/cancel action groups and
  disables them through `isDisabled`.
- Impact: the required navigation catalog is inaccurate and can misdirect the
  next implementation or review.
- Fix direction: describe the buttons as rendered-disabled, or change the UI
  to omit them if that is the intended contract. The plan permits disabled
  affected actions, so correcting the map is the smaller fix.

## Sprint Contract Check

- Hard-constraint read/replace/dedup/validation: PASS via temporary SQLite
  integration tests.
- Deterministic relationship stats: FAIL due to offset-sensitive lexical time
  comparison and missing `lastMet`/boundary `2`/boundary `7` coverage.
- Social-cost breakdown and no cross-dimension scalar: PASS for covered cases.
- Keep-side weekday guard and blocked suggestion behavior: PASS.
- Resolve guard re-check and no partial writes: PASS.
- InputHub weekday editor and selection preservation: PASS.
- Today social/constraint display and option-level disabling: PASS.
- Existing regression surfaces: PASS in executed test suites.
- No LLM dependency: PASS by source enumeration.
- No migration: PASS; Drizzle reports no schema changes.
- Codebase map update: FAIL due to ISSUE-3.

## Automatic Checks

- `corepack pnpm db:generate`: PASS (`No schema changes, nothing to migrate`)
- `corepack pnpm test:integration`: PASS (12 files, 250 tests)
- `corepack pnpm verify`: FAIL (lint; ISSUE-2)
- `git diff --check`: PASS

## Changes Outside Plan

- `AGENTS.md` adds postmortem/Hansei rules. This was an explicit user-requested
  governance change after planning, not unrequested feature scope. Accepted,
  but it should remain identified separately from People Guard implementation.

<!-- RESOLVED-BOUNDARY · above=Codex immutable, below=Executor append-only -->

## RESOLVED

### Issue Classification
- ISSUE-1: APPLY
- ISSUE-2: APPLY
- ISSUE-3: APPLY

### Applied

RESOLVED: ISSUE-1 — epoch-based timestamp comparison in queryMeetingStats
- `server/src/repositories/people.ts`: replaced lexical `r.end < nowIso` with `Date.parse(r.end) < nowMs`; added `Number.isFinite` guard; fixed `lastMet` reduce to use epoch comparison (preserving RFC3339 string value)
- `server/src/routes/decisions.integration.test.ts`: added boundary-2-meets (rare), boundary-7-meets (established), and mixed-offset test (proves filter and lastMet bugs separately)
- Integration tests: 250 → 253

RESOLVED: ISSUE-2 — unused imports and locals causing lint failure
- `web/src/InputHub.test.tsx`: removed unused `within` import
- `server/src/repositories/people.ts`: removed unused `lt`, `or` from drizzle-orm import
- `server/src/routes/decisions.ts`: removed unused `inArray` from drizzle-orm import
- `server/src/routes/decisions.integration.test.ts`: dropped unused `const idB =` at lines 598 and 636 (changed to discard return value)
- `corepack pnpm verify`: PASS (lint ✅ / typecheck ✅ / test ✅ / integration 253 ✅ / build ✅)

RESOLVED: ISSUE-3 — codebase map both-blocked description
- `docs/codebase-map.md`: corrected "no action buttons" → "rendered but disabled (not omitted)" to match actual Today.tsx behavior

自動チェック: lint ✅ / typecheck ✅ / unit 151 ✅ / integration 253 ✅ / build ✅
