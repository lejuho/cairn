# Provider Status Badges A Implementation Plan

Branch: feature/cycle-82-provider-status-badges-a
Cycle: 82
Created: 2026-06-29
Skills: backend-fastify, frontend-react-pwa

## Summary

Cycle 82 adds a small, always-visible provider status surface for the map/search
providers that recently became operational:

- Google Maps provider: geocoding + travel-time smoke.
- Naver place search provider: local place candidate search.

The goal is not a monitoring dashboard. It is a quiet app-level signal that
answers: "Are Google and Naver connected right now?" without requiring SSH,
curl, or a server restart guess.

This cycle adds one server-owned status endpoint with short TTL caching and one
compact AppNav badge row. It avoids direct browser calls to provider endpoints,
does not expose secrets, and does not add logo assets yet. Text labels
(`Google`, `Naver`) plus semantic status dots are enough for A-slice.

## Input/Output Spec

- Input:
  - Existing Google map gateway already passed to `buildServer`.
  - Existing Naver place-search gateway already passed to `buildServer`.
  - Existing `GET /api/maps/provider-smoke` behavior.
  - Existing `GET /api/places/naver?query=` behavior.
- New output:
  - `GET /api/providers/status`
  - Response:
    - `ok: true`
    - `data.providers[]`, one row each for `google` and `naver`.
    - Each row includes:
      - `id`: `google` | `naver`
      - `label`: `Google` | `Naver`
      - `state`: `connected` | `disabled` | `degraded`
      - `code`: provider-neutral code, e.g. `ok`, `disabled`, `denied`,
        `rate_limited`, `unavailable`, `invalid_response`, `config_error`
      - `checkedAt`: ISO timestamp for the cached check
      - `ttlSeconds`: positive integer
      - `message`: static, user-safe Korean/English-neutral short copy
  - AppNav displays compact provider badges below or alongside nav links:
    - `Google 연결됨`
    - `Naver 연결됨`
    - `Google 비활성`
    - `Naver 연결 안 됨`
  - AppNav fetches once on mount, then polls at a conservative interval
    aligned with server TTL. It preserves last known status on transient UI
    fetch failure and marks the row as stale/unknown without global app failure.
- Failure behavior:
  - Provider errors never break primary app navigation.
  - Endpoint never leaks API keys, full upstream URLs, Naver error bodies,
    Google `error_message`, request headers, or raw provider payload.
  - Disabled providers are not errors.
  - Rate limited / denied / unavailable are surfaced as degraded, not fatal.
  - No background cron, DB write, schema migration, or PWA offline write queue.

## Key Changes

- Shared:
  - Add `shared/src/providerStatus.ts`.
  - Export schemas/types from `shared/src/index.ts`.
  - Unit tests cover valid rows and strict rejection of raw provider/secrets.
- Backend:
  - Add `server/src/services/provider-status.ts`.
    - Pure-ish orchestration around existing gateways; no DB.
    - Per-provider TTL cache, default 300 seconds.
    - Google check reuses `mapGateway.smoke()`.
    - Naver check reuses `placeSearchGateway.search("강남역")` or another fixed
      stable query.
    - Converts provider-specific results/errors to provider-neutral rows.
  - Add `server/src/routes/provider-status.ts`.
    - `GET /api/providers/status`.
    - Thin handler, no request body/query.
  - Register route in `server/src/app.ts` when gateways exist.
  - Tests with fake gateways for connected, disabled, denied, rate_limited,
    unavailable, invalid_response, TTL reuse, and no raw leak.
- Frontend:
  - Add `web/src/ProviderStatusBadges.tsx`.
    - Data layer fetches `GET /api/providers/status` via `apiJson`.
    - Validate response with shared schema.
    - Poll every 5 minutes or `ttlSeconds`, whichever is safe and simple.
    - Cleanup interval on unmount.
    - Render compact text badges with accessible labels.
  - Update `web/src/AppNav.tsx`.
    - Include `ProviderStatusBadges` in shared nav.
  - Update `web/src/App.test.tsx` or new focused test.
    - Connected/disabled/degraded states.
    - Poll cleanup / no global failure.
  - Update `web/src/styles.css`.
    - Semantic-token-only `.provider-status-*` styles.
    - 44px target only if refresh/action button exists; otherwise passive chips.
- Docs:
  - Add `docs/provider-status-roadmap-cycles-82-84.md`.
  - Update `docs/codebase-map.md` after implementation.

## Sprint Contract

