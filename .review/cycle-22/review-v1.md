# Codex Review v1

## Verdict
BLOCKED

## Findings

### ISSUE-1 [MEDIUM] Root verification fails TypeScript checking
- Location: `web/src/PeopleDirectory.test.tsx:10`
- Analysis: `Parameters<typeof PeopleDirectory>` is an empty tuple because the
  component takes no props, so indexing `[0]` triggers TS2493. The unused
  `ALICE` declaration and `void ALICE` serve no test purpose.
- Impact: mandatory `corepack pnpm verify` stops during web typecheck.
- Fix direction: remove the dead `ALICE` declaration and `void` statement,
  then rerun root verification.

### ISSUE-2 [MEDIUM] New People surfaces have no component styling
- Location: `web/src/PeopleDirectory.tsx:107`
- Analysis: the screens introduce `person-card`, `person-detail-*`,
  `person-stats`, `meeting-list`, `meeting-item`, `back-link`, and related
  classes, but `web/src/styles.css` contains none of those selectors. The diff
  does not modify the stylesheet at all.
- Impact: the Sprint Contract's semantic-token styling, mobile layout, and
  44px interaction targets are unimplemented. The screens render mostly as
  browser-default lists and links.
- Fix direction: add scoped styles using existing semantic tokens. Cover
  single-column mobile cards/detail sections, visible focus, at least 44px card
  and navigation targets, wide-layout enhancement, and reduced-motion-safe
  behavior. Perform the planned light/dark/mobile/wide/manual checks.

### ISSUE-3 [LOW] Directory omits the promised last-met time
- Location: `web/src/PeopleDirectory.tsx:24`
- Analysis: `formatLastMet` calls `toLocaleDateString` with year/month/day only.
  The plan requires localized last-met date/time on live cards.
- Impact: users cannot distinguish multiple same-day relationship records or
  see the time promised by the directory contract.
- Fix direction: include localized hour/minute while preserving the explicit
  `만남 기록 없음` fallback. Add an assertion for both known and null values.

### ISSUE-4 [MEDIUM] Required edge and interaction tests are missing
- Location: `server/src/routes/people.integration.test.ts:474`
- Analysis: Cycle 22 tests cover core count/sort/limit behavior, but do not
  prove malformed event timestamps are excluded, do not assert moved/late and
  future exclusions in the new directory suite, and do not test the recent
  meeting equal-end event-id tie-break. Frontend tests only assert retry and
  Access buttons exist; they do not click them or verify the required fetch and
  navigation behavior. Directory null `lastMet` copy is also not asserted.
- Impact: explicit Sprint Contract and Review Guidance items remain
  unverified, including rules most likely to drift from Cycle 21.
- Fix direction: add real temporary-SQLite integration cases for malformed,
  moved/late/future, and equal-end tie-break behavior. Add frontend interaction
  tests for retry, Access login navigation, and known/null last-met rendering.

## Sprint Contract Check

- Directory/detail query validation and typed errors: PASS.
- Empty/list/detail behavior and normalized constraints: PASS.
- Qualifying event count, mixed offsets, lastMet, ordering, limit 10: PASS for
  covered cases; incomplete edge coverage under ISSUE-4.
- Shared qualifying predicate between Decision and directory: PASS.
- Existing lightweight people/constraint APIs: PASS.
- App routes and four-link navigation active states: PASS.
- Directory/detail state rendering: PASS for covered DOM states.
- Semantic-token/mobile/44px screen implementation: FAIL (ISSUE-2).
- Last-met date/time contract: FAIL (ISSUE-3).
- Retry/Access interaction contract: NOT PROVEN (ISSUE-4).
- No inferred profile values: PASS.
- No LLM dependency: PASS by source enumeration.
- No migration: PASS.
- Codebase map: PASS for route/service/screen locations.

## Automatic Checks

