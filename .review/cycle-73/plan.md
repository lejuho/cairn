# Geocoding Cache A Implementation Plan

Branch: feature/cycle-73-geocoding-cache-a
Cycle: 73
Created: 2026-06-28
Skills: backend-fastify

## Summary

Cycle 73 promotes **Geocoding Cache A** from
`docs/map-roadmap-cycles-72-76.md`.

Cycle 72 created the server-side map provider boundary and selected Google Maps
Platform as the initial provider. This cycle turns authored event `location`
text into a SQLite-backed, provenance-preserving geocode cache. It adds a
backend route that geocodes one event's existing location on demand, reuses
cached results by normalized location text + provider, and preserves uncertainty
instead of pretending coordinates exist.

No frontend map UI, Today card change, travel-time/directions call, automatic
bulk geocoding cron, event creation autocomplete, or rewrite of existing event
`location` fields is introduced.

## Input/Output Spec

- Input:
  - Existing provider config from Cycle 72:
    - `MAP_PROVIDER=disabled|google`
    - `MAP_PROVIDER_BASE_URL`
    - `MAP_PROVIDER_API_KEY`
    - `MAP_PROVIDER_TIMEOUT_MS`
  - Existing event data:
    - `events.location` is authored location text. It remains the source input
      and is never rewritten by this cycle.
  - New route:
    - `POST /api/events/:id/geocode`
    - No request body.
    - No arbitrary location/address parameter. The route only geocodes the
      target event's existing `location`.
    - Event id must be a positive integer.
- Normal output:
  - If the event has a non-empty location:
    - Normalize location text deterministically (trim, Unicode normalize,
      collapse whitespace, lowercase for cache key) and key the cache by
      `(provider, normalizedLocation)`.
    - On cache hit, return the cached result without calling the provider.
    - On cache miss, call `mapGateway.geocodeAddress(locationText)` and persist
      a cache row for stable provider facts:
      - `resolved`: one usable result with latitude, longitude, display label,
        provider result id when available, confidence, provider status, and
        uncertainty metadata;
      - `ambiguous`: multiple possible results, no fabricated selected
        coordinate, result count and limited provider-neutral candidate labels
        in uncertainty metadata;
      - `zero_results`: provider says no result, no coordinates;
      - `failed`: stable address/request failure tied to the location text, no
        coordinates.
    - Return a shared typed response containing event id, provider, authored
      location text, normalized location, cache status (`hit|miss`), geocode
      status, optional coordinate fields, confidence, provider result id,
      display label, timestamps, and provider-neutral uncertainty metadata.
  - Existing event read/edit routes remain unchanged.
- Failure behavior:
  - Unknown event id returns 404 with no provider call and no cache write.
  - Empty/blank event location returns 409 `LOCATION_MISSING` with no provider
    call and no cache write.
  - `MAP_PROVIDER=disabled` or provider config error returns a scoped map error;
    the event remains readable/editable and no cache row is fabricated.
  - Transient provider failures (`unavailable`, timeout, rate-limited) and
    invalid provider response return scoped errors and are not cached.
  - Cache writes are idempotent on `(provider, normalizedLocation)` and do not
    create duplicate rows under repeated calls.
  - No response or stored uncertainty metadata includes API keys, full provider
    URLs with keys, raw provider payloads, or raw provider `error_message`.

## Key Changes

- Shared:
  - `shared/src/maps.ts`
    - Extend map schemas/types with geocode cache status, geocode result status,
      confidence, uncertainty metadata, route response, and stable error codes.
- Backend DB/schema:
  - `server/src/db/schema.ts`
    - Add `geocodeCache` table with:
      - `id`
      - `provider` (`google` initially)
      - `normalized_location`
      - `location_text`
      - `status` (`resolved|ambiguous|zero_results|failed`)
      - `latitude`, `longitude`
      - `display_label`
      - `provider_result_id`
      - `confidence` (`high|medium|low|unknown`)
      - `provider_status`
      - `uncertainty_json`
      - `created_at`, `updated_at`, `last_checked_at`
      - unique index on `(provider, normalized_location)`.
    - Add CHECK constraints so coordinates are either both present or both null.
  - `server/drizzle/0010_*.sql` and `server/drizzle/meta/*`
    - Add a new-table migration only. No table rebuild and no changes to
      existing tables.
- Backend map/provider:
  - `server/src/maps/gateway.ts`
    - Extend the single map gateway boundary with
      `geocodeAddress(address: string)`.
    - Parse Google Geocoding responses into provider-neutral data: formatted
      label, place id, coordinate, result count, provider status, location
      type/partial-match uncertainty, and confidence.
    - Preserve Cycle 72 smoke behavior unchanged.
  - `server/src/maps/normalize.ts`
    - Add deterministic location normalization if extraction is clearer than
      keeping it in the service.
