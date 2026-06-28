# Travel Time / Transition Cost A Implementation Plan

Branch: feature/cycle-76-travel-time-transition-cost-a
Cycle: 76
Created: 2026-06-28
Skills: backend-fastify, frontend-react-pwa

## Summary

Cycle 76 promotes **Travel Time / Transition Cost A** from
`docs/map-roadmap-cycles-72-76.md`.

Cycles 72-75 established the server-side map boundary, geocode cache, event
detail geocoding, and cache-only Today location context. This cycle adds a
travel-time cache and uses cached/provider-fetched travel facts as additive
evidence for adjacent scheduled event transitions.

The core boundary is: travel time may make a transition look tight or
impossible, but it never mutates schedules, never hard-blocks Today, and never
replaces existing deterministic thread-based transition costs. If provider data
is disabled, stale, missing, or failed, feasibility still returns a complete
surface with honest unavailable/stale copy.

## Input/Output Spec

- Input:
  - Existing `GET /api/today?date&now&domain`.
  - Existing `GET /api/feasibility/day?date&now` and
    `POST /api/feasibility/day/preview`.
  - Scheduled planned/confirmed event pairs ordered by start time for the day.
  - Existing `events.location` text and resolved `geocode_cache` coordinates.
  - Server-only map provider gateway/config. Browser code must not call provider
    APIs or receive API keys.
- Normal output:
  - Add a SQLite travel-time cache table for normalized adjacent location pairs,
    provider, mode/profile, duration/distance when available, status, freshness,
    provider status, and timestamps.
  - Extend shared feasibility output with provider-neutral travel evidence for
    each adjacent event pair, preferably as an optional `travel` object on each
    `TransitionCost`:
    - `fresh`: usable cached/provider result within freshness policy.
    - `stale`: cached result exists but exceeds freshness policy.
    - `unavailable`: provider disabled, failed, rate-limited, timed out, or
      returned no route.
    - `missing_geocode`: one or both event locations lack resolved coordinates.
    - `same_location`: both endpoints resolve to the same normalized location or
      coordinates close enough that travel time is not meaningful.
  - Feasibility gap requirements may include `durationMinutes * travelMargin`
    only when travel evidence is `fresh` or accepted `stale`; otherwise existing
    buffer-only gap behavior remains available with unavailable/stale reason
    codes.
  - Today feasibility/transition UI shows compact copy for high-risk
    transitions and stale/unavailable travel-time evidence without alarm styling
    for unknowns.
  - Event detail can show previous/next transition travel evidence for the
    selected event when that evidence is already in the Today/feasibility day
    surface; it does not trigger its own provider calls.
- Failure behavior:
  - Provider disabled/unavailable/timeout/rate-limit returns explicit
    unavailable travel evidence and does not fail `GET /api/today` or
    `GET /api/feasibility/day`.
  - Missing or unresolved geocodes produce `missing_geocode` evidence and do not
    call travel-time provider.
  - Cache writes are idempotent per provider/mode/origin/destination pair.
  - Stale data remains labeled stale; it may be shown as context but must not be
    presented as hard truth.
  - No automatic event reschedule, conflict resolution, geocoding storm, or
    route/directions UI is introduced.

## Key Changes

- Shared:
  - `shared/src/maps.ts`
    - Add provider-neutral travel-time schemas/statuses if this is the most
      cohesive home next to map/geocode schemas.
  - `shared/src/feasibility.ts`
    - Extend `TransitionCostSchema` with optional strict travel evidence fields
      or add a parallel transition-travel array keyed by event pair. Keep
      existing transition discriminants and cost levels valid.
  - Tests:
    - Cover fresh/stale/unavailable/missing_geocode/same_location travel facts
      and compatibility with existing transition cost payloads.
- Backend:
  - `server/src/db/schema.ts` and a generated migration:
    - Add `travel_time_cache` with lowercase enum status values, provider,
      profile/mode, origin/destination normalized locations and coordinates,
      duration seconds/minutes, optional distance meters, provider status,
      timestamps, and uniqueness constraints.
  - `server/src/maps/*`
    - Extend the map gateway boundary with a travel-time method. Keep provider
      implementation server-only, bounded, and typed. No browser key exposure.
  - `server/src/repositories/travel-time-cache.ts`
    - Add read/upsert helpers with explicit cache hit/stale/miss behavior.
  - `server/src/services/travel-time.ts`
    - Resolve adjacent event pairs to geocode cache rows, dedupe pair keys, read
      cached travel facts, call provider only when both endpoints have usable
      coordinates and freshness policy allows, and fail open to unavailable
      evidence.
  - `server/src/services/feasibility.ts` /
    `server/src/services/context-switch.ts`
    - Accept transition travel facts as an input to feasibility rather than
      reading provider state inside pure computation. Add travel reason codes and
      gap required-minute adjustments only where a usable fact exists.
  - `server/src/routes/feasibility.ts` and `server/src/routes/today.ts`
    - Wire cache/gateway-backed transition travel enrichment for scheduled day
      pairs. Provider failure must return 200 with unavailable evidence.
    - `POST /api/feasibility/day/preview` must remain read-only for events and
      thread links; travel cache writes are allowed only if the same policy is
      used and verified, otherwise preview must be cache-read-only.
  - Tests:
    - Unit tests for travel-time shaping/cache policy.
    - SQLite integration tests for cache insert/update, stale rows, missing
      coordinates, provider disabled/failure, and Today/feasibility fallback.