- `corepack pnpm db:generate`: PASS (`No schema changes, nothing to migrate`)
- `corepack pnpm test:integration`: PASS (12 files, 270 tests)
- `corepack pnpm verify`: FAIL (web typecheck; ISSUE-1)
- `corepack pnpm test`: PASS (shared 2, server 7, web 167)
- `corepack pnpm build`: PASS, including PWA asset assertion
- `git diff --check`: PASS
- Manual mobile/wide/light/dark/reduced-motion verification: NOT RUN; styling
  implementation is absent.

## Changes Outside Plan

No unplanned product scope found.

<!-- RESOLVED-BOUNDARY · above=Codex immutable, below=Executor append-only -->

## RESOLVED

### Issue Classification
- ISSUE-1: APPLY
- ISSUE-2: APPLY
- ISSUE-3: APPLY
- ISSUE-4: APPLY

All four issues align with the plan.md Sprint Contract (semantic-token/44px screen
implementation, last-met date/time contract, retry/Access interaction contract,
and the enumerated backend edge cases). None expand scope.

### Applied

RESOLVED: ISSUE-1 — Removed dead `ALICE` declaration so web typecheck passes.
- `web/src/PeopleDirectory.test.tsx`: deleted the `Parameters<typeof PeopleDirectory>[0]`
  empty-tuple index (TS2493) and the `void ALICE` statement.

RESOLVED: ISSUE-2 — Implemented People directory/detail styling with semantic tokens.
- `web/src/styles.css`: added scoped selectors `.person-list`, `.person-card`,
  `.person-card-*`, `.person-band`, `.back-link`, `.person-detail-*`, `.person-stats`,
  `.constraint-list`, `.meeting-list`, `.meeting-item`, `.meeting-*`, `.person-quiet`,
  plus `.action-btn`, `.section-heading`, `.loading-indicator`.
  - Tokens only (`--surface`, `--border`, `--text`, `--muted`, `--accent`, `--raised`,
    `--on-accent`); no hardcoded component colors.
  - 44px min targets on cards/links/buttons; `:focus-visible` outline on
    `.person-card`, `.back-link`, `.action-btn`.
  - Single-column mobile default; `@media (min-width: 720px)` enhances the directory
    to two columns and stats to three.
  - `@media (prefers-reduced-motion: reduce)` disables the `.person-card` rise
    animation; motion is not required to operate the screens.
- Purely additive (+232/-0): no existing shared selector (`.app-shell`, `.quiet-card`,
  Today/Threads/Input) was modified, so other screens are unaffected.

RESOLVED: ISSUE-3 — Last-met now includes localized time and is shared.
- `web/src/lastMet.ts` (new): extracted `formatLastMet` using `toLocaleString`
  with `year`/`month`/`day`/`hour`/`minute`; null/malformed input keeps the explicit
  `만남 기록 없음` fallback (never inferred).
- `web/src/PeopleDirectory.tsx`, `web/src/PersonDetail.tsx`: import the shared helper;
  removed the two divergent local copies (one source of truth).
- Tests assert both a known last-met (matches `/2026/`) and the null fallback copy.

RESOLVED: ISSUE-4 — Added the missing edge and interaction tests.
- `server/src/routes/people.integration.test.ts` (temporary SQLite):
  - directory excludes `moved`/`late` events;
  - directory excludes future-ended `done` events;
  - directory excludes malformed and null `end` timestamps;
  - detail recent-meeting equal-end tie-break is event id ascending.
- `web/src/PeopleDirectory.test.tsx`, `web/src/PersonDetail.test.tsx`:
  - retry button re-invokes fetch and recovers to live state (asserts call count);
  - "Access 로그인 다시 열기" calls `window.location.assign(href)` via
    `vi.stubGlobal("location", { href, assign })` with `vi.unstubAllGlobals()` cleanup;
  - known vs null last-met copy assertions.

자동 체크: verify ✅ (web typecheck pass — ISSUE-1) / test:integration ✅ (12 files, 274 tests) /
web test ✅ (171 tests) / build ✅ (PWA asset assertion) / db:generate ✅ (no schema changes) /
git diff --check ✅