- Passing criteria:
  - `GET /api/providers/status` returns exactly two provider rows: Google and
    Naver.
  - Google status is derived from existing map gateway smoke, not a new raw
    Google client or browser-side key.
  - Naver status is derived from existing server-side place-search gateway, not
    browser-side credentials.
  - Server uses TTL caching so repeated frontend polling does not call upstream
    providers on every request.
  - Disabled providers render as known disabled state, not an app error.
  - Denied/rate-limited/unavailable states render as degraded, not fatal.
  - AppNav shows compact provider status on all primary routes.
  - Frontend polling cleans up on unmount and preserves app usability when the
    status endpoint fails.
  - No secrets, upstream URLs, raw provider payloads, provider error bodies, or
    request headers reach the client.
  - No DB schema/migration, cron/background job, LLM path, Caddy/systemd/env
    mutation, or provider credential storage change.
- Automatic checks:
  - `corepack pnpm lint`
  - `corepack pnpm typecheck`
  - `corepack pnpm test`
  - `corepack pnpm test:integration`
  - `corepack pnpm build`
  - `corepack pnpm verify`
  - `git diff --check master...HEAD`
  - Static negative checks:
    - No secrets/raw provider leakage:
      `git diff -U0 master...HEAD -- server shared web | rg -n 'API_KEY|CLIENT_SECRET|X-Naver|error_message|maps.googleapis.com|openapi.naver.com|raw|headers'`
      should have no client-facing implementation matches except docs/tests
      proving rejection/redaction.
    - No DB/schema/migration:
      `git diff --name-only master...HEAD | rg 'server/drizzle|server/src/db/schema.ts|migration'`
      should have no matches.
    - No cron/background polling server job:
      `git diff -U0 master...HEAD -- server shared web | rg -n 'cron|setInterval\\(|setTimeout\\(|background|scheduler'`
      should show frontend polling only; no server cron/job.
    - No LLM path:
      `git diff -U0 master...HEAD -- server/src shared/src web/src | rg -n 'llm|chat/completions|Grok|prompt'`
      should have no implementation matches.
- Test cases:
  - Shared schema accepts two clean provider rows.
  - Shared schema rejects extra raw fields such as `apiKey`, `clientSecret`,
    `headers`, `errorMessage`, `raw`, `url`.
  - Backend maps Google smoke ok/disabled/denied/rate_limited/unavailable to
    safe status rows.
  - Backend maps Naver search ok/disabled/denied/rate_limited/unavailable to
    safe status rows.
  - Backend TTL returns cached rows without a second gateway call inside TTL.
  - AppNav renders connected/disabled/degraded badges with accessible labels.
  - AppNav status endpoint failure renders quiet unknown/stale state and leaves
    nav links usable.
  - Poll interval cleans up on unmount.
- gas limit: N/A
- slither pass: N/A

## Missing Edge Case Candidates

- Google can be configured while Naver is disabled, or vice versa; UI must show
  per-provider state, not one global "maps broken" state.
- A provider may be rate-limited. The UI should say degraded/limited without
  encouraging repeated manual refresh loops.
- Browser tab can stay open overnight. Polling must not leak intervals or
  hammer provider checks after route changes.

## Simpler Alternative

Frontend could call `/api/maps/provider-smoke` and `/api/places/naver` directly.
Reject: it duplicates provider-status mapping in the browser, makes Naver use a
fake search query from the UI, and risks excessive upstream checks. Server-owned
aggregation with TTL is clearer and safer.

## Assumptions

- Provider status is diagnostic only. It never changes Today card order,
  feasibility math, geocode behavior, or place-search behavior.
- `Google`/`Naver` text badges are acceptable for A-slice; official logo assets
  and brand compliance can be a later visual polish cycle.
- A 300-second TTL is sufficient for local-first UX and avoids provider quota
  noise.

## Review Guidance

### Enumeration Needed

- Provider route registration:
  - Search:
    `rg -n 'providers/status|registerProviderStatus|ProviderStatus' server/src shared/src web/src`
  - Expected: one new route, shared schemas, frontend badge component.
- Secret leakage boundary:
  - Search:
    `rg -n 'API_KEY|CLIENT_SECRET|X-Naver|error_message|maps.googleapis.com|openapi.naver.com|headers|raw' server/src shared/src web/src`
  - Expected: credentials stay only in existing config/gateway internals; status
    response schema rejects raw/leaky fields.
- Polling:
  - Search:
    `rg -n 'setInterval|clearInterval|providers/status|ProviderStatusBadges' web/src`
  - Expected: frontend-only polling with cleanup.

### Verification Method Guide

- Shared schemas:
  - Unit tests sufficient for strict shape and raw-field rejection.
- Backend status aggregation:
  - Route/unit tests with fake gateways sufficient; no real provider calls.
  - TTL behavior needs fake clock or explicit injected now function.
- Frontend status badges:
  - Vitest with fake timers required for polling and cleanup.
  - Accessibility assertions should check badge labels and nav links remain
    usable when status fetch fails.
