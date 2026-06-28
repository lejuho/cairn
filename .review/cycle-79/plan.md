# Naver Place Search A Implementation Plan

Branch: feature/cycle-79-naver-place-search-a
Cycle: 79
Created: 2026-06-28
Skills: backend-fastify, frontend-react-pwa

## Summary

Cycle 79 promotes **Naver Place Search A** from
`docs/naver-directions-roadmap-cycles-77-79.md`.

Cycle 77 added best-effort Naver public-transit links, and Cycle 78 added
user-pinned transit facts for stable recurring pairs. This cycle improves the
front door to that flow: when an event has a rough authored location, Cairn can
ask a server-side Naver local search boundary for a small set of place
candidates and let the user explicitly choose better event location text or
open the candidate in Naver Map.

The key boundary is: this is place candidate search, not geocode replacement.
Naver Search credentials stay server-side, candidates are sanitized, and no
candidate coordinate is written into `geocode_cache`, pinned transit facts, or
feasibility. Any event location mutation requires an explicit user tap.

## Input/Output Spec

- Input:
  - Existing event detail sheet/location preview in Today.
  - Existing event `location` text as the search query. The frontend must not
    send a hidden query unrelated to the visible event location.
  - Server environment for Naver Search OpenAPI:
    - `NAVER_SEARCH_CLIENT_ID`
    - `NAVER_SEARCH_CLIENT_SECRET`
  - Naver local search REST endpoint:
    - `GET https://openapi.naver.com/v1/search/local.json`
    - Headers: `X-Naver-Client-Id`, `X-Naver-Client-Secret`
    - Query: `query`, `display` capped to 5, `start=1`, `sort=random`
- Normal output:
  - Add a server-side Naver place-search config/gateway boundary.
  - Add a focused read route:
    - Proposed: `GET /api/places/naver?query=<text>`
    - No DB required and no DB write.
    - Disabled/unconfigured credentials return a typed disabled/unavailable
      response, not a server crash.
  - Return at most 5 sanitized candidates:
    - `title` with Naver highlight HTML stripped/decoded.
    - `category` sanitized to plain text.
    - `address` and `roadAddress`.
    - `description` only if sanitized and useful; otherwise omit/null.
    - `naverUrl`: provider link when safe, otherwise a Naver Map search URL
      built from title + road/jibun address.
    - `locationText`: the exact text Cairn would save if the user chooses the
      candidate, e.g. `title + " · " + (roadAddress || address)`.
  - The response intentionally does not expose provider raw payloads, raw HTML,
    API keys, request URLs with credentials, or raw provider error messages.
  - The response intentionally does not expose or trust `mapx/mapy` as WGS84
    coordinates in this A cycle. Candidate coordinates are out of scope until a
    later cycle verifies the provider coordinate semantics and conversion.
  - Event detail UI can:
    - request candidates for the visible event location;
    - show loading/quiet/live/error states inside the sheet;
    - open a candidate in Naver Map;
    - explicitly save a candidate's `locationText` to the event using the
      existing event location edit route.
  - After a successful explicit save, refresh event detail/Today and rerun the
    existing geocode preview path for the updated authored location.
- Failure behavior:
  - Blank/too-short query -> 400 `VALIDATION_ERROR` or frontend quiet state with
    no request.
  - Missing credentials -> 200/503 typed disabled/unavailable shape, no provider
    fetch.
  - Naver 401/403 -> typed `denied`; 429 -> `rate_limited`; timeout/5xx ->
    `unavailable`; invalid provider JSON -> `invalid_response`.
  - Search failures do not fail event detail, Today, geocode preview,
    feasibility, pinned transit facts, or Naver directions links.
  - Candidate selection updates only `events.location` via existing explicit
    event edit semantics. It must not update start/end/status/thread/source,
    write geocode cache, create pinned transit facts, or schedule anything.

## Key Changes

- Shared:
  - `shared/src/placeSearch.ts`
    - Add strict schemas/types for:
      - Naver place-search query.
      - Sanitized place candidate.
      - Success/error response.
      - Stable error codes (`disabled`, `denied`, `rate_limited`,
        `unavailable`, `invalid_response`, `validation_error`).
    - Reject injected raw fields such as `raw`, `items`, `mapx`, `mapy`,
      `clientSecret`, `errorMessage`, `score`, `recommendation`, and `autoApply`.
  - Tests:
    - Schema acceptance/rejection for candidates and errors.
