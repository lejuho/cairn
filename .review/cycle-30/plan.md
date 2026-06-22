# Watcher A Today Loop Implementation Plan

Branch: feature/cycle-30-watcher-a-today-loop
Skills: backend-fastify, frontend-react-pwa

## Summary

Cycle 30 completes the smallest useful Watcher A product loop on top of the
existing watcher table, create route, snooze route, and Today watcher card.

Current state:

- `POST /api/watchers` creates a date-threshold A watcher.
- `PATCH /api/watchers/:id/snooze` stores `snoozed_until`.
- `GET /api/today` already includes raw watcher rows whose `threshold <= date`
  and whose snooze has expired.
- `/today` renders a simple watcher card with label and threshold.

This cycle turns that thin path into an explicit deterministic evaluation
contract: parse/validate Watcher A rules, expose a derived Today bubble payload,
show why the watcher surfaced, and let the user snooze it directly from Today.

Out of scope:

- `/watch` deep management screen;
- cron daemon/systemd timer wiring;
- external B watchers, keyword search, n8n, or web crawling;
- reverse planning chains;
- procurement-specific watcher types;
- LLM usage;
- schema migration, unless the executor proves the existing `watchers` columns
  are insufficient.

## Input/Output Spec

- Input:
  - `GET /api/today?date=YYYY-MM-DD&now=<RFC3339 with offset>`
    - Existing query contract remains unchanged.
    - Watcher evaluation uses the request `date` and `now`; no `Date.now()` in
      the pure evaluator.
  - `PATCH /api/watchers/:id/snooze`
    - Existing body: `{ "snoozedUntil": "<RFC3339 with offset>" }`
    - Used by Today "snooze" action.

- Output:
  - `TodaySurface.watcherBubbles` and watcher cards use a derived Watcher A
    bubble shape instead of raw rows:

```json
{
  "id": 1,
  "label": "토너 주문",
  "category": "procurement",
  "kind": "A",
  "threshold": "2026-06-22",
  "snoozedUntil": null,
  "daysOverdue": 0,
  "reasonCodes": ["date_threshold_due"],
  "message": "오늘 확인할 watcher야"
}
```

  - A watcher appears only when:
    - `armed === 1`;
    - `kind === "A"`;
    - rule is a supported deterministic date-threshold rule or has a valid
      fallback `threshold`;
    - effective threshold date is `<= TodayQuery.date`;
    - `snoozed_until` is absent or `<= TodayQuery.now`.
  - Unsupported/malformed rules do not crash Today. They are excluded from the
    bubble list and covered by tests.
  - Today snooze action:
    - Success: PATCH watcher snooze, then refresh Today; card disappears when
      the new snooze is in the future.
    - Failure: keep the card visible and show a local error.
    - Access-session errors use the existing `apiJson` classification.

## Key Changes

- Shared:
  - Extend `shared/src/watchers.ts` with:
    - `WatcherABubbleSchema` or equivalent derived Today bubble contract;
    - `WatcherReasonCodeSchema` for deterministic reasons such as
      `date_threshold_due`, `snoozed`, and `unsupported_rule` if surfaced in
      tests;
    - exported types used by `TodaySurfaceSchema`.
  - Update `shared/src/today.ts` so `watcherBubbles` and watcher cards use the
    derived bubble schema, not raw `WatcherRowSchema`.
  - Add shared tests for valid bubble parsing, strictness, reason enum
    validation, and Today watcher-card payload compatibility.

