# Watcher Deep View A Implementation Plan

Branch: feature/cycle-33-watcher-deep-view-a
Skills: backend-fastify, frontend-react-pwa

## Summary

Cycle 33 adds the first `/watch` deep view for Watcher A.

Current state:

- Watcher persistence already exists in `watchers`.
- Backend already supports:
  - `POST /api/watchers` for armed kind-A date-threshold watchers;
  - `PATCH /api/watchers/:id/snooze` for Today snooze.
- Today already surfaces derived `WatcherABubble[]` from deterministic
  `evaluateWatcherA`.
- No `/watch` route, navigation entry, all-watcher list, armed toggle, or
  watcher creation UI exists.

This cycle implements an A-only deterministic deep view:

- list all watchers, including quiet, due, snoozed, and disarmed rows;
- show why each watcher is quiet or surfaced;
- allow arming/disarming;
- allow date-threshold watcher creation;
- allow snoozing due watchers from the deep view;
- add `/watch` navigation.

Out of scope:

- cron scheduling or push delivery;
- watcher B automatic web monitoring;
- external crawling, n8n, or network calls;
- reverse planning / lead-time chain;
- spending timeline;
- deletion, bulk edit, or watcher templates;
- migration unless current `watchers` columns prove insufficient.

## Input/Output Spec

- Input:
  - `GET /api/watchers?date=YYYY-MM-DD&now=<RFC3339>`
    - Returns all watchers with deterministic deep-view status.
    - `date` and `now` are required so UI/tests do not depend on server clock.
  - `POST /api/watchers`
    - Existing route. Body: `label`, `threshold`, optional `category`.
    - Remains kind-A date-threshold only.
  - `PATCH /api/watchers/:id/armed`
    - Body: `{ "armed": true | false }`.
    - Immediate persistence. Disarmed watchers must disappear from Today but
      remain visible in `/watch`.
  - `PATCH /api/watchers/:id/snooze`
    - Existing route. Body unchanged.

- Output:
  - `GET /api/watchers`
    - Proposed data shape:

```json
{
  "watchers": [
    {
      "id": 1,
      "category": "travel",
      "label": "여권 갱신",
      "kind": "A",
      "armed": true,
      "threshold": "2026-06-20",
      "snoozedUntil": null,
      "status": "due",
      "daysOverdue": 2,
      "daysUntil": null,
      "message": "2일 지난 watcher야",
      "reasonCodes": ["date_threshold_due"]
    }
  ]
}
```

  - Status values:
    - `due` — armed kind-A watcher threshold is reached and not snoozed;
    - `quiet` — armed kind-A watcher threshold is in the future;
    - `snoozed` — armed kind-A watcher threshold reached, but snooze is still
      active;
    - `disarmed` — `armed=0`, always quiet from Today;
    - `unsupported` — non-A or malformed watcher row, shown honestly and never
      surfaced as due.
  - Failure:
    - malformed query/body/path returns stable validation error;
    - missing watcher id returns stable not-found error;
    - failed create/toggle/snooze keeps `/watch` UI in place with local error.

## Key Changes

- Shared:
  - Extend `shared/src/watchers.ts` with:
    - `WatchersQuerySchema`;
    - `WatcherDeepStatusSchema`;
    - `WatcherDeepRowSchema`;
    - `WatcherListResponseDataSchema`;
    - `PatchWatcherArmedRequestSchema`;
    - response schemas/types for create, armed toggle, and snooze if missing.
  - Keep schemas strict. Reject injected fields such as `score`,
    `recommendation`, or automatic action flags.