- Backend:
  - `server/src/naver/place-search-config.ts`
    - Read env and produce `{provider:"naver", configured:true}` or disabled.
    - Keep missing/blank credential handling explicit and fail-soft.
  - `server/src/naver/place-search-gateway.ts`
    - Server-only fetch to Naver local search.
    - Bounded timeout and small retry policy only for transient unavailable
      errors, if consistent with existing gateway style.
    - Map provider errors into stable codes with static messages.
    - Sanitize candidate fields:
      - strip Naver highlight tags from `title`;
      - decode common HTML entities;
      - trim/collapse whitespace;
      - validate external URLs as `http`/`https`;
      - build `naverUrl` fallback from sanitized title/address.
    - Do not expose raw `mapx/mapy` or raw provider HTML/payload.
  - `server/src/routes/place-search.ts`
    - Register `GET /api/places/naver`.
    - Validate query with shared schema.
    - Handler remains thin: validate -> gateway -> typed reply.
    - Route may register without DB; it does not mutate state.
  - `server/src/app.ts` / `server/src/index.ts`
    - Wire optional Naver place-search gateway/config analogously to other
      external boundaries, without requiring SQLite.
  - Tests:
    - Gateway unit tests for disabled, success, sanitization, safe URL fallback,
      denied/rate-limited/unavailable/invalid-response.
    - Route tests for validation, disabled, success, and no DB requirement.
- Frontend:
  - `web/src/Today.tsx`
    - In event detail location section, add a compact "네이버 후보" action when
      the event has nonblank location text.
    - Fetch `GET /api/places/naver?query=<visible event location>`.
    - Render sheet-local loading/quiet/live/error states.
    - Candidate rows show title/category/address, external Naver link, and an
      explicit "이 위치로 저장" action.
    - Saving uses the existing event location edit endpoint and then refreshes
      detail/Today. It must not silently save on search result click.
    - Keep existing geocode preview, Naver directions link, pinned transit form,
      Today cards, and feasibility sections intact.
  - `web/src/styles.css`
    - Add semantic-token-only compact candidate styles; 44px tap targets;
      reduced-motion safe.
  - Tests:
    - Candidate action hidden for blank location.
    - Fetch loading/live/quiet/error states.
    - External Naver link has safe attributes.
    - Explicit save patches only `location`, refreshes, and does not auto-save
      merely from opening candidates.
    - Search failure stays scoped to event detail.
- Docs:
  - `docs/naver-directions-roadmap-cycles-77-79.md`
    - Mark Cycle 78 merged and Cycle 79 promoted/active.
  - `docs/codebase-map.md`
    - Update after implementation with the Naver place-search gateway/route and
      event-detail candidate UI boundary.

## Sprint Contract

- Passing criteria:
  - Naver Search credentials are read server-side only; no browser secret,
    provider key, or direct browser call is added.
  - `GET /api/places/naver` validates input, returns typed sanitized candidates,
    and requires no DB.
  - Provider raw payloads, raw HTML highlights, raw provider error messages,
    request URLs containing credentials, and `mapx/mapy` coordinates are not
    exposed to shared/frontend payloads.
  - Candidate selection is explicit and mutates only `events.location` through
    existing event edit semantics.
  - Candidate search failures are scoped; Today/event detail/geocode preview/
    feasibility/pinned transit remain usable.
  - No geocode cache writes, pinned transit fact writes, feasibility math
    changes, travel provider calls, route scraping, autocomplete cron, or bulk
    enrichment is introduced.
  - Existing Cycle 77 Naver directions links and Cycle 78 pinned transit facts
    remain covered and unchanged.
  - `docs/codebase-map.md` reflects the new external provider boundary after
    implementation.
- Automatic checks:
  - `corepack pnpm lint`
  - `corepack pnpm typecheck`
  - `corepack pnpm test`
  - `corepack pnpm test:integration`
  - `corepack pnpm build`
  - `corepack pnpm verify`
  - `git diff --check master...HEAD`
  - Static negative checks:
    - No browser Naver API/credential use:
      `git diff -U0 master...HEAD -- web shared | rg -n 'openapi\\.naver|X-Naver|NAVER_SEARCH|CLIENT_SECRET|clientSecret|x-ncp|ncloud'`
      should have no frontend/shared implementation matches except schema
      rejection tests/docs.
    - No coordinate/geocode replacement:
      `git diff -U0 master...HEAD -- server shared web | rg -n 'mapx|mapy|latitude|longitude|geocode_cache|pinned_transit_facts'`
      should show no Naver candidate coordinates being exposed or written; any
      references must be existing tests/docs or explicit negative assertions.
    - No route scraping/parsing:
      `git diff -U0 master...HEAD -- server shared web docs | rg -n 'scrap|crawler|cheerio|jsdom|fare|arrival|subwayLine|busRoute|route step|transit result'`
      should have no implementation matches except negative docs/tests.
    - No hidden auto-apply:
      `git diff -U0 master...HEAD -- server shared web | rg -n 'autoApply|recommendation|score|schedule automatically|bulk|cron'`
      should have no implementation matches except schema rejection/negative
      docs.
    - No LLM path:
      `git diff -U0 master...HEAD -- server/src shared/src web/src | rg -n 'llm|chat/completions|Grok|prompt'`
      should have no place-search implementation matches.