- Frontend:
  - `web/src/Today.tsx`
    - Extend the feasibility transition section to render travel-time copy for
      high-risk, stale, unavailable, and missing-coordinate transitions.
    - Keep unknown/unavailable evidence quiet and distinguish it from confirmed
      impossible/tight travel.
    - If event-detail copy is implemented in this cycle, use existing
      Today/feasibility data only; do not POST or fetch provider data from the
      sheet.
  - `web/src/Today.test.tsx`
    - Cover fresh tight/impossible travel, stale copy, unavailable copy,
      missing-geocode quiet state, and preservation of existing transition,
      energy, gap, event detail, and card actions.
  - `web/src/styles.css`
    - Add semantic-token-only compact styles; no new dominant palette, no alert
      styling for unknown/unavailable states.
- Docs:
  - `docs/map-roadmap-cycles-72-76.md`
    - Mark Cycle 75 merged and Cycle 76 promoted/active.
  - `docs/codebase-map.md`
    - Update after implementation with travel-time cache, gateway, feasibility,
      and UI boundaries.

## Sprint Contract

- Passing criteria:
  - A `travel_time_cache` SQLite table exists with generated migration,
    lower-case enum values, uniqueness constraints, coordinate pair identity,
    duration/distance/status/freshness/provenance, and real temporary DB tests.
  - Travel provider access remains server-only behind the map gateway. No
    browser provider call, API key exposure, raw provider URL, raw provider
    payload, or raw provider error is exposed.
  - Travel-time provider calls happen only when both adjacent event endpoints
    have resolved geocode coordinates and cache policy says a refresh is allowed.
  - Missing geocode, unresolved geocode, provider disabled, provider failure,
    timeout, rate-limit, or no-route results do not fail Today/feasibility.
  - Existing deterministic thread-based transition costs still compute when
    travel evidence is absent; existing `relation` and `costLevel` semantics
    remain valid.
  - Feasibility gap required minutes include travel time only for usable travel
    facts. Unknown/unavailable/missing travel never fabricates hard truth.
  - Sequence energy either remains thread-transition-only or clearly separates
    travel-time load from context-switch load; it must not silently double-count.
  - Today transition UI shows high-risk travel, stale travel, unavailable travel,
    and missing-geocode states honestly while preserving existing feasibility,
    card, and event-detail interactions.
  - No automatic rescheduling, provider-dependent hard blocking, multi-stop
    route optimization, autocomplete, commute prediction, cron job, or bulk
    geocoding is introduced.
  - `docs/codebase-map.md` reflects the new travel-time cache/provider/feasibility
    boundary after implementation.
- Automatic checks:
  - `corepack pnpm lint`
  - `corepack pnpm typecheck`
  - `corepack pnpm test`
  - `corepack pnpm test:integration`
  - `corepack pnpm build`
  - `corepack pnpm verify`
  - `git diff --check master...HEAD`
  - Migration/schema checks:
    - Generated migration for `travel_time_cache` is present.
    - Existing applied migrations are not edited.
    - `server/src/db/schema.integration.test.ts` or a dedicated integration test
      validates enum/check/unique constraints in a temporary SQLite DB.
  - Static negative checks:
    - No frontend provider/API-key usage:
      `git diff -U0 master...HEAD -- web shared | rg -n 'maps.googleapis.com|MAP_PROVIDER_API_KEY|DistanceMatrix|computeRouteMatrix|directions|routes.googleapis.com'`
      should have no frontend implementation matches.
    - No automatic mutation/rescheduling scope:
      `git diff -U0 master...HEAD -- server web shared | rg -n 'auto.?resched|PATCH /api/events/.*/schedule|schedule automatically|cron|bulk geocod|autocomplete|multi-stop|optimization'`
      should have no Cycle 76 implementation matches except tests/docs that
      assert absence.
    - No LLM path:
      `git diff -U0 master...HEAD -- server/src | rg -n 'llm|chat/completions|Grok|prompt'`
      should have no travel-time implementation matches.
