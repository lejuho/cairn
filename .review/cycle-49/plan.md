# Mirror Transition Friction A Implementation Plan

Branch: feature/cycle-49-mirror-transition-friction-a
Skills: backend-fastify, frontend-react-pwa

## Summary
The remaining implementation surface still includes external/API-heavy work
(Gmail cost parsing, optional GCal mirror, movement adapters, watcher-B
automation), broad thread authoring/editing flows, task push scheduling, resume
export, and Mirror retrospective gaps.

The recommended next spec is **FR-MIR-09 Transition Count / Friction Signal A**.
It is the best next cycle because cycles 41, 42, and 48 already expose
deterministic transition costs, sequence energy, and sequence ordering, while
Mirror still lacks the retrospective signal: "did high-transition days correlate
with more drain or slips?" This cycle makes that evidence visible before any
coefficient tuning. It is read-only, deterministic, small, and does not require
LLM, Gmail, Google Calendar, maps, push delivery, or external services.

This cycle implements only the A-slice: record-like read model + Mirror UI
display for per-day thread transition counts and nearby outcome/energy evidence.
It must not tune transition coefficients, auto-reschedule, recommend a new
order, write params, fabricate causality, or emit a scalar risk score.

## Input/Output Spec
- Input:
  - `GET /api/mirror/transition-friction?from&to`
  - `from` / `to` are optional `YYYY-MM-DD` calendar dates.
  - Defaults match the existing Mirror convention: `to = server-local today`,
    `from = to - 30 days`.
  - Validation:
    - reject malformed or overflow dates with `400 VALIDATION_ERROR`
    - reject `from > to`
    - reject explicit ranges longer than 90 inclusive days
  - Reads only:
    - scheduled events in range with non-null `start`, ordered by `start ASC,
      id ASC`
    - same-day `thread_links` among the day's thread ids via the existing
      relation repository boundary
    - outcome/energy annotations from the existing Mirror annotation source,
      grouped by `loggedAt.slice(0, 10)`
- Output:
  - Normal:
    - `ok: true`
    - `data.range: { from, to }`
    - `data.summary`
      - `days`: inclusive range length
      - `activeDays`: days with at least one scheduled event
      - `totalTransitionPairs`: consecutive same-day scheduled event pairs
      - `lowTransitionPairs`: pairs classified `low`
      - `highTransitionPairs`: pairs classified `high`
      - `unknownTransitionPairs`: pairs classified `unknown`
      - `lowSampleDays`: days whose evidence is below the sample threshold
      - `sampleStatus`: `ok | low_sample`
    - `data.days[]`, newest first:
      - `date`
      - `eventCount`
      - `transitionPairs`
      - `sameThreadPairs`
      - `contextPairs`
      - `unrelatedPairs`
      - `missingThreadPairs`
      - `lowTransitionPairs`
      - `highTransitionPairs`
      - `unknownTransitionPairs`
      - `outcomes: { done, moved, cancelled, late }`
      - `energy: { entryCount, averageEnergyAtTime }`
      - `sampleStatus`
      - `reasonCodes`
  - Failure:
    - Validation failures return the existing API error shape with
      `VALIDATION_ERROR`.
    - Unexpected failures use the existing Fastify error behavior.
  - Side effects:
    - None. No DB write, no params mutation, no suggestion confirmation, no
      outbound API call.

## Key Changes
- Shared:
  - Extend `shared/src/mirror.ts` with strict schemas/types for:
    - `MirrorTransitionFrictionQuerySchema`
    - `MirrorTransitionFrictionOutcomeCountsSchema`
    - `MirrorTransitionFrictionEnergySchema`
    - `MirrorTransitionFrictionDaySchema`
    - `MirrorTransitionFrictionSummarySchema`
    - `MirrorTransitionFrictionDataSchema`
    - `MirrorTransitionFrictionResponseSchema`
  - Schemas must reject injected fields such as `score`, `riskScore`,
    `recommendation`, `advice`, `action`, `apply`, `tune`, or `coefficient`.
- Backend:
  - Add a pure service, expected path:
    `server/src/services/mirror-transition-friction.ts`.
  - Service builds the response from scheduled event rows, thread links, and
    Mirror annotation rows.
  - Reuse the existing transition classifier from
    `server/src/services/context-switch.ts`; do not create a second transition
    cost model.
  - Add a read helper only if existing event repositories cannot express the
    required range/status query clearly. Any new repository function must be
    read-only.
  - Register `GET /api/mirror/transition-friction` in
    `server/src/routes/mirror.ts`.
- Frontend:
  - Extend `web/src/MirrorLedger.tsx` to load the new endpoint alongside the
    existing Mirror data.
  - Render a read-only "전환 마찰" section:
    - hidden or quiet when there are no active days
    - summary chips for total/high/unknown transition pairs
    - latest day rows with evidence counts and low-sample copy
    - Korean descriptive copy only; no imperative recommendation
  - Add semantic-token CSS only. Preserve mobile-first layout, 44px touch
    targets where interactive controls exist, and reduced-motion safety.
- Docs:
  - Update `docs/codebase-map.md` for the new route, shared schemas, service,
    and Mirror UI section.

## Sprint Contract
- Pass criteria:
  - The endpoint returns deterministic transition-friction data for a valid
    date range.
  - Date validation matches existing Mirror route behavior, including real
    calendar dates and 90-day explicit max range.
  - Per-day transition pair classification matches
    `computeTransitionCosts`:
    - same thread -> same/none
    - context link -> context/low
    - non-context or unrelated -> high
    - missing thread id -> unknown
  - Outcome and energy evidence is grouped by annotation logged date, not
    fabricated from event status.
  - The UI surfaces descriptive evidence only and does not present a scalar
    score, coefficient, recommendation, auto action, or tuning result.
  - No DB writes, no LLM gateway calls, and no external API calls are introduced.
  - `docs/codebase-map.md` reflects the new route/service/schema/UI boundary.
