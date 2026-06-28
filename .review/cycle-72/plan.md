# Map Provider Boundary A Implementation Plan

Branch: feature/cycle-72-map-provider-boundary-a
Cycle: 72
Created: 2026-06-28
Skills: backend-fastify

## Summary

Cycle 72 promotes **Map Provider Boundary A** from
`docs/map-roadmap-cycles-72-76.md`.

This cycle creates the server-side map provider boundary only. It chooses
Google Maps Platform as the initial provider because the official Geocoding API
is an HTTPS server-side web service that takes an API key, returns structured
status codes (`OK`, `ZERO_RESULTS`, quota/auth/denied/invalid/unknown errors),
and the same platform has a Routes API suitable for the later Cycle 76 travel
time work. Provider-specific details remain behind a small `server` gateway.

No event geocoding cache, DB schema, migration, frontend UI, Today card change,
feasibility change, provider SDK, browser API key, automatic geocoding, or
travel-time logic is introduced.

References checked during promotion:

- Google Geocoding API request/response:
  `https://developers.google.com/maps/documentation/geocoding/requests-geocoding`
- Google Geocoding web-service best practices:
  `https://developers.google.com/maps/documentation/geocoding/web-service-best-practices`
- Google Routes API route matrix for the later travel-time cycle:
  `https://developers.google.com/maps/documentation/routes/compute_route_matrix`

## Input/Output Spec

- Input:
  - Environment/config only:
    - `MAP_PROVIDER`: `disabled` or `google`; default `disabled`.
    - `MAP_PROVIDER_BASE_URL`: optional provider base URL; default for Google is
      `https://maps.googleapis.com`.
    - `MAP_PROVIDER_API_KEY`: required only when `MAP_PROVIDER=google`.
    - `MAP_PROVIDER_TIMEOUT_MS`: optional bounded timeout; invalid/blank values
      fall back to the default.
  - Diagnostic route:
    - `GET /api/maps/provider-smoke`
    - No request body.
    - No arbitrary user-supplied address/query parameter; the route calls one
      fixed smoke geocode query through the gateway so it cannot become the
      Cycle 73 on-demand geocoding API.
    - The route must not require SQLite and must not mutate any state.
- Normal output:
  - Disabled mode returns a stable typed success response indicating the map
    provider is disabled and no network call was attempted.
  - Configured Google mode calls only the map gateway, which calls the Google
    Geocoding endpoint through `fetch` with a server-side API key.
  - A successful provider response returns only provider-neutral diagnostic
    data such as provider id, configured mode, reachability, provider status,
    and result count. It does not return raw provider payloads or persist
    coordinates.
- Failure behavior:
  - Missing API key while `MAP_PROVIDER=google`, provider timeout, connection
    failure, quota/rate-limit, denied/auth, invalid request, and invalid provider
    response all map to explicit typed gateway errors.
  - The diagnostic route converts gateway errors into stable API failure shapes;
    it never fabricates coordinates or reports success for failed provider
    calls.
  - Error messages and logs must not include `MAP_PROVIDER_API_KEY`, query
    strings containing the key, or provider raw `error_message` text.
  - Existing Cairn routes behave unchanged when the map provider is disabled,
    unavailable, or misconfigured.

## Key Changes

- Backend:
  - `server/src/maps/config.ts`
    - Add provider config parsing for provider id, base URL, API key, timeout,
      and disabled mode.
    - Keep the default disabled so local/test/server startup remains unchanged
      without map credentials.
  - `server/src/maps/gateway.ts`
    - Add the single map provider gateway boundary.
    - Implement Google Maps Platform support behind provider-neutral types.
    - Use timeout cancellation, bounded retry only for retryable unavailable
      responses, and stable error mapping.
    - Do not log or return secrets, full provider URLs with keys, or raw
      provider error messages.
  - `server/src/routes/maps.ts`
    - Add `GET /api/maps/provider-smoke` as the diagnostic/smoke route.
    - Keep the handler thin: call gateway, map success/failure, return shared
      schema-shaped responses.
    - Register without requiring a DB, because this cycle has no persistence.
  - `server/src/app.ts`
    - Accept an optional map gateway and register the map route without changing
      existing DB-backed or LLM-backed route behavior.
  - `server/src/index.ts`
    - Build the map gateway from environment config and pass it to the app.
  - `server/src/maps/config.test.ts`
    - Cover defaults, disabled mode, Google config, blank values, timeout
      bounds, and missing-key behavior.
  - `server/src/maps/gateway.test.ts`
    - Cover disabled/no-fetch behavior, Google request construction, URL
      encoding, timeout/network failure, provider status/error mapping, invalid
      JSON/shape handling, retry bounds, and no-secret error surfaces.
  - `server/src/routes/maps.test.ts`
    - Cover diagnostic route disabled success, configured/mock success, and
      typed failures without a DB.