- Test cases:
  - Shared schemas accept fresh/stale/unavailable/missing_geocode/same_location
    travel evidence and reject raw provider payload/error leakage.
  - Cache repository inserts, updates, dedupes, and marks stale rows using a real
    temporary SQLite database.
  - Travel-time service does not call provider when geocode is missing,
    unresolved, same-location, or cache is fresh.
  - Travel-time service calls provider exactly once per eligible deduped pair
    when cache policy allows and stores success.
  - Provider failure/timeout/rate-limit/no-route returns unavailable evidence
    and leaves Today/feasibility HTTP responses successful.
  - `GET /api/feasibility/day` and `GET /api/today` include travel evidence for
    adjacent scheduled event pairs with resolved coordinates.
  - `POST /api/feasibility/day/preview` remains deterministic and read-only
    unless the implementation explicitly justifies cache writes; event/thread
    row counts must not change.
  - Gap required minutes/status reflect usable travel time and `travelMargin`.
  - Existing context-switch transition costs and sequence energy tests continue
    to pass without travel facts.
  - Frontend renders fresh high-risk travel, stale data, unavailable provider,
    and missing-geocode states; unavailable states are quiet, not hard warnings.
  - Existing transition, energy, gap, feasibility settings, Today card, and event
    detail interactions remain covered.
- gas limit: N/A
- slither pass: N/A

## Missing Edge Case Candidates

- Adjacent events can share the same authored location or resolve to nearly the
  same coordinates. The cycle must avoid calling a route provider and avoid
  inventing travel pressure for that pair.
- A stale cache row can be useful context but dangerous as a hard requirement.
  The UI and gap logic must consistently distinguish stale from fresh.
- Preview endpoints can accidentally write cache rows while a user is only
  exploring parameter changes. If preview writes are allowed, tests must prove
  idempotence and no event/thread mutation; otherwise keep preview cache-read-only.

## Simpler Alternative

Only render travel-time copy from manually seeded cache rows and never call the
provider. This would reduce provider risk, but it would not satisfy the roadmap
requirement for backend service logic that requests travel time when resolved
coordinates and cache policy allow it. The adopted plan keeps the provider call
server-side, bounded, cache-policy-gated, and fail-open.

## Assumptions

- Cycle 73 `geocode_cache` is the authoritative source of resolved event
  coordinates for travel-time lookup.
- Current provider is Google, but shared API output and cache status semantics
  remain provider-neutral.
- Travel mode/profile can default to a single conservative mode for this A
  cycle unless an existing user preference already exists.
- Today/feasibility day surfaces are the first UI surfaces; no route map,
  turn-by-turn directions, or multi-stop planner is needed.

## Review Guidance

### Enumeration Needed

- Feasibility transition data path:
  - Search: `rg -n 'computeDayFeasibility|computeTransitionCosts|computeSequenceEnergy|transitionCosts|sequenceEnergy|computeGaps' shared/src server/src web/src`
  - Expected: travel evidence is additive and does not remove or reinterpret
    existing thread-based transition fields.
- Map/provider boundary:
  - Search: `rg -n 'MapGateway|travel|duration|distance|provider|maps.googleapis.com|routes.googleapis.com|DistanceMatrix|computeRouteMatrix' server/src shared/src web/src`
  - Expected: provider calls stay in `server/src/maps` and backend services;
    frontend receives typed provider-neutral data only.
- Persistence boundary:
  - Search: `rg -n 'travel_time_cache|geocode_cache|travelTime|TravelTime' server/src shared/src`
  - Expected: new cache schema/repository/migration only; no unrelated DB tables.
- Today/feasibility UI boundary:
  - Search: `rg -n 'transition-row|sequence-energy|FeasibilityPanel|event detail|TodayLocationChip|today-loc' web/src/Today.tsx web/src/Today.test.tsx`
  - Expected: travel-time copy appears in the existing feasibility/transition
    surfaces and does not disturb card/event-detail actions.

### Verification Method Guide

- SQLite cache and migration:
  - Requires real temporary SQLite integration tests. Mock-only tests are
    insufficient for enum/check/unique constraints and migration compatibility.
- Provider failure and cache policy:
  - Unit tests may use a fake map gateway, but route integration tests must prove
    Today/feasibility return 200 with unavailable evidence when the gateway is
    disabled or fails.
- Feasibility arithmetic:
  - Unit tests are sufficient for pure gap/status/travel-margin calculation, but
    route integration must prove the computed values are present on both
    `/api/feasibility/day` and `/api/today`.
- Frontend rendering:
  - Component tests must cover fresh, stale, unavailable, and missing-geocode
    states plus existing interaction preservation.
- Scope control:
  - Static diff checks are required for frontend provider keys, LLM calls,
    auto-rescheduling, cron/bulk geocoding, autocomplete, and route optimization
    terms because those are explicitly out of scope.