- Backend:
  - Extend watcher repository:
    - `findAllWatchers(db)` returns all rows, ordered by due/snooze usefulness
      in a deterministic way or leaves sorting to service;
    - `setWatcherArmed(db, id, armed)` updates only the armed flag and returns
      the updated row.
  - Add pure deep-view service, for example
    `server/src/services/watcher-deep-view.ts`:
    - parses kind-A date-threshold rule with the same calendar-date discipline
      as `evaluateWatcherA`;
    - derives `due`, `quiet`, `snoozed`, `disarmed`, or `unsupported`;
    - computes `daysOverdue` and `daysUntil`;
    - emits reason codes and short descriptive messages;
    - sorts due first, then snoozed, quiet, disarmed, unsupported; within each
      group threshold asc, id asc.
  - Extend `server/src/routes/watchers.ts`:
    - `GET /api/watchers`;
    - `PATCH /api/watchers/:id/armed`;
    - keep existing POST and snooze behavior.
  - Keep handlers thin: validate shared schema, call repository/service, return
    typed response.
  - Watcher route/static checks should confirm no LLM, Gmail, GCal,
    Telegram, cron, or network dependency.

- Frontend:
  - Add `web/src/Watchers.tsx`.
  - Add `/watch` route in `web/src/App.tsx`.
  - Add nav link "여백" in `web/src/AppNav.tsx`.
  - `/watch` screen states:
    - loading skeleton;
    - quiet: no watchers yet, calm copy + "Watcher 추가" action;
    - live: watcher sections/cards;
    - error: retry action;
    - access-session error: same recovery pattern as other screens.
  - Live UI:
    - status sections/chips for due/quiet/snoozed/disarmed/unsupported;
    - A/B badge, with A implemented and B/unsupported clearly marked;
    - armed toggle per watcher;
    - due watcher snooze action ("내일 다시 보기") using current query `now`;
    - create bottom sheet for label/category/threshold.
  - Mutations:
    - create watcher closes sheet and refetches on success;
    - armed toggle refetches on success and shows local row error on failure;
    - snooze refetches on success and shows local row error on failure;
    - no optimistic hidden deletion.
  - Design:
    - A-temperature execution surface;
    - semantic tokens only;
    - touch targets at least 44px;
    - reduced-motion safe;
    - no scary notification-count styling.

- Docs:
  - Update `docs/codebase-map.md`:
    - new watcher list/toggle contracts;
    - watcher deep-view service;
    - watcher routes;
    - `/watch` UI and nav entry.

## Sprint Contract

- Pass criteria:
  - `GET /api/watchers` returns all watcher rows with derived deep-view status.
  - Due kind-A rows match Today evaluator semantics for threshold/snooze.
  - Disarmed watchers remain visible in `/watch` but do not appear in Today
    watcher bubbles.
  - Snoozed watchers show `snoozed` in `/watch` while hidden from Today until
    `snoozedUntil <= now`.
  - Malformed or unsupported rows are visible as `unsupported`, not fabricated
    as due.
  - `PATCH /api/watchers/:id/armed` persists only armed state.
  - Existing `POST /api/watchers` and `PATCH /api/watchers/:id/snooze` keep
    existing behavior.
  - `/watch` route renders loading, quiet, live, error, and access-session
    states.
  - `/watch` can create a kind-A watcher through the existing POST route.
  - `/watch` can arm/disarm and snooze with local error handling.
  - App navigation includes "여백" and active state works on `/watch`.
  - No LLM, cron, external network, migration, or watcher B automation is
    introduced.
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
    - valid watcher deep row/list parses;
    - status enum accepts due/quiet/snoozed/disarmed/unsupported;
    - armed toggle request parses boolean and rejects injected fields;
    - list rows reject unknown `score`/`recommendation` fields.
  - Backend unit:
    - date-threshold watcher before threshold = quiet with `daysUntil`;
    - threshold reached = due with `daysOverdue`;
    - snoozed active = snoozed;
    - disarmed = disarmed regardless of threshold;
    - malformed rule or unsupported kind = unsupported;
    - sort order due → snoozed → quiet → disarmed → unsupported.
  - Backend integration with real temporary SQLite DB:
    - `GET /api/watchers` lists all rows, not only armed rows;
    - `PATCH /api/watchers/:id/armed` toggles armed and persists it;
    - disarmed row is absent from `GET /api/today` watcher bubbles;
    - snoozed row is hidden from Today but visible as snoozed in `/api/watchers`;
    - create watcher then list shows armed A row;
    - not-found and validation paths do not mutate rows.
  - Frontend:
    - `/watch` loading skeleton;
    - quiet state and create action;
    - live state groups due/quiet/snoozed/disarmed rows;
    - create bottom sheet submits POST and refetches;
    - armed toggle calls PATCH and refetches;
    - snooze action calls existing route and refetches;
    - mutation failure keeps row/sheet visible with `role="alert"`;
    - access-session error shows recovery button;
    - AppNav includes "여백" and marks `/watch` active.
  - Manual checks:
    - mobile and wide `/watch`;
    - light and dark themes;
    - keyboard focus through create sheet, armed toggles, snooze, retry;
    - 44px targets and reduced-motion behavior;
    - no alarmist copy or B automation claims.