- Test cases:
  - Shared schemas accept sanitized candidates and reject raw provider fields,
    coordinates, raw HTML, score/recommendation/autoApply, and secret fields.
  - Gateway disabled mode returns a typed disabled/unavailable shape with no
    fetch.
  - Gateway success strips `<b>` highlights, decodes entities, collapses
    whitespace, validates URLs, builds fallback Naver search URLs, caps candidates
    to 5, and omits raw `mapx/mapy`.
  - Gateway maps 401/403/429/5xx/timeout/bad JSON to stable static errors
    without leaking Naver raw `errorMessage`.
  - Route validation rejects blank/too-short/too-long query and never needs DB.
  - Event detail candidate UI renders loading, quiet, live, and error states.
  - Candidate external link opens in a new tab with `noopener noreferrer`.
  - Candidate save explicitly patches only `location` and refreshes detail/Today.
  - Search result display/opening does not mutate event location.
  - Existing geocode preview, Naver directions, pinned transit, transition
    travel, and Today card tests still pass.
- gas limit: N/A
- slither pass: N/A

## Missing Edge Case Candidates

- Naver local search titles can contain HTML highlight tags and entities. The
  server must sanitize before shared/frontend validation, and tests must prove
  raw tags do not leak.
- Provider coordinates from Naver local search are not yet trusted as WGS84
  event coordinates. This cycle must not write them into geocode or feasibility
  paths.
- Candidate links can be blank or unsafe. The gateway must validate provider
  links and use a Naver search fallback when needed.

## Simpler Alternative

Only add a Naver search URL button for the current authored location and skip
server-side local search. This is safer and almost free, but it does not solve
the user's "automatic candidate/place link" need. The adopted plan adds a small
server-side boundary, keeps credentials private, and still avoids coordinate or
route-result ingestion.

## Assumptions

- Naver Search local API is suitable for a small candidate list, but it is not a
  geocoding source for this cycle.
- Event location selection should improve authored text first; existing geocode
  preview can then resolve that text through the current provider-neutral
  geocode path.
- Single-user local deployment does not need multi-user quota accounting, but
  provider failures must remain scoped and explicit.
- The candidate route can register without DB because it is a provider boundary,
  not persistence.

## Review Guidance

### Enumeration Needed

- External provider boundary:
  - Search: `rg -n 'place-search|Naver|NAVER_SEARCH|openapi\\.naver|X-Naver' server/src shared/src web/src`
  - Expected: provider call and credentials stay in server-side gateway/config;
    frontend only calls Cairn API.
- Candidate payload:
  - Search: `rg -n 'mapx|mapy|raw|errorMessage|clientSecret|score|recommendation|autoApply' shared/src server/src web/src`
  - Expected: schemas/tests reject raw/injected fields; candidate response does
    not expose coordinates or raw provider data.
- Event location mutation:
  - Search: `rg -n 'thread-node|location|이 위치로 저장|places/naver|PATCH' web/src/Today.tsx web/src/Today.test.tsx server/src/routes`
  - Expected: save is explicit and updates only event location via existing
    route semantics.
- Scope boundary:
  - Search: `git diff --name-only master...HEAD`
  - Expected: no migrations or DB schema changes; no `travel_time_cache`,
    `pinned_transit_facts`, feasibility math, or route scraping implementation
    changes.

### Verification Method Guide

- Gateway and sanitization:
  - Unit tests are required with mocked fetch. Static review alone is
    insufficient because HTML/entity sanitization is easy to miss.
- Route registration/no DB:
  - App injection tests are required to prove the route works without SQLite.
- Frontend UI:
  - Vitest coverage is required for four states, safe external link attributes,
    explicit save, and no hidden mutation.
- Provider secrecy:
  - Static negative checks are required. Mock tests do not prove secrets are not
    exposed to frontend/shared code.
- Coordinate boundary:
  - Static negative checks plus schema tests are required because accidental
    `mapx/mapy` exposure would silently blur place search with geocoding.