- Shared:
  - `shared/src/maps.ts`
    - Add runtime schemas and types for the diagnostic route response and stable
      map error codes.
  - `shared/src/index.ts`
    - Export the new map schemas/types.
- Docs:
  - `docs/map-roadmap-cycles-72-76.md`
    - Mark Cycle 72 as promoted/active and record the selected initial provider.
  - `docs/codebase-map.md`
    - Update after implementation because a new external provider boundary and
      route are introduced.

## Sprint Contract

- Passing criteria:
  - `MAP_PROVIDER` defaults to `disabled`; existing server startup and existing
    routes do not require map credentials.
  - `MAP_PROVIDER=google` requires `MAP_PROVIDER_API_KEY`; missing or blank key
    is a typed configuration error, not a crash and not silent success.
  - All map provider calls go through exactly one server gateway module.
  - The Google implementation uses server-side `fetch`; no client/browser SDK or
    browser-exposed API key is introduced.
  - Provider timeout is bounded and testable with an injected `fetch`.
  - Retry behavior is bounded and only applies to retryable unavailable/server
    failures, not validation/auth/config failures.
  - Google provider statuses are mapped explicitly, including at least `OK`,
    `ZERO_RESULTS`, `OVER_DAILY_LIMIT`, `OVER_QUERY_LIMIT`, `REQUEST_DENIED`,
    `INVALID_REQUEST`, and `UNKNOWN_ERROR`.
  - The diagnostic route has no arbitrary address parameter and does not become
    the Cycle 73 geocoding API.
  - The diagnostic route works in disabled mode without making a provider call.
  - The diagnostic route can be tested with a mock/injected gateway/fetch and no
    real network.
  - No route returns provider raw payloads, raw `error_message`, coordinates as
    persisted facts, or any API key material.
  - No DB schema, Drizzle migration, repository, event persistence, Today
    aggregation, feasibility logic, frontend, PWA, or map UI change is made.
  - Existing LLM gateway behavior and LLM env vars remain unchanged.
  - `docs/codebase-map.md` reflects the new map boundary after implementation.
- Automatic checks:
  - `corepack pnpm lint`
  - `corepack pnpm typecheck`
  - `corepack pnpm test`
  - `corepack pnpm test:integration`
  - `corepack pnpm build`
  - `corepack pnpm verify`
  - `git diff --check master...HEAD`
  - Static negative checks:
    - No frontend or DB/migration changes:
      `git diff --name-only master...HEAD | rg '^(web/|server/drizzle/|server/src/db/schema.ts)'`
      should have no matches.
    - Provider keys never enter frontend/config docs as public env:
      `git diff -U0 master...HEAD -- web server shared docs | rg -n 'VITE_.*MAP|NEXT_PUBLIC.*MAP|MAP_PROVIDER_API_KEY=.*[A-Za-z0-9_-]{8}|maps.googleapis.com.*key='`
      should have no matches.
    - Single gateway boundary:
      `rg -n 'maps.googleapis.com|routes.googleapis.com|MAP_PROVIDER_API_KEY|MAP_PROVIDER_BASE_URL' server/src shared/src docs .review/cycle-72`
      should show implementation references only in `server/src/maps/*`,
      route wiring/tests, shared schemas, docs, and this plan.
    - No Cycle 73+ persistence/UI/travel-time scope:
      `git diff -U0 master...HEAD -- server shared docs | rg -n 'CREATE TABLE|ALTER TABLE|drizzle-kit|geocode_cache|travel_time|distanceMatrix|computeRouteMatrix|Today card|Map preview|browser SDK|Maps JavaScript'`
      should have no implementation matches outside roadmap/plan text.