- Backend repository/service:
  - `server/src/repositories/geocode-cache.ts`
    - Read by `(provider, normalizedLocation)`.
    - Upsert cache rows idempotently using the unique key.
    - Return normalized row shapes; no provider calls in repository code.
  - `server/src/services/geocoding.ts`
    - Orchestrate event lookup, blank-location guard, cache hit, provider call,
      cache write, and response shaping.
    - Map provider failures to route-level errors without mutating the event or
      fabricating coordinates.
- Backend route:
  - `server/src/routes/geocoding.ts`
    - Add `POST /api/events/:id/geocode`.
    - Thin handler: validate id, call service, map service result to stable HTTP
      status and shared schema-shaped response.
  - `server/src/app.ts`
    - Register the event geocode route only when both DB and map gateway exist.
    - Keep Cycle 72 `GET /api/maps/provider-smoke` registration unchanged.
- Tests:
  - `shared/src/maps.test.ts`
    - Cover new response/error schemas.
  - `server/src/maps/gateway.test.ts`
    - Add geocode provider parsing/status tests while preserving Cycle 72 smoke
      tests.
  - `server/src/repositories/geocode-cache.integration.test.ts`
    - Temporary SQLite tests for schema constraints, unique key/idempotent
      upsert, and coordinate nullability.
  - `server/src/routes/geocoding.integration.test.ts`
    - Temporary SQLite + mocked map gateway tests for route/service behavior.
  - `server/src/db/schema.integration.test.ts`
    - Update expected table list to include `geocode_cache`.
- Docs:
  - `docs/map-roadmap-cycles-72-76.md`
    - Mark Cycle 72 as merged and Cycle 73 as promoted/active.
  - `docs/codebase-map.md`
    - Update after implementation with the geocode cache table, route, service,
      repository, and map gateway geocode method.

## Sprint Contract

- Passing criteria:
  - SQLite schema contains exactly one new table, `geocode_cache`, with a unique
    `(provider, normalized_location)` key.
  - No existing table is rebuilt or altered except Drizzle metadata needed by
    the new table.
  - Event `location` text is never rewritten by geocoding.
  - `POST /api/events/:id/geocode` accepts no request body and no arbitrary
    address parameter.
  - Unknown event returns 404 with no provider call and no cache write.
  - Blank/missing event location returns 409 `LOCATION_MISSING` with no provider
    call and no cache write.
  - Cache hit returns without provider call.
  - Cache miss calls only `mapGateway.geocodeAddress` through the server map
    gateway boundary and writes exactly one cache row.
  - Repeated calls for equivalent normalized locations reuse the same cache row.
  - Resolved provider result persists coordinates, display label, provider
    result id when available, confidence/status, and provider-neutral
    uncertainty metadata.
  - Ambiguous and zero-result provider outcomes persist uncertainty/status
    without fabricated coordinates.
  - Transient provider failures and invalid provider responses return scoped map
    errors and do not cache fabricated results.
  - No API keys, full provider URLs with key query params, raw provider payloads,
    or raw provider `error_message` enter responses, logs, or cache rows.
  - Existing Cycle 72 provider smoke route remains unchanged.
  - No frontend, Today surface, feasibility, travel-time/directions,
    event-creation autocomplete, automatic cron, or bulk geocoding behavior is
    introduced.
  - `docs/codebase-map.md` reflects the new DB/route/service boundaries after
    implementation.
- Automatic checks:
  - `corepack pnpm db:generate`
  - `corepack pnpm lint`
  - `corepack pnpm typecheck`
  - `corepack pnpm test`
  - `corepack pnpm test:integration`
  - `corepack pnpm build`
  - `corepack pnpm verify`
  - `git diff --check master...HEAD`
  - Static negative checks:
    - No frontend changes:
      `git diff --name-only master...HEAD | rg '^web/'`
      should have no matches.
    - No existing table rebuild/alter:
      `git diff -U0 master...HEAD -- server/drizzle server/src/db/schema.ts | rg -n 'ALTER TABLE `(events|threads|tasks|annotations|watchers|watcher_logs|people|event_people|links|thread_links|resources|resource_links|params)`|DROP TABLE|CREATE TABLE `__old'`
      should have no matches.
    - No travel-time/route matrix/UI scope:
      `git diff -U0 master...HEAD -- server shared docs | rg -n 'computeRouteMatrix|distanceMatrix|travel_time|duration|distanceMeters|Map preview|Today Location|Maps JavaScript|autocomplete|cron|bulk geocod'`
      should have no implementation matches outside roadmap/plan text.
    - Provider keys/raw provider data not exposed:
      `git diff -U0 master...HEAD -- server shared docs | rg -n 'MAP_PROVIDER_API_KEY=.*[A-Za-z0-9_-]{8}|maps.googleapis.com.*key=|error_message|raw_payload|rawProvider|address_components'`
      should have no implementation matches outside gateway internals/tests that
      prove raw fields are not surfaced.
    - Geocoding provider calls remain behind the gateway:
      `rg -n 'maps.googleapis.com|/maps/api/geocode|geocodeAddress|MAP_PROVIDER_API_KEY' server/src shared/src docs .review/cycle-73`
      should show provider HTTP construction only in `server/src/maps/gateway.ts`
      and tests/docs.
