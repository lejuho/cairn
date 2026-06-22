# Mirror Energy Trend A Implementation Plan

Branch: feature/cycle-29-mirror-energy-trends-a
Skills: backend-fastify, frontend-react-pwa

## Summary

Cycle 27 added the Mirror decision-cost ledger (FR-MIR-02/04). Cycle 28 added
flake pattern aggregation (FR-MIR-01). Cycle 29 adds the smallest useful
FR-MIR-03 slice: a read-only energy trend for `/mirror`, derived from existing
scheduled events and the deterministic feasibility energy model.

This is not a new persistence model. It does not record daily snapshots, infer
health, or make recommendations. It reflects the current SQLite event history
through the same "cold_start" feasibility assumptions already used by Today.

Out of scope:

- feasibility parameter editing sliders (FR-FEAS-03);
- live travel/external shock or overrun correction (FR-FEAS-05/07);
- recovery/sleep/meal model;
- transition-cost or sequence optimization (FR-FEAS-08/09/10/11);
- Mirror automation-need tracking, diary, retrospective questions, or transition
  count recording (FR-MIR-05/06/07/08/09);
- new DB table, migration, cron, write path, push, or LLM call.

## Input/Output Spec

- Input:
  - `GET /api/mirror/energy-trends?from=YYYY-MM-DD&to=YYYY-MM-DD`
  - `from` and `to` are optional.
  - Query validation reuses the strict real-calendar date contract already used
    by Mirror ledger/patterns.
  - If both are present, `from <= to`.
  - Default range: `to=today`, `from=to-30d`, with `today` resolved at the route
    edge and injected into the pure service.
  - Range length limit: at most 90 inclusive days. Wider ranges return
    `400 VALIDATION_ERROR` to keep the single-user Pi route cheap and
    predictable.

- Output:
  - Success:
    - `200 { ok: true, data: MirrorEnergyTrendData }`
    - Proposed shape:

```json
{
  "range": { "from": "2026-06-01", "to": "2026-06-30" },
  "summary": {
    "days": 30,
    "scheduledDays": 8,
    "deficitDays": 2,
    "averageDailyLoadUnits": 1.73,
    "averageScheduledLoadUnits": 4.12,
    "peakLoadUnits": 9.5,
    "budgetUnits": 8,
    "sampleStatus": "ok"
  },
  "days": [
    {
      "date": "2026-06-21",
      "eventCount": 3,
      "loadUnits": 5.5,
      "budgetUnits": 8,
      "remainingUnits": 2.5,
      "deficit": false,
      "continuousExceeded": false
    }
  ],
  "sampleStatus": "ok"
}
```

  - Failure:
    - Invalid date format, impossible calendar date, reversed range, or range
      longer than 90 days:
      `400 { ok:false, error:{ code:"VALIDATION_ERROR", message:string } }`

Definitions:

- A-level "energy trend" uses the existing feasibility `energy.loadUnits`
  computation: duration-hours sum of planned/confirmed events starting on each
  date.
- `peakLoadUnits` is the maximum daily `loadUnits` over the range. This is an
  A-level daily peak proxy, not an intraday energy curve.
- `scheduledDays` counts days with at least one planned/confirmed scheduled
  event included by the feasibility model.
- `averageDailyLoadUnits` averages over every day in the range, including zero
  days.
- `averageScheduledLoadUnits` averages only over scheduled days; if there are no
  scheduled days it is `0`.
- `deficitDays` counts days where `loadUnits > budgetUnits`.
- `continuousExceeded` mirrors the existing feasibility continuous-span check
  for the day.
- `sampleStatus = "low_sample"` when `scheduledDays < 3`, otherwise `"ok"`.
- Copy must be descriptive only. Allowed: `최근 30일 중 예산 초과 2일`.
  Disallowed: `일정을 줄여`, `무리하지 마`, `위험`, `나쁜 패턴`.

## Key Changes

- Shared:
  - Extend `shared/src/mirror.ts` with energy trend schemas/types:
    - `MirrorEnergyTrendQuerySchema` (strict date range + max 90 days);
    - `MirrorEnergyTrendDaySchema`;
    - `MirrorEnergyTrendSummarySchema`;
    - `MirrorEnergyTrendDataSchema`;
    - `MirrorEnergyTrendResponseSchema`.
  - Reuse `MirrorRangeQuerySchema`, `MirrorLedgerRangeSchema`, and
    `MirrorSampleStatusSchema` where suitable.
  - Add shared unit tests for valid trend payloads, strict date validation,
    reversed ranges, max-range rejection, low-sample enum validation, and
    rejecting extra recommendation/score fields if day/summary schemas are
    strict.

