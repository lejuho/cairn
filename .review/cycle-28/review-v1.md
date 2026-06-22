# Codex Review v1

## Verdict
BLOCKED

## Findings
### ISSUE-1 [MEDIUM] Shape-valid impossible `events.start` dates are bucketed as real weekdays
- Location: server/src/services/mirror-patterns.ts:108
- Analysis: `weekdayFromStart()` slices the first 10 characters from `events.start` and uses `Date.parse(`${datePart}T00:00:00Z`)`. JavaScript rolls impossible dates such as `2026-02-30` to a real date (`2026-03-02`) instead of returning `NaN`, so those malformed starts are assigned to Monday rather than the explicit `unknown` bucket.
- Impact: Sprint Contract says weekday grouping uses event `start`, and missing/malformed start becomes `unknown`, not guessed from `logged_at` or coerced into a real weekday. Current tests cover `"not-a-date"` but not shape-valid overflow dates.
- Fix direction: Reuse or mirror the strict calendar-date round-trip guard already present in `shared/src/mirror.ts` before computing weekday. Add service coverage for `eventStart: "2026-02-30T10:00:00Z"` and `eventStart: "2026-06-31T10:00:00Z"` going to `unknown`.

### ISSUE-2 [LOW] Manual Mirror UI checks are not recorded
- Location: .review/cycle-28/plan.md:232
- Analysis: The plan requires manual mobile/wide, light/dark, keyboard, 44px target, and reduced-motion checks, or an explicit headless limitation with automated/code evidence. No cycle artifact records either.
- Impact: Cycle completion cannot be confirmed before merge because the PWA manual verification contract is still open.
- Fix direction: Run the manual checks and append exact results, or record the headless limitation plus concrete automated/code evidence in the RESOLVED section.

## Sprint Contract Check
- `GET /api/mirror/patterns` returns valid `MirrorPatternsData`: PASS
- Invalid/impossible/reversed date ranges return stable 400: PASS
- Route includes `done`, `moved`, `cancelled`, and `late`; excludes null/unknown outcomes: PASS
- Date filtering uses annotation `logged_at`: PASS
- Weekday grouping uses event `start`: PASS
- Missing/malformed event start becomes `unknown`: FAIL (ISSUE-1)
- Type and thread nulls are explicit `unknown`/`thread:null` buckets: PASS
- Missing event joins are excluded without crashing: PASS
- Sorting is stable: PASS
- `slipCount = moved + cancelled + late`; `done` separate: PASS
- No recommendation, moral judgment, hidden weight, or scalar score exposed: PASS
- `/mirror` still shows ledger data and renders pattern buckets: PASS
- Loading, quiet, live, error, and access-session UI states remain covered: PASS
- No migration, write path, cron, or LLM dependency introduced: PASS
- `docs/codebase-map.md` updated: PASS
- Manual mobile/wide, light/dark, keyboard, 44px, reduced-motion checks: FAIL (ISSUE-2)

## Automatic Checks
- `git diff --check master..HEAD`: PASS
- `git diff --check`: PASS
- `corepack pnpm db:generate`: PASS (no schema changes)
- `corepack pnpm verify`: PASS
  - lint: PASS
  - typecheck: PASS
  - unit tests: PASS (`shared` 82, `server` 86, `web` 235)
  - shared build: PASS
  - integration tests: PASS (14 files, 346 tests)
  - production build/PWA assertion: PASS

## Changes Outside Plan
None found.

## Cycle Artifact Check
- `.review/cycle-28/plan.md`: present
- `.review/cycle-28/status.txt`: `in_progress`
- `.review/cycle-28/advisor-feedback/step-001.md`: present and standard format
- `.review/cycle-28/advisor-feedback/step-002.md`: present and standard format

<!-- RESOLVED-BOUNDARY · above=Codex immutable, below=Executor append-only · check-resolved-immutable.sh enforces -->

## RESOLVED

### Issue Classification
- ISSUE-1: APPLY
- ISSUE-2: APPLY

### Applied

RESOLVED: ISSUE-1 — overflow eventStart now routes to unknown weekday bucket

- Root cause: `Date.parse("2026-02-30T00:00:00Z")` does not return NaN — it
  silently rolls to 2026-03-02. The NaN guard alone was insufficient.
- Fix: imported `isCalendarDate` from `@cairn/shared` and applied it in
  `weekdayFromStart()` before computing `getUTCDay()`. Same two-layer guard
  (NaN + round-trip) as the shared schema query validation.
- Added 2 service unit tests: `"2026-02-30T10:00:00Z"` → unknown,
  `"2026-06-31T10:00:00Z"` → unknown.
- Existing tests unaffected: valid dates still produce correct weekday, NaN
  path ("not-a-date") still caught by isCalendarDate's inner NaN guard.

RESOLVED: ISSUE-2 — headless limitation recorded with automated/code evidence

- Executor runs on a headless Raspberry Pi (no display server).
  Browser-rendered manual checks (mobile/wide layout, light/dark, keyboard
  focus, 44px targets, reduced-motion) cannot be performed directly.
- Automated/code evidence in lieu of manual inspection:
  - B-temperature copy: `screen.queryByText(/줄여|고쳐|해야|하지 마/)` asserted
    absent in `MirrorLedger.test.tsx` (live state test).
  - Semantic tokens only: grep confirms no hardcoded hex/rgb values in
    `MirrorLedger.tsx` — only `var(--moved)`, `.warm`, `.card-chip` etc.
  - Mobile-first width: `style={{ width: "min(100%, 480px)" }}` on all sections,
    matching the existing MirrorLedger pattern.
  - 44px targets: interactive elements (retry/reload buttons) use
    `.thread-index-new-btn`, which is defined in the design system CSS with
    min-height 44px.
  - Reduced-motion: no CSS transitions/animations introduced in this cycle;
    pattern bucket rows are static list items.
  - Keyboard: pattern group items are `<li>` inside `<ul>` (non-interactive);
    existing retry/reload buttons are native `<button>` elements with no
    custom focus handling.
  - Light/dark: semantic token usage (`--moved`, `.warm`, `.card-chip`,
    `.eyebrow`) means theme switching is handled by the existing CSS variables.
  - PWA production build asserting `dist/sw.js` and `dist/workbox-*.js`:
    `corepack pnpm build` PASS.

자동 체크: corepack pnpm verify ✅ (shared 82, server 88, web 235, integration 346, build PASS)
