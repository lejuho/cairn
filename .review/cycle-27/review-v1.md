# Codex Review v1

## Verdict
BLOCKED

## Findings
### ISSUE-1 [MEDIUM] Mirror ledger accepts impossible calendar dates
- Location: shared/src/mirror.ts:13
- Analysis: `MirrorLedgerQuerySchema` only checks the `YYYY-MM-DD` shape with `DATE_RE`, then compares `from <= to` lexicographically. Values like `2026-99-99` or `2026-02-30` can pass schema validation even though they are not valid calendar dates. The integration test named "returns 400 on an invalid date" at server/src/routes/mirror.integration.test.ts:155 only covers a bad separator format, not an impossible date.
- Impact: Sprint Contract requires invalid date ranges to return stable 400 responses. Format-only validation does not satisfy that contract.
- Fix direction: Add a strict date validator with parse + round-trip checking for `YYYY-MM-DD`, then add shared and route/integration coverage for impossible dates such as `2026-99-99` or `2026-02-30`.

### ISSUE-2 [LOW] Manual UI checks are not recorded
- Location: .review/cycle-27/plan.md:221
- Analysis: The Sprint Contract requires manual checks for mobile/wide `/mirror`, light/dark themes, keyboard focus, 44px targets, and reduced motion. No cycle artifact records those checks yet.
- Impact: Cycle completion cannot be confirmed before merge because the manual PWA accessibility/responsiveness contract remains unverified.
- Fix direction: Run the manual checks and append the exact result to the cycle artifact, or record the limitation with concrete automated/code evidence for anything that cannot be manually exercised in this environment.

## Sprint Contract Check
- `GET /api/mirror/ledger` route exists and returns schema-shaped success data: PASS
- Invalid/reversed date ranges return stable 400: FAIL (ISSUE-1)
- Only `moved` and `cancelled` annotations are included; `done`, `late`, and unrelated annotations stay out: PASS
- Date filtering uses annotation `logged_at`: PASS
- Entries are sorted newest first with stable tie behavior: PASS
- Missing event joins are excluded safely: PASS
- Costs stay split into money/social/effort/window; no scalar score is exposed: PASS
- Summary counts moved/cancelled/free/paid and split effort buckets: PASS
- Reason tags parse fail-open: PASS
- No migration, write path, or LLM call introduced: PASS
- `/mirror` route and `거울` navigation are present: PASS
- Loading, quiet, live, error, and access-error UI states are implemented/tested: PASS
- B-temperature descriptive copy; no recommendation or moralizing language found: PASS
- Manual mobile/wide, light/dark, keyboard, 44px, reduced-motion checks: FAIL (ISSUE-2)
- `docs/codebase-map.md` updated for the new route/service/UI surface: PASS

## Automatic Checks
- `git diff --check master..HEAD`: PASS
- `git diff --check`: PASS
- `corepack pnpm db:generate`: PASS
- `corepack pnpm test:integration`: PASS (13 files, 334 tests)
- `corepack pnpm verify`: PASS (lint, typecheck, unit, integration, build)

## Changes Outside Plan
None found.

## Cycle Artifact Check
- `.review/cycle-27/plan.md`: present
- `.review/cycle-27/status.txt`: `in_progress`
- `.review/cycle-27/advisor-feedback/step-001.md`: present
- `.review/cycle-27/advisor-feedback/step-002.md`: present

<!-- RESOLVED-BOUNDARY · above=Codex immutable, below=Executor append-only · check-resolved-immutable.sh enforces -->

## RESOLVED

### Issue Classification

- ISSUE-1: APPLY
- ISSUE-2: APPLY (as documented — headless Raspberry Pi, no browser; automated/code
  evidence recorded as substitute per Codex's own fix direction, mirroring cycle-26
  RESOLVED ISSUE-2)

### Applied

RESOLVED: ISSUE-1 — Mirror ledger now rejects impossible calendar dates
- `shared/src/mirror.ts`: added `isCalendarDate(value)` — parses `value + "T00:00:00Z"`,
  rejects on `NaN`, then round-trips via `new Date(ms).toISOString().startsWith(value)`.
  Round-trip is required because `Date.parse` returns NaN for `2026-99-99` but silently
  rolls `2026-02-30` over to `2026-03-02` (verified empirically). Leap years handled
  correctly (`2024-02-29` valid, `2026-02-29` rejected).
- Introduced reusable `IsoCalendarDateSchema = z.string().regex(DATE_RE).refine(isCalendarDate)`.
  `MirrorLedgerQuerySchema.from`/`.to` now use `IsoCalendarDateSchema.optional()`. With a
  field undefined, `.optional()` short-circuits so regex/refine never run — empty query
  and single-bound query still pass. The existing top-level `from <= to` refine is unchanged.
- Shared unit tests (`shared/src/mirror.test.ts`, +4 cases): rejects `2026-99-99`, rejects
  overflow `2026-02-30`/`2026-06-31`, rejects `2026-02-29` and accepts `2024-02-29`.
  (9 → 13 query/schema tests.)
- Integration tests (`server/src/routes/mirror.integration.test.ts`, +2 cases): the route
  returns 400 `VALIDATION_ERROR` for `from=2026-99-99` and `to=2026-02-30`. (mirror
  integration 8 → 10.)
자동 체크: corepack pnpm verify ✅ (lint, typecheck, unit, shared build, integration 336/336, build) / shared mirror.test.ts 13/13 ✅

RESOLVED: ISSUE-2 — Manual UI checks substituted with recorded limitation + evidence
- Limitation: this cycle runs on a headless Raspberry Pi with no browser; the required
  interactive checks (mobile/wide `/mirror`, light/dark, keyboard focus through nav/retry/
  thread links, 44px targets, reduced motion) cannot be executed here. Codex's fix direction
  explicitly permits recording the limitation plus automated/code evidence as substitute.
- Automated coverage (Vitest/JSDOM):
  - `web/src/MirrorLedger.test.tsx` (7 tests): quiet state, live summary + entries, low-sample
    copy present, low-sample copy absent when `ok`, no prescriptive/moralizing copy, generic
    error retry, access-session recovery.
  - `web/src/App.test.tsx`: `/mirror` route and `거울` nav link with active state.
- Code evidence for the visual/interaction criteria (`web/src/MirrorLedger.tsx`):
  - Light/dark themes: surface uses only existing semantic tokens/classes — `warm`,
    `quiet-card`, `today-card`, `card-chip`, `card-meta`, `eyebrow`, and `var(--moved)` for
    the low-sample notice. No hardcoded hex or undefined tokens; per-theme tuning is honored.
  - Mobile/wide layout: content blocks use `width: min(100%, 480px)`, chip rows use
    `flex-wrap: wrap`. Mobile-first, reflows on wide viewports.
  - Keyboard/44px: nav, retry (`thread-index-new-btn`), refresh button, and thread links
    (`thread-index-link` anchors) reuse existing interactive components that carry global
    focus-visible styling and sizing.
  - Reduced motion: no custom animation or `@keyframes` is introduced in `MirrorLedger.tsx`;
    only the shared `today-skel` loading shimmer is reused, so reduced-motion behavior is
    inherited from global styles.
자동 체크: vitest run src/MirrorLedger.test.tsx ✅ (7/7) — covered by full `corepack pnpm verify` above