- Backend:
  - Add a read-only repository helper in `server/src/repositories/events.ts` or a
    new mirror repository helper:
    - fetch planned/confirmed scheduled events overlapping or starting within
      `[from, to]` using only needed columns;
    - no writes, no transactions, no LLM.
  - Add a pure service, for example `server/src/services/mirror-energy-trends.ts`:
    - resolve default range from injected `today`;
    - enumerate inclusive date strings from `from` to `to`;
    - group events by `start.slice(0,10)` exactly like the current feasibility
      day model;
    - call `computeDayFeasibility(date, nowForDate, eventsForRange, params)` or
      share the same energy helper without changing Today behavior;
    - produce per-day rows, summary averages, deficitDays, peakLoadUnits, and
      sampleStatus;
    - avoid `Date.now()` inside the service. If a `now` value is needed for
      `computeDayFeasibility`, derive a deterministic per-day value or inject it
      from the route; energy/continuous must not depend on wall-clock time.
  - Extend `server/src/routes/mirror.ts` with
    `GET /api/mirror/energy-trends`.
    - Handler stays thin: validate query → read params → repository read →
      pure service → typed success response.
    - Use the same `params` defaults as Today/feasibility:
      `energy_budget=8`, `meet_buffer=15`, `deep_buffer=30`,
      `travel_margin=1`, `max_continuous=600`.
  - Add route integration tests against a real temporary SQLite DB.

- Frontend:
  - Extend `web/src/MirrorLedger.tsx` or split a small presentational
    `MirrorEnergyTrend` component if it keeps the file readable.
  - `/mirror` should load ledger, patterns, and energy trends in parallel.
  - Preserve the five states: loading, quiet, live, error,
    access_session_required.
  - Quiet state should render only when ledger has no entries, pattern totals
    are zero, and energy trend has `scheduledDays===0`.
  - Live state should show an energy trend card near the pattern/ledger cards:
    deficit day count, average scheduled load, peak daily load, and a compact
    day list or chips for recent non-zero days.
  - Use B-temperature Mirror styling (`.warm`, semantic tokens). No hardcoded
    colors. No required motion.
  - Copy remains descriptive and honest that this is cold-start feasibility
    math from scheduled events, not health advice.
  - Existing ledger/pattern UI and tests must keep passing.

- Docs:
  - Update `docs/codebase-map.md` with:
    - new shared schemas;
    - new Mirror energy route;
    - repository/service ownership;
    - `/mirror` energy trend UI section.

## Sprint Contract

- Pass criteria:
  - `GET /api/mirror/energy-trends` returns valid `MirrorEnergyTrendData`.
  - Invalid, impossible, reversed, or >90-day ranges return stable 400.
  - Default range matches Mirror ledger/patterns: `to=today`, `from=to-30d`.
  - The route uses existing `params` defaults and DB overrides for
    `energy_budget` and `max_continuous`.
  - Energy load matches existing feasibility semantics for each day:
    planned/confirmed events with valid start/end, starting on that date,
    duration-hours summed.
  - Cancelled/moved/late/done events do not add current planned-day load.
  - Cross-midnight or malformed events follow the same A-level behavior as the
    existing feasibility day model; no new interpretation is invented.
  - `deficitDays`, `averageDailyLoadUnits`, `averageScheduledLoadUnits`, and
    `peakLoadUnits` are deterministic and rounded consistently.
  - `continuousExceeded` mirrors the feasibility continuous-span check.
  - No scalar recommendation, moral judgment, hidden weight, or advice field is
    exposed.
  - `/mirror` loads and renders ledger, patterns, and energy trend together.
  - Loading, quiet, live, error, and access-session UI states remain covered.
  - No migration, write path, cron, or LLM dependency is introduced.
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
    - valid `MirrorEnergyTrendData` parses;
    - date validation rejects bad format, impossible dates, reversed range, and
      >90 days;
    - data schema rejects unexpected `score`/`recommendation` fields if strict.
  - Service unit:
    - enumerates inclusive date range in stable order;
    - computes load, remaining, deficit, averages, scheduledDays, and peak;
    - handles zero scheduled days without NaN/Infinity;
    - uses DB budget override;
    - continuousExceeded follows maxContinuous;
    - cancelled/moved/late/done events excluded from planned load.
  - Backend integration:
    - endpoint returns trend rows from real SQLite rows;
    - invalid/impossible/reversed/too-wide ranges return 400;
    - params overrides affect budget and deficit;
    - route works without LLM gateway.
  - Frontend:
    - `/mirror` live state renders energy trend card plus existing pattern and
      ledger sections;
    - quiet state when no ledger entries, no patterns, and no scheduled energy
      days;
    - generic error and access-session recovery still render;
    - copy does not include prescriptive/moralizing banned words.
  - Manual checks:
    - mobile and wide `/mirror`;
    - light and dark themes;
    - keyboard focus through nav, retry, and thread links;
    - 44px targets and reduced motion.