- Test cases:
  - Config defaults to disabled when env is absent.
  - Config trims values and rejects/flags unsupported provider ids.
  - `MAP_PROVIDER=google` with blank/missing key yields a typed config error.
  - Disabled gateway result does not call `fetch`.
  - Google gateway constructs an HTTPS Geocoding API request with URL-encoded
    smoke address and server-side key.
  - Success `OK` with results returns provider-neutral diagnostic success.
  - `ZERO_RESULTS` is surfaced as a non-fabricated diagnostic result with zero
    results, not a coordinate.
  - `OVER_QUERY_LIMIT`/HTTP 429 maps to rate-limited.
  - `OVER_DAILY_LIMIT`/`REQUEST_DENIED` maps to denied/config/auth failure.
  - `INVALID_REQUEST` maps to invalid request and is not retried.
  - `UNKNOWN_ERROR`, 5xx, timeout, and connection failure map to unavailable
    with bounded retry.
  - Invalid JSON/invalid provider shape maps to invalid response.
  - Error surfaces never include the configured API key.
  - `GET /api/maps/provider-smoke` returns disabled success without a DB.
  - `GET /api/maps/provider-smoke` returns configured/mock success without a DB.
  - `GET /api/maps/provider-smoke` returns typed failure without a DB.
- gas limit: N/A
- slither pass: N/A

## Missing Edge Case Candidates

- A provider can return HTTP 200 with a non-`OK` status. The gateway must treat
  provider status as authoritative and not rely only on HTTP status.
- URL/query construction can accidentally leak the key in errors or logs. Tests
  need to assert the public error object excludes key material and full URLs.
- A diagnostic route can accidentally become a public arbitrary geocoder. Keep
  the smoke input fixed for this cycle and defer on-demand geocoding to Cycle 73.

## Simpler Alternative

Add only a config parser and unit tests, with no diagnostic route.

Rejected because the roadmap explicitly asks for a diagnostic/smoke route or
internal seam that proves the gateway can be called in mock/disabled mode. A
thin no-DB smoke route gives runtime wiring coverage while still avoiding
geocoding cache, UI, and persistence scope.

## Assumptions

- Google Maps Platform is acceptable as the initial provider for a server-side
  boundary; any future provider swap stays behind the gateway.
- Google Geocoding API v3 is sufficient for Cycle 72 smoke diagnostics, while
  later Cycle 76 can use a separate Routes API method behind the same boundary.
- Billing/API-key setup is an operator concern. This cycle validates env shape
  and failure behavior but does not provision Google Cloud resources.
- The app remains single-user/local-first; the smoke route is for local
  diagnostics and must not expose secrets or raw provider data.
- No real network access is required in automated tests; all provider responses
  are mocked through injected `fetch` or gateway seams.

## Review Guidance

### Enumeration Required

- Provider boundary and env references:
  - Search:
    `rg -n 'MAP_PROVIDER|maps.googleapis.com|routes.googleapis.com|X-Goog-Api-Key|provider-smoke|MapProvider' server/src shared/src docs .review/cycle-72`
  - Expected: references are limited to map config/gateway/route/tests, shared
    schemas, docs, and review artifacts. No web references.
- DB/frontend scope:
  - Search:
    `git diff --name-only master...HEAD | rg '^(web/|server/drizzle/|server/src/db/schema.ts|server/src/repositories/)'`
  - Expected: no matches.
- Route registration:
  - Search:
    `rg -n 'registerMap|provider-smoke|buildServer\\(' server/src`
  - Expected: map route is registered without DB dependency and existing
    DB/LLM route registration semantics remain unchanged.
- Secret leakage:
  - Search:
    `git diff -U0 master...HEAD -- server shared docs | rg -n 'MAP_PROVIDER_API_KEY=.*[A-Za-z0-9_-]{8}|maps.googleapis.com.*key=|error_message'`
  - Expected: no hardcoded key; raw provider `error_message` is not returned or
    logged.

### Verification Method Guide

- Config parsing and gateway error mapping are deterministic unit tests with
  injected env/fetch; mocks are sufficient because this cycle has no DB and no
  real provider contract test requirement.
- The diagnostic route is an app injection test, not a SQLite integration test,
  because it must work without DB and must not persist state.
- `corepack pnpm test:integration` still runs as a regression safety check for
  existing server behavior.
- Static negative checks are required to prove no Cycle 73+ cache, frontend map
  UI, Today, feasibility, migration, or travel-time scope slipped in.