- Backend:
  - Add a pure watcher evaluation service, for example
    `server/src/services/watchers.ts`:
    - accepts `WatcherRow[]`, `date`, and `now`;
    - parses `rule` JSON fail-open;
    - supports `date_threshold` with `fireOn`;
    - falls back to `threshold` when rule is absent/malformed but threshold is a
      strict `YYYY-MM-DD`;
    - filters by armed/kind/threshold/snooze;
    - computes `daysOverdue` deterministically from UTC date strings;
    - returns stable sorted bubbles, e.g. threshold asc, id asc.
  - Keep repository DB reads simple and read-only for Today. Existing
    `findFiredWatchers` may be replaced with `findAllWatchersForEvaluation` or
    narrowed without introducing writes.
  - Update `server/src/routes/today.ts` to call the evaluator and pass derived
    bubbles into `buildTodaySurface`.
  - Keep `PATCH /api/watchers/:id/snooze` behavior stable; add integration
    coverage for Today refresh hiding snoozed bubbles if needed.
  - No LLM, no cron, no migration.

- Frontend:
  - Update `web/src/Today.tsx` watcher card:
    - render label/category/threshold/message/daysOverdue from the bubble;
    - include a "내일 다시 보기" or equivalent snooze button;
    - compute snooze target from the current loaded `surface.now`, not local
      wall-clock time;
    - on success refresh Today;
    - on failure leave the card in place with a local error.
  - Preserve card priority: conflict → watcher → next event → two-minute task →
    needs-review → schedule prompt.
  - Keep mobile-first styling, semantic tokens only, >=44px touch target, and
    reduced-motion safety.
  - Existing Today states must remain covered: loading, quiet, live, error,
    access-session.

- Docs:
  - Update `docs/codebase-map.md` with:
    - watcher evaluator service;
    - derived shared watcher bubble contract;
    - Today watcher snooze behavior.

## Sprint Contract

- Pass criteria:
  - Watcher A evaluation is deterministic and pure.
  - Armed date-threshold A watchers surface in Today when due.
  - Future thresholds do not surface.
  - `armed=0` watchers do not surface.
  - Future `snoozed_until` hides a watcher.
  - Expired `snoozed_until` allows a watcher to surface again.
  - Malformed/unsupported watcher rules do not crash Today.
  - Derived watcher bubbles contain stable reason/message fields and no hidden
    scalar priority score.
  - Today watcher card exposes snooze action; successful snooze refreshes and
    removes the card.
  - Failed snooze keeps the card visible and shows local error.
  - Access-session handling remains consistent with existing `apiJson` flows.
  - No new LLM, cron, external network, migration, or write path from
    `GET /api/today`.
  - `docs/codebase-map.md` is updated.

- Automatic checks:
  - `corepack pnpm db:generate`
  - `corepack pnpm lint`
  - `corepack pnpm typecheck`
  - `corepack pnpm test`
  - `corepack pnpm test:integration`
  - `corepack pnpm build`
  - `corepack pnpm verify`
  - `git diff --check`

- Test cases:
  - Shared unit:
    - valid watcher bubble parses;
    - unexpected `score` or recommendation/advice field is rejected if schema is
      strict;
    - invalid reason code is rejected;
    - Today watcher card payload uses the derived bubble schema.
  - Service unit:
    - due date-threshold watcher surfaces;
    - future threshold hidden;
    - `armed=0` hidden;
    - wrong kind hidden;
    - future snooze hidden;
    - expired snooze surfaces;
    - malformed rule with valid `threshold` falls back safely;
    - malformed rule without valid threshold hidden;
    - `daysOverdue` is deterministic and non-negative.
  - Backend integration:
    - `GET /api/today` returns derived watcher bubbles from real SQLite rows;
    - snoozed watcher is hidden;
    - expired snooze reappears;
    - malformed rule row does not 500;
    - `GET /api/today` does not mutate `last_fired` or other watcher fields.
  - Frontend:
    - live Today renders watcher message/reason;
    - snooze button calls `PATCH /api/watchers/:id/snooze` with a future
      timestamp based on `surface.now`;
    - success refetches Today and hides the card;
    - failure keeps card visible with error;
    - loading/quiet/error/access-session states remain covered;
    - card priority remains conflict before watcher before next event.
  - Manual checks:
    - mobile and wide `/today`;
    - light and dark themes;
    - keyboard focus through watcher snooze button and existing card actions;
    - 44px touch target and reduced-motion behavior.

