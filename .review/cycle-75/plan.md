# Today Location Context A Implementation Plan

Branch: feature/cycle-75-today-location-context-a
Cycle: 75
Created: 2026-06-28
Skills: frontend-react-pwa, backend-fastify

## Summary

Cycle 75 promotes **Today Location Context A** from
`docs/map-roadmap-cycles-72-76.md`.

Cycle 74 made location recognition visible in the event detail sheet. This
cycle brings a compact, cache-only version of that context to Today cards so the
user can see where an event-bearing card happens without changing Today
priority, feasibility, scheduling, or travel-time behavior.

The key implementation constraint is that Today must remain deterministic and
provider-independent. The Today route may read the existing SQLite
`geocode_cache`, but it must not call `mapGateway.geocodeAddress`, trigger
automatic bulk geocoding, or use browser-exposed provider keys. Explicit
geocoding remains the Cycle 73/74 event-detail path.

## Input/Output Spec

- Input:
  - Existing `GET /api/today?date&now&domain` request.
  - Existing Today event-bearing data:
    - `next_event`
    - `needs_review`
    - `schedule_prompt`
    - conflict card pair events
    - `dayEvents` timeline rows
  - Existing `events.location` authored text.
  - Existing `geocode_cache` rows from Cycle 73, keyed by normalized location
    and provider.
- Normal output:
  - Extend the shared Today response with cache-only location context, keyed by
    event id, for event-bearing Today rows/cards.
  - For each relevant event:
    - blank/null location -> `missing` context or no rendered chip;
    - non-empty location with no cache row -> `uncached` context;
    - cached `resolved|ambiguous|zero_results|failed` row -> provider-neutral
      context derived from the cache row.
  - The frontend renders compact location chips/metadata on event-bearing Today
    cards:
    - `resolved`: display label or authored text, confidence/status chip, and an
      external map action based on coordinates.
    - `ambiguous`: authored text, "needs confirmation" chip, candidate labels
      only if the compact surface can fit them without crowding; no fabricated
      coordinate.
    - `zero_results|failed`: authored text plus quiet unresolved chip; no false
      coordinate.
    - `uncached`: authored text plus quiet "not checked" chip; no automatic
      geocode POST.
  - Conflict cards show location context for both event options where relevant.
  - Existing event-card tap/detail behavior remains available; any map action is
    rendered as a separate safe target, not nested inside another interactive
    element.
- Failure behavior:
  - Missing or malformed `uncertainty_json` in a cache row fails open to null
    uncertainty for Today context; Today should still load.
  - Cache read errors are not expected; if one occurs, Today route may fail like
    other DB read errors, but no provider fallback is attempted.
  - Provider disabled/unavailable status does not affect Today cache reads.
  - No Today card is hidden, deferred, reprioritized, or mutated because of
    location state.

## Key Changes

- Shared:
  - `shared/src/today.ts`
    - Add `TodayEventLocationContextSchema` and type.
    - Extend `TodaySurfaceSchema` with `locationContexts`, preferably an array
      of strict `{ eventId, locationText, status, provider, displayLabel,
      latitude, longitude, confidence, providerStatus, uncertainty, updatedAt,
      lastCheckedAt }` objects.
    - Keep existing card discriminants unchanged.
  - `shared/src/today.test.ts`
    - Cover missing/uncached/resolved/ambiguous/failed context schema and ensure
      old card shapes remain valid with the new top-level field.
- Backend:
  - `server/src/repositories/geocode-cache.ts`
    - Add a read-only helper to load cache rows for a set of normalized location
      keys. No provider calls and no writes.
  - `server/src/services/today-location-context.ts` (or a clearly named helper)
    - Pure/deterministic shaping from event rows + cache rows into shared
      `TodayEventLocationContext[]`.
    - Reuse `normalizeLocation` from `server/src/maps/normalize.ts`.
    - Deduplicate event ids and normalized locations.
    - Select cache rows deterministically if multiple providers ever exist
      (current provider is Google only).
  - `server/src/routes/today.ts` / `server/src/services/today.ts`
    - Attach `locationContexts` to the existing Today surface after existing
      domain filtering and card construction inputs are known.
    - Preserve Today card ordering and feasibility inputs.
  - Tests:
    - Add unit tests for the pure location-context builder.
    - Add route integration tests with a temporary SQLite database and seeded
      `geocode_cache` rows proving cache-only Today metadata and no provider
      call path.