- Test cases:
  - Migration creates `geocode_cache` in a temporary SQLite database.
  - Unique key prevents duplicate provider/location cache rows.
  - CHECK constraints reject invalid status/confidence and half-present
    coordinates.
  - Normalization trims, collapses whitespace, Unicode-normalizes, and gives the
    same key for casing/spacing variants.
  - Route rejects invalid event id with 400.
  - Unknown event id returns 404 with no provider/cache write.
  - Event with blank/null location returns 409 `LOCATION_MISSING` with no
    provider/cache write.
  - Cache hit returns a `hit` response and does not call provider.
  - Cache miss resolved result calls provider once, writes cache, and returns
    `miss`/`resolved` with coordinates.
  - Repeated equivalent location call reuses the existing row.
  - Ambiguous provider result writes/returns `ambiguous` without coordinates.
  - Zero-results provider response writes/returns `zero_results` without
    coordinates.
  - Provider disabled/config error/unavailable/rate-limited/invalid response
    returns scoped errors and writes no fabricated row.
  - Existing Cycle 72 smoke route tests still pass.
- gas limit: N/A
- slither pass: N/A

## Missing Edge Case Candidates

- Two events can share the same authored location with different casing or
  whitespace. The normalized cache key must collapse them without changing the
  original event text.
- A provider can return multiple results or partial matches. The service must
  preserve ambiguity instead of selecting a coordinate silently.
- Provider downtime after a cache miss must not create a permanent failed cache
  row that blocks later successful resolution.

## Simpler Alternative

Store geocode data directly on `events`.

Rejected because it rewrites event rows and mixes authored event text with
provider-derived facts. The roadmap requires a cache boundary keyed by
normalized location text and provider identity, preserving provenance and
uncertainty separately from the event.

## Assumptions

- Cycle 72 is merged into `master`, so `MapGateway` and
  `GET /api/maps/provider-smoke` exist.
- Google Geocoding API remains the initial provider, but all route/service/cache
  contracts stay provider-neutral.
- A cache row represents provider facts for a normalized location, not a user
  decision. Suggestions or UI actions based on that row are later cycles.
- Cache freshness/refresh policy is not part of this A-slice; repeated calls
  reuse an existing row until a later cycle adds explicit refresh semantics.
- Real provider calls are not required in automated tests; integration tests use
  a temporary SQLite database and mocked map gateway.

## Review Guidance

### Enumeration Required

- DB table and migration:
  - Search:
    `rg -n 'geocode_cache|geocodeCache|normalized_location|provider_result_id|uncertainty_json' server/src server/drizzle shared/src`
  - Expected: one schema table, one new migration, repository/service/route and
    shared schemas. No existing table alteration.
- Route and app registration:
  - Search:
    `rg -n 'events/.*/geocode|register.*Geocode|geocodeAddress|provider-smoke|buildServer\\(' server/src`
  - Expected: event geocode route requires DB + map gateway; provider-smoke
    remains no-DB diagnostic.
- Provider boundary:
  - Search:
    `rg -n 'maps.googleapis.com|/maps/api/geocode|MAP_PROVIDER_API_KEY|error_message|address_components' server/src shared/src docs .review/cycle-73`
  - Expected: provider HTTP/raw response details stay inside
    `server/src/maps/gateway.ts` and tests; route/service/cache use
    provider-neutral shapes.
- Future-cycle leakage:
  - Search:
    `git diff -U0 master...HEAD -- server shared docs | rg -n 'computeRouteMatrix|distanceMatrix|travel_time|duration|distanceMeters|Map preview|Today Location|Maps JavaScript|autocomplete|cron|bulk geocod'`
  - Expected: no implementation matches outside roadmap/plan text.

### Verification Method Guide

- DB constraints, unique key, migration application, and route write behavior
  require integration tests against a real temporary SQLite database.
- Provider calls are mocked at the `MapGateway`/injected-fetch seam; no real
  network or API key is required.
- Cache hit/miss and no-write failure paths must be verified by inspecting
  SQLite rows, not only mocked service calls.
- Static negative checks are required to prove no frontend, Today, travel-time,
  cron, or event-location rewrite scope slipped in.
