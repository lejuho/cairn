# Codex Review v4

## Verdict

READY_TO_MERGE

## Findings

None.

## Previous Issue Status

- ISSUE-1: RESOLVED
  - Unsupported watcher rows render the same armed toggle as other rows.
  - JSDOM coverage includes unsupported row toggle rendering.
- ISSUE-2: RESOLVED
  - `docs/codebase-map.md` includes `/watch` route/nav entries plus watcher
    routes, deep-view service, shared contracts, and `/watch` UI notes.
- ISSUE-3: RESOLVED
  - Manual browser execution was not available in this environment, and the
    RESOLVED evidence records the headless limitation plus code/test evidence.
- ISSUE-4: RESOLVED
  - Watcher status chips now use semantic tokens only.
  - The remaining watcher toggle/error hardcoded fallbacks were removed:
    `background: var(--surface)` and `color: var(--cancelled)`.

## Regression Check

No regression found in the v3 fix. The watcher deep-view behavior remains
unchanged; the final change only removes CSS fallback literals from watcher UI
styles.

## Sprint Contract Check

- `GET /api/watchers` returns all watcher rows with derived deep-view status:
  PASS.
- Due kind-A rows match Today evaluator semantics for threshold/snooze: PASS.
- Disarmed watchers remain visible in `/watch` but do not appear in Today
  watcher bubbles: PASS.
- Snoozed watchers show `snoozed` in `/watch` while hidden from Today until
  `snoozedUntil <= now`: PASS.
- Malformed or unsupported rows are visible as `unsupported`, not fabricated as
  due: PASS.
- `PATCH /api/watchers/:id/armed` persists only armed state: PASS.
- Existing `POST /api/watchers` and `PATCH /api/watchers/:id/snooze` keep
  behavior: PASS.
- `/watch` route renders loading, quiet, live, error, and access-session states:
  PASS.
- `/watch` can create a kind-A watcher through existing POST route: PASS.
- `/watch` can arm/disarm and snooze with local error handling: PASS.
- App navigation includes "여백" and active state works on `/watch`: PASS.
- No LLM, cron, external network, migration, or watcher B automation introduced:
  PASS.
- `docs/codebase-map.md` updated: PASS.
- Manual UI checks: PASS with recorded limitation. Direct mobile browser
  execution was not available in this environment; headless/JSDOM coverage and
  source inspection cover loading, quiet, live, error, access-session,
  create-sheet, armed toggle, snooze, nav, touch-target, reduced-motion, and
  semantic-token requirements.

## Automatic Checks

- `git diff --check master..HEAD`: PASS
- `corepack pnpm db:generate`: PASS, no schema changes
- `corepack pnpm verify`: PASS
  - lint: PASS
  - typecheck: PASS
  - shared unit tests: 149 PASS
  - server unit tests: 168 PASS
  - web unit tests: 275 PASS
  - shared build: PASS
  - server SQLite integration tests: 400 PASS
  - production build/PWA generation: PASS

## Changes Outside Plan

None found.

<!-- RESOLVED-BOUNDARY · above=Codex immutable, below=Executor append-only · check-resolved-immutable.sh enforces -->

## RESOLVED