- Frontend:
  - `web/src/Today.tsx`
    - Add helper(s) to find a location context by event id.
    - Render compact location context on `next_event`, `needs_review`,
      `schedule_prompt`, and conflict cards.
    - Build public external map links from coordinates or authored text using
      only encoded data and no API key.
    - Avoid nested interactive controls when a card already opens detail or a
      conflict sheet.
  - `web/src/Today.test.tsx`
    - Add tests for `next_event`, `needs_review`, `schedule_prompt`, conflict
      card location context, map action safety, and preservation of existing
      card actions.
  - `web/src/styles.css`
    - Add semantic-token-only compact chip/action styles with 44px touch
      targets and no new palette.
- Docs:
  - `docs/map-roadmap-cycles-72-76.md`
    - Mark Cycle 74 merged and Cycle 75 promoted/active.
  - `docs/codebase-map.md`
    - Update after implementation with the Today location-context shared/server
      and frontend boundaries.

## Sprint Contract

- Passing criteria:
  - `GET /api/today` includes `locationContexts` for event-bearing Today data
    without changing existing card discriminants, card order, or priority.
  - Today location context is cache-only: no `mapGateway.geocodeAddress`, no
    provider HTTP fetch, no `/api/events/:id/geocode` POST, and no automatic
    bulk geocoding from Today.
  - Blank/null event location is represented quietly and does not create a fake
    unresolved warning.
  - Non-empty uncached location is represented as `uncached` and does not call
    the provider.
  - Cached resolved rows surface coordinate/display/confidence metadata and
    allow a coordinate-backed external map action.
  - Cached ambiguous/zero-result/failed rows preserve uncertainty/status without
    fabricated coordinates.
  - Conflict cards can show location context for both events without changing
    conflict sheet opening or resolve behavior.
  - `next_event`, `needs_review`, and `schedule_prompt` cards keep their existing
    detail/slot/dismiss actions.
  - External map links include only encoded coordinates or authored location
    text and never expose API keys, raw provider URLs, raw provider payloads, or
    raw provider `error_message`.
  - No DB migration, travel-time cache, travel-time scoring, feasibility budget
    change, route/directions display, autocomplete, cron, or bulk geocoding is
    introduced.
  - UI styles use semantic tokens only, keep touch targets at least 44px, and do
    not dominate the card or turn location into an alert.
  - `docs/codebase-map.md` reflects the new Today location-context boundary
    after implementation.
- Automatic checks:
  - `corepack pnpm lint`
  - `corepack pnpm typecheck`
  - `corepack pnpm test`
  - `corepack pnpm test:integration`
  - `corepack pnpm build`
  - `corepack pnpm verify`
  - `git diff --check master...HEAD`
  - Static negative checks:
    - No migration/schema/provider gateway changes:
      `git diff --name-only master...HEAD | rg '^(server/drizzle/|server/src/db/schema|server/src/maps/gateway|server/src/maps/config|server/src/routes/geocoding|server/src/services/geocoding)'`
      should have no implementation matches.
    - Today must not call geocode/provider:
      `git diff -U0 master...HEAD -- server/src/routes/today.ts server/src/services server/src/repositories web/src | rg -n 'geocodeAddress|/api/events/.*/geocode|/geocode|maps.googleapis.com|MAP_PROVIDER_API_KEY'`
      should have no Today implementation matches except docs/tests that assert absence.
    - No travel-time/future-cycle scope:
      `git diff -U0 master...HEAD -- server shared web docs | rg -n 'travel_time|duration|distanceMeters|computeRouteMatrix|distanceMatrix|directions|route matrix|autocomplete|cron|bulk geocod'`
      should have no implementation matches outside roadmap/plan text.