- Automatic checks:
  - `corepack pnpm db:generate`
  - `corepack pnpm verify`
  - `git diff --check master..HEAD`
  - Static no-LLM/no-external scan:
    - `git diff -U0 master..HEAD -- shared/src server/src web/src | rg -n "\\b(completeChat|LLM_PROXY_BASE_URL|googleapis|gcal|gmail|telegram|fetch\\(http|https?://)\\b"`
    - Expected result: no matches.
  - Static read-only scan over implementation files:
    - `git diff -U0 master..HEAD -- server/src/services/mirror-transition-friction.ts server/src/routes/mirror.ts server/src/repositories | rg -n "\\b(insert|update|delete|transaction|onConflict|run\\()\\b"`
    - Expected result: no matches outside existing unrelated code context; any
      match requires reviewer explanation.
  - Static no-score/no-recommendation scan:
    - `git diff -U0 master..HEAD -- shared/src/mirror.ts server/src/services/mirror-transition-friction.ts web/src/MirrorLedger.tsx | rg -n "riskScore|scalarScore|recommendation|advice|autoAction|coefficient|tune|apply"`
    - Expected result: no matches except explicit negative test names or plan
      comments; production payload/UI must not expose these fields.
- Test cases:
  - Shared schema tests:
    - valid response parses
    - invalid/reversed/overflow/range-too-long query rejects
    - injected score/recommendation/tuning/action fields reject
  - Pure service tests:
    - empty range returns quiet/low-sample data
    - single event day has zero transition pairs
    - same-thread consecutive events classify as same/none
    - context-link pair classifies as low
    - non-context/unrelated pair classifies as high
    - missing thread id pair classifies as unknown without guessing
    - multi-day output is newest-first and stable by start/id
    - annotation outcomes and energy averages aggregate by logged date
    - low-sample day and overall sample statuses are deterministic
  - Backend integration tests with real temporary SQLite:
    - valid route returns expected day rows from events/thread_links/annotations
    - invalid dates, reversed range, and >90-day range return `400`
    - route does not mutate `events`, `annotations`, `thread_links`, or `params`
    - route succeeds without LLM proxy configuration
  - Frontend tests:
    - loading/quiet/live/error/access-session states remain intact
    - section renders summary and day rows
    - high and unknown transition labels are descriptive, not prescriptive
    - section hides or renders quiet copy when there are no active days
- gas limit: N/A
- slither pass: N/A

## Missing Edge Case Candidates
- Events with equal `start` timestamps: order must fall back to `id ASC` so
  transition counts are stable.
- A day with only missing-thread events: show uncertainty, not high friction.
- Multiple thread links between the same pair: reuse existing transition-cost
  tie-break behavior; do not fork the classifier.

## Simpler Alternative
Add only a frontend reuse of `/api/feasibility/day` for recent dates. This is
faster but wrong for Mirror because it would require N day-level API calls,
would omit annotation-based outcome/energy evidence, and would couple a
retrospective surface to a today-oriented route. A dedicated read-only Mirror
endpoint is the cleaner A-slice.

## Assumptions
- Server-local calendar dates are sufficient for this A-slice, matching current
  Mirror route behavior.
- Scheduled transition rows include `planned`, `confirmed`, and `done` events
  with non-null `start`; cancelled/moved/late evidence comes from annotations.
- Annotation energy uses the existing `energyAtTime` field when present. If
  multiple entries exist on a day, `averageEnergyAtTime` is rounded to two
  decimals; no value is fabricated when there are zero energy entries.
- This cycle does not persist a new daily aggregate table. "기록" means a
  deterministic read model over existing stored events/links/annotations.

## Review Guidance
### Enumeration Required
- Locate every implementation touch point:
  - `rg -n "transition-friction|TransitionFriction|buildMirrorTransitionFriction" shared/src server/src web/src`
- Confirm Mirror route registration and response schema use:
  - `rg -n "/api/mirror/transition-friction|MirrorTransitionFriction.*Schema|registerMirrorRoutes" server/src shared/src`
- Confirm no duplicate transition classifier was introduced:
  - `rg -n "computeTransitionCosts|costLevel|same_thread|context_link|unrelated|missing_thread" server/src/services`
- Confirm frontend section is Mirror-only and descriptive:
  - `rg -n "전환 마찰|transition friction|riskScore|recommendation|advice|coefficient|tune" web/src shared/src server/src`

### Verification Method Guide
- Shared schema strictness:
  - Unit tests are sufficient for parse/reject behavior.
- Transition pair classification:
  - Pure service tests are required and should call the new builder directly.
  - Mocking the existing classifier is insufficient; tests must prove the
    builder maps classifier output to Mirror counts correctly.
- Route validation and read-only behavior:
  - Integration tests against a real temporary SQLite DB are required.
  - Row counts before/after the request must be checked for at least
    `events`, `annotations`, `thread_links`, and `params`.
- UI states:
  - Automated frontend tests are required for quiet/live/error/access states.
  - Manual mobile/light/dark/reduced-motion check is optional for this cycle
    unless CSS introduces nontrivial interaction; if skipped, record that in
    review.
- Determinism/no external dependency:
  - Static scans plus `corepack pnpm verify` are required.
  - Reviewer should treat any LLM/external/network call in this cycle as a
    blocker unless it is clearly pre-existing untouched code.
