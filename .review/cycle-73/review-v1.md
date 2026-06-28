# Codex Review v1

## Verdict
BLOCKED

## Findings
### ISSUE-1 [HIGH] Shared geocode response schema rejects required route errors
- 위치: shared/src/maps.ts:98
- 분석: `EventGeocodeErrorSchema` only accepts the map-provider error enum, but the route returns `VALIDATION_ERROR`, `NOT_FOUND`, and `LOCATION_MISSING` at server/src/routes/geocoding.ts:14, server/src/routes/geocoding.ts:22, and server/src/routes/geocoding.ts:25. Those are normal failure responses required by the plan, but they do not satisfy the shared `EventGeocodeResponseSchema`.
- 영향: Sprint Contract requires stable typed responses for invalid id, unknown event, and blank/missing location. Clients/tests using the shared response schema reject those responses.
- 수정 방향: Define a geocode-route error-code schema that includes route errors plus map errors, and validate/test the 400/404/409 response shapes against `EventGeocodeResponseSchema`.

### ISSUE-2 [HIGH] Route accepts malformed ids and request bodies
- 위치: server/src/routes/geocoding.ts:11
- 분석: The handler parses params with `parseInt`, so a path like `/api/events/1abc/geocode` is accepted as event id `1`. The route also has no body/query validation, so a JSON body such as `{ "address": "..." }` is accepted and ignored instead of being rejected.
- 영향: Sprint Contract says event id must be a positive integer and `POST /api/events/:id/geocode` accepts no request body and no arbitrary address parameter. A malformed path can geocode/cache the wrong event.
- 수정 방향: Add strict runtime schemas for params/body/query. Require a full positive-integer id string/number, reject any request body and unexpected query fields, and add integration tests for malformed ids and non-empty body rejection.

### ISSUE-3 [MEDIUM] Provider config errors are collapsed into disabled mode
- 위치: server/src/maps/gateway.ts:71
- 분석: `createMapGateway(config_error)` exposes `provider: "disabled"`. The service checks `mapGateway.provider` first at server/src/services/geocoding.ts:26 and returns `disabled` before calling `geocodeAddress`, making the gateway's `config_error` geocode branch unreachable through this route.
- 영향: Failure behavior requires provider config errors to return a scoped map error. The current route reports them as disabled, losing the actionable misconfiguration signal.
- 수정 방향: Let `geocodeAddress` own disabled/config-error mapping, or expose a distinct gateway config state. Add a route/service test with a config-error gateway.

## Sprint Contract Check
- New SQLite table/cache boundary: PASS by migration/schema inspection and integration tests. `geocode_cache` is additive with unique `(provider, normalized_location)` and coordinate/check constraints.
- Existing table rebuild/alter avoidance: PASS by direct inspection of `server/drizzle/0010_mysterious_phalanx.sql`; the exact static grep was blocked by the repo destructive-command hook because the search pattern contained a destructive SQL phrase.
- Event location not rewritten: PASS by route integration test.
- Route accepts no body / positive integer id only: FAIL (ISSUE-2).
- 404/409 no provider call/no cache write: behavior covered, but shared response schema is wrong for those errors (ISSUE-1).
- Cache hit/miss, normalized reuse, resolved/ambiguous/zero-result persistence: PASS by integration tests.
- Transient provider failures not cached: PASS for generic service path and `unavailable`; rate-limit/invalid-response are covered at gateway level, not as route-specific SQLite assertions.
- Provider key/raw payload exposure: PASS by manual gateway/schema inspection; broad static grep over docs/source triggered local failure tracking and was not retried.
- Cycle 72 smoke route unchanged/no frontend/future-cycle scope: PASS by changed-file inspection and smoke route tests.
- Docs/codebase map: PASS.