- Test cases:
  - Shared schema accepts `locationContexts` for missing, uncached, resolved,
    ambiguous, zero-result, and failed contexts.
  - Today route returns location contexts for `next_event`, `needs_review`,
    `schedule_prompt`, conflict pair/day events when cache rows exist.
  - Today route returns `uncached` for non-empty locations without cache rows and
    does not write to `geocode_cache`.
  - Today route does not require or call a map gateway/provider.
  - Malformed cache uncertainty JSON does not crash Today context shaping.
  - Existing Today card order remains conflict -> watcher -> next_event ->
    two_minute_task -> needs_review -> schedule_prompt -> task_schedule_prompt.
  - Frontend renders resolved location chip/action on next_event.
  - Frontend renders quiet unresolved/uncached chips without warning styling.
  - Frontend renders both conflict option locations where provided.
  - Existing next_event detail open, needs_review question/reply, schedule_prompt
    slot/dismiss, and conflict sheet open actions still work.
- gas limit: N/A
- slither pass: N/A

## Missing Edge Case Candidates

- The same normalized location can appear on multiple Today events. The backend
  should read the cache once and attach context to each event id without
  duplicate provider work or duplicate DB writes.
- A future provider could leave multiple cache rows for one normalized location.
  The selection rule must be deterministic and provider-neutral enough not to
  confuse Today.
- Cards that are already buttons can become invalid HTML if a map link is nested
  inside them. The implementation must keep interactive targets separate.

## Simpler Alternative

Have the frontend call `POST /api/events/:id/geocode` for every visible Today
event card. This would reuse Cycle 74 code but would create geocoding storms,
make Today provider-dependent, and violate the roadmap boundary. The adopted
approach keeps Today cache-only and explicit geocoding in event detail.

## Assumptions

- Cycle 73 `geocode_cache` rows are the only source of location recognition
  data for Today.
- Cache miss means "not checked yet", not "location impossible".
- Current provider is Google, but the Today context should not require Google
  semantics beyond the stored provider-neutral cache columns.
- Existing Today card layout can fit compact location chips without needing a
  new Today card type.

## Review Guidance

### Enumeration Needed

- Today event-bearing card/card-input set:
  - Search: `rg -n 'kind: "conflict"|kind: "next_event"|kind: "needs_review"|kind: "schedule_prompt"|dayEvents|unscheduledEvents|needsReviewEvents' server/src/services/today.ts server/src/routes/today.ts shared/src/today.ts web/src/Today.tsx`
  - Expected: location context covers conflict pair events, next_event,
    needs_review, schedule_prompt/unscheduled event rows, and dayEvents where
    relevant; task-only cards are excluded.
- Geocode/provider call boundary:
  - Search: `rg -n 'geocodeAddress|/api/events/.*/geocode|/geocode|maps.googleapis.com|MAP_PROVIDER_API_KEY' server/src/routes/today.ts server/src/services server/src/repositories web/src`
  - Expected: no Today implementation calls provider or the event geocode POST.
- Cache read/write boundary:
  - Search: `rg -n 'geocodeCache|geocode_cache|upsertGeocode|insert\\(geocodeCache\\)' server/src`
  - Expected: Cycle 75 adds read-only cache lookup/shaping for Today; no new
    Today write path.
- Frontend card action preservation:
  - Search: `rg -n 'data-conflict-opener|상세 보기|slot-candidates|schedule-prompt|needs_review|today-card-event-btn' web/src/Today.tsx web/src/Today.test.tsx`
  - Expected: existing actions remain and tests still cover them.

### Verification Method Guide

- Cache-only Today metadata:
  - Requires server route integration tests against a real temporary SQLite DB
    with seeded `geocode_cache` rows and an assertion that no provider/geocode
    endpoint call path is used. Mock-only tests are insufficient for cache row
    shape and migration compatibility.
- Pure context shaping:
  - Unit tests are sufficient for malformed uncertainty JSON, dedupe, missing,
    uncached, and multiple-cache-row selection behavior.
- Frontend card rendering:
  - `web/src/Today.test.tsx` component tests are required for next_event,
    needs_review, schedule_prompt, and conflict card cases.
- No scope creep:
  - Static diff checks are required for migrations/provider gateway/travel-time
    terms because this cycle must not implement Cycle 76 early.
- External map URL safety:
  - Unit/component tests plus static grep for provider keys/raw fields are
    sufficient. No browser provider integration test is required.