- gas limit: N/A
- slither pass: N/A

## Three Missing Edge-Case Candidates

- A watcher has `armed=0` and `snoozedUntil` in the future: display as
  disarmed first, because it cannot surface.
- A watcher has malformed rule JSON but a valid `threshold` column: either
  fallback to threshold consistently with Today evaluator or mark unsupported;
  reviewer must verify chosen rule matches plan and tests.
- User toggles armed while Today has the same watcher visible: Today must reflect
  server state after refresh, not keep stale local assumptions.

## Simpler Alternative

Only add a `/watch` screen that reads Today watcher bubbles.

Rejected because Today bubbles intentionally hide quiet, snoozed, and disarmed
watchers. A deep view must show the whole watcher set and explain silence.

## Assumptions

- Watcher A remains date-threshold only for this cycle.
- Existing `watchers` table columns are sufficient: `category`, `label`,
  `kind`, `armed`, `rule`, `threshold`, `snoozed_until`.
- Creation UI only supports A date-threshold watchers.
- Snooze action uses `now + 24h` derived from the loaded `/watch` query time,
  matching Today surface-time semantics.
- B/keyword watchers may exist as rows later, but this cycle must not implement
  web monitoring. Non-A rows are descriptive only.

## Review Guidance

### Enumeration Needed

- Shared watcher contracts:
  - Search:
    `rg -n "WatcherDeep|WatcherList|PatchWatcherArmed|WatcherRow|recommendation|score" shared/src/watchers.ts shared/src/*watcher*.test.ts`
  - Expected: strict shared schemas for list rows and armed request; unknown
    fields rejected.

- Backend watcher routes/repositories/services:
  - Search:
    `rg -n "api/watchers|findAllWatchers|setWatcherArmed|WatcherDeep|evaluateWatcherA|snoozeWatcher|createWatcher" server/src`
  - Expected: route handlers thin; deep-view derivation pure; Today evaluator
    semantics preserved.

- Today vs Watch consistency:
  - Search:
    `rg -n "watcherBubbles|findAllWatchersForEvaluation|evaluateWatcherA|armed|snoozed" server/src/routes server/src/services server/src/repositories`
  - Expected: Today still filters to armed due unsnoozed bubbles; `/watch`
    lists all rows.

- Frontend route/nav/screen:
  - Search:
    `rg -n "\"/watch\"|Watchers|여백|watcher|armed|snooze|Watcher 추가" web/src`
  - Expected: App route, nav active state, Watchers screen, tests, styles.

- Docs map:
  - Search:
    `rg -n "watchers|/watch|WatcherDeep|Watcher list|armed" docs/codebase-map.md`
  - Expected: new route/service/shared/UI entries documented.

### Verification Method Guide

- Shared schema strictness:
  - Unit tests are sufficient.

- Pure status derivation/sort:
  - Unit tests are sufficient.

- DB persistence and Today hidden/visible behavior:
  - Real SQLite integration tests are required. Mock tests cannot verify
    transaction/persistence and Today aggregation interaction.

- `/watch` UI states and mutations:
  - JSDOM component tests are required.
  - Manual mobile/light/dark/reduced-motion checks remain required unless
    executor records headless limitation with concrete code/test evidence.

- No LLM/network/B automation:
  - Static import/search plus green tests without external setup are sufficient.