## Automatic Checks
- `git diff --check master...HEAD`: PASS
- `git diff --name-only master...HEAD -- web`: PASS (no output)
- `corepack pnpm --filter @cairn/shared test -- src/maps.test.ts`: PASS (17 files, 430 tests; workspace config ran full shared suite)
- `corepack pnpm --filter @cairn/server test -- src/maps/gateway.test.ts src/routes/maps.test.ts`: PASS (40 files, 507 tests; workspace config ran full server unit suite)
- `corepack pnpm --filter @cairn/server test:integration -- src/repositories/geocode-cache.integration.test.ts src/routes/geocoding.integration.test.ts src/db/schema.integration.test.ts`: PASS (39 files, 702 tests; integration config ran full suite)
- `corepack pnpm typecheck`: PASS

## Changes Outside Plan
None found in `master...HEAD`. The working tree contains unrelated uncommitted files outside this diff; they were not part of this review.

<!-- RESOLVED-BOUNDARY · 위=Codex immutable, 아래=Executor append-only · check-resolved-immutable.sh가 강제 -->

## RESOLVED (Executor 응답, 파일 끝에 append)

### Issue Classification
- ISSUE-1: APPLY (plan requires stable typed responses for invalid id / unknown event / blank location.)
- ISSUE-2: APPLY (plan requires positive-integer id and no request body / no arbitrary address param.)
- ISSUE-3: APPLY (plan failure behavior requires provider config errors to return a scoped map error, not be reported as disabled.)

### Applied

RESOLVED: ISSUE-1 — the shared response schema now accepts the route's normal failure codes.
- `shared/src/maps.ts`: added `GEOCODE_ROUTE_ERROR_CODES = ["VALIDATION_ERROR","NOT_FOUND","LOCATION_MISSING"]` and `GeocodeErrorCodeSchema = z.enum([...MAP_ERROR_CODES, ...GEOCODE_ROUTE_ERROR_CODES])`; `EventGeocodeErrorSchema.code` uses it. So `EventGeocodeResponseSchema` now validates the 400/404/409 responses as well as map-provider errors. (+`GeocodeErrorCode` type.)
- Tests: shared test asserts the route + map codes all validate (and an unknown code is rejected); a route integration test asserts the 400/404/409 AND 200 responses all satisfy `EventGeocodeResponseSchema`.

RESOLVED: ISSUE-2 — strict id + no body/query.
- `server/src/routes/geocoding.ts`: the whole `:id` segment must match `/^\d+$/` and be > 0 — `"1abc"` is now rejected with 400 (previously `parseInt` accepted it as `1`). A request body or any query parameter is rejected with 400 `VALIDATION_ERROR` via a `hasContent()` guard (non-empty object, or a non-object payload), so the route geocodes ONLY the event's own location — no arbitrary address.
- Tests: `1abc`→400, body `{address}`→400, `?address=`→400, each asserting the provider was not called and no cache row was written.

RESOLVED: ISSUE-3 — config errors surface distinctly, not as disabled.
- `server/src/services/geocoding.ts`: removed the early `if (mapGateway.provider === "disabled")` return. `geocodeAddress` now owns the mapping — the gateway already returns `disabled` for a disabled provider and `config_error` for a misconfigured one, both WITHOUT a provider HTTP fetch — so the route preserves the actionable misconfiguration signal (config_error) instead of collapsing it to disabled. Neither path writes a cache row.
- Tests: a config-error gateway → 503 `config_error` (distinct from disabled); the disabled test still returns 503 `disabled` with no cache write.

Scope: production change limited to `shared/src/maps.ts` (error-code enum), `server/src/routes/geocoding.ts` (validation), `server/src/services/geocoding.ts` (remove pre-check). Gateway, geocode_cache table, migration 0010, and the repository are unchanged; `events.location` still never rewritten; cycle-72 smoke route unchanged.

자동 체크: `corepack pnpm lint` ✅ / `typecheck` ✅ / `test` shared 431 / server 507 / web 485 ✅ / `test:integration` 706 (geocode route +4) ✅ / `build` ✅ / `git diff --check master...HEAD` ✅. Committed in pass-002.