- gas limit: N/A
- slither pass: N/A

## Three Missing Edge-Case Candidates

- A range has zero scheduled days. Summary must return numeric zeros and
  `low_sample`, not NaN/Infinity.
- A DB param is malformed (`energy_budget="abc"`). The existing default fallback
  should apply and the trend should still render.
- A day has one very long event and no gaps. Energy deficit and continuous span
  should both be represented without inventing separate advice.

## Simpler Alternative

Have the frontend call `GET /api/feasibility/day` once per day and aggregate in
the browser. This avoids a new backend route, but it spreads deterministic
aggregation into the PWA, repeats many requests, and makes params/defaults harder
to review. A single server-side read-only route keeps the source of truth and
the trend math in Fastify.

## Assumptions

- A-level energy trend can use current deterministic feasibility math as-is:
  duration-hours sum, cold_start confidence, no recovery model.
- "Peak" means maximum daily load in this cycle, not an intraday curve.
- Default 30-day range is enough for the first Mirror trend view.
- Range cap 90 days is acceptable for a Raspberry Pi local-first API.
- Existing params keys are source of truth for energy budget and continuous span.
- Browser manual checks may be recorded as limitation + automated/code evidence
  if the executor is running headless, but the limitation must be explicit.

## Review Guidance

### Enumeration Required

- Mirror shared contracts:
  - Search:
    `rg -n "Mirror.*Energy|MirrorRange|Mirror.*Query|Mirror.*Trend" shared/src/mirror.ts shared/src/mirror.test.ts`
  - Expected: new energy trend schemas exist, ledger/pattern schemas still
    parse old payloads, and query validation is independent.

- Feasibility semantic reuse:
  - Search:
    `rg -n "computeDayFeasibility|computeEnergy|continuous|maxContinuous|energyBudget" server/src shared/src`
  - Expected: trend service uses existing feasibility semantics or a shared
    helper, not a divergent energy formula.

- Mirror backend route/service/repository:
  - Search:
    `rg -n "mirror/energy-trends|buildMirrorEnergy|EnergyTrend|find.*Energy|registerMirrorRoutes" server/src`
  - Expected: route is thin, repository owns DB reads, service owns date
    enumeration and trend math.

- Deterministic / no LLM boundary:
  - Search:
    `rg -n "completeChat|createLlmGateway|LLM_PROXY_BASE_URL|mirror" server/src`
  - Expected: mirror route/service/repository do not import or call LLM gateway.

- Mirror frontend surface:
  - Search:
    `rg -n "MirrorLedger|MirrorEnergy|energy-trends|초과|줄여|고쳐|위험|나쁜|무리" web/src`
  - Expected: energy trend card exists, recovery states remain, and copy is
    descriptive only.

- Codebase map:
  - Search:
    `rg -n "mirror/energy-trends|Mirror Energy|buildMirrorEnergy|MirrorEnergy" docs/codebase-map.md`
  - Expected: docs mention route, service/repository, shared contract, and UI
    surface.

### Verification Method Guide

- Query validation:
  - Shared unit tests are enough for schema parsing.
  - Route-level 400 mapping needs Fastify integration tests.

- SQLite reads, params fallback/override, and route registration:
  - Mock tests are insufficient.
  - Use real temporary SQLite integration tests.

- Date enumeration, energy math, averages, peak, deficit, and continuous flags:
  - Pure service unit tests are sufficient if they use the same event-row shape
    as the existing feasibility service.

- UI states and copy:
  - Vitest/JSDOM tests are sufficient for loading/quiet/live/error/access
    rendering and banned-copy checks.
  - Manual mobile/wide, light/dark, keyboard, 44px, and reduced-motion checks
    are still required or must be explicitly recorded as a limitation with
    concrete automated/code evidence.

- No migration/no writes/no LLM:
  - `corepack pnpm db:generate` should produce no migration change.
  - `rg` boundary checks plus route integration without a gateway are required.