- gas limit: N/A
- slither pass: N/A

## Three Missing Edge-Case Candidates

- A watcher has `threshold="2026-02-30"` from old or manual DB data. The
  evaluator must hide it or treat it as unsupported without crashing.
- `surface.now` is close to midnight and the user taps snooze. The snooze target
  must be strictly future relative to `surface.now`, not the browser clock.
- Multiple due watchers have the same threshold. Sort order must be stable so
  UI tests and user scanning do not jitter.

## Simpler Alternative

Keep returning raw `WatcherRow` from Today and add only a frontend snooze
button. This is faster, but it leaves rule parsing and user-facing reason copy
implicit in the UI. A small pure evaluator plus derived shared contract makes
Watcher A reviewable before cron and `/watch` are added.

## Assumptions

- Cycle 30 may reuse the existing `watchers` table columns.
- A-level watcher rules are date-threshold only: `{"type":"date_threshold",
  "fireOn":"YYYY-MM-DD"}`.
- Today remains a read-only aggregate. Surfacing a watcher does not update
  `last_fired`; a later cron cycle may define that write path explicitly.
- Snooze duration for the Today button can be a fixed next-day value for this
  slice.
- Browser manual checks may be recorded as limitation + automated/code evidence
  if execution is headless, but the limitation must be explicit.

## Review Guidance

### Enumeration Required

- Shared watcher/Today contracts:
  - Search:
    `rg -n "Watcher.*Bubble|WatcherReason|watcherBubbles|kind.*watcher" shared/src`
  - Expected: Today uses the derived bubble contract; raw watcher row remains
    available for create/snooze API responses.

- Watcher evaluator boundary:
  - Search:
    `rg -n "evaluate.*Watcher|date_threshold|daysOverdue|snoozedUntil|armed" server/src`
  - Expected: pure service owns rule parsing, date comparison, snooze filtering,
    derived message/reasons, and sorting.

- Today read-only boundary:
  - Search:
    `rg -n "lastFired|update\\(|insert\\(|delete\\(" server/src/routes/today.ts server/src/services/today.ts server/src/services/watchers.ts`
  - Expected: Today path does not mutate watcher state.

- Frontend watcher action:
  - Search:
    `rg -n "watcher|snooze|watchers/.*/snooze|내일|다시" web/src/Today.tsx web/src/Today.test.tsx`
  - Expected: watcher card has snooze action, local failure state, and refresh on
    success.

- No LLM/external dependency:
  - Search:
    `rg -n "completeChat|createLlmGateway|LLM_PROXY_BASE_URL|fetch\\(" server/src/services/watchers.ts server/src/routes/today.ts`
  - Expected: evaluator and Today route do not import/call LLM or external
    network.

- Codebase map:
  - Search:
    `rg -n "Watcher A|watcher bubble|evaluate.*Watcher|snooze" docs/codebase-map.md`
  - Expected: new evaluator, shared contract, and Today UI behavior are
    documented.

### Verification Method Guide

- Rule parsing/date filtering/snooze logic:
  - Pure service unit tests are sufficient for most cases.
  - Use real SQLite integration tests for route wiring and malformed persisted
    rows.

- Today card ordering and access-session behavior:
  - Frontend Vitest/JSDOM tests are sufficient.

- `GET /api/today` no-write guarantee:
  - Integration test should snapshot the watcher row before/after a Today read
    or explicitly verify `last_fired` remains unchanged.

- No migration:
  - `corepack pnpm db:generate` should report no schema changes.

- Manual UI:
  - Manual mobile/wide, light/dark, keyboard, 44px, and reduced-motion checks
    are required, or an explicit headless limitation plus concrete automated/code
    evidence must be recorded in RESOLVED.
