# Naver External Directions Link A Implementation Plan

Branch: feature/cycle-77-naver-external-directions-link-a
Cycle: 77
Created: 2026-06-28
Skills: frontend-react-pwa

## Summary

Cycle 77 promotes **Naver External Directions Link A** from
`docs/naver-directions-roadmap-cycles-77-79.md`.

Cycles 72-76 made location operational through provider-neutral geocoding,
Today location context, and travel-time evidence. This cycle does not add a new
provider, API key, route, cache, or embedded map. It adds deterministic
frontend-only external links that open Naver Map directly to a public-transit
directions page when Cairn already has resolved coordinates for an adjacent
event pair.

The key boundary is: Cairn may construct a best-effort Naver web URL from
already-known coordinates and labels, but it must not fetch Naver route data,
scrape directions, store transit results, or present the link target as a stable
provider contract. If a direct directions link cannot be made, existing location
search/map links remain available.

## Input/Output Spec

- Input:
  - Existing `GET /api/today?date&now&domain` response.
  - Existing `TodaySurface.locationContexts` from Cycle 75. Only `status:
    "resolved"` contexts with non-null `latitude`, `longitude`, and a usable
    display label/location text can produce direct transit directions links.
  - Existing `feasibility.transitionCosts` adjacent event pairs from Cycle 41/76.
  - Existing event detail geocode preview data from `POST /api/events/:id/geocode`
    for single-location map/search links.
- Normal output:
  - Add a small isolated Naver Map URL helper under `web/src/`.
  - The helper encodes WGS84 longitude/latitude into the observed Naver direction
    coordinate token format:
    - `token = base62(round((coordinate + 200) * 10_000_000))`
    - alphabet: `0-9a-zA-Z`
    - sample parity:
      - `127.0248712 -> 3zjD4Y`
      - `37.5045700 -> 2AJrSI`
      - `127.0339086 -> 3zk0AC`
      - `37.5073233 -> 2AJz2N`
  - When both adjacent events have resolved coordinates, render an external
    Naver public-transit directions action from the transition row:
    `https://map.naver.com/p/directions/{origin}/{destination}/-/transit?c=15.00,0,0,0,dh`
  - The origin/destination segments include coordinate tokens and an encoded
    label. The implementation may include placeholder place id/type fields
    because Cairn does not yet own Naver place ids; this must stay isolated in
    the helper so a later Naver place-search cycle can swap in real ids/types.
  - Single-location external map/search actions in Today/event detail use Naver
    Map search URLs rather than Google Maps search URLs.
  - All external links use `target="_blank"` and `rel="noopener noreferrer"`.
- Failure/absence behavior:
  - Missing, uncached, ambiguous, zero-results, failed, or coordinate-less
    locations do not render a direct directions link.
  - The UI must not call Naver, poll the generated URL, or treat link generation
    failure as a Today error.
  - Existing transition rows, travel evidence, energy/gap/sequence sections,
    event detail sheet behavior, and Today card actions remain usable.
  - No backend route, DB schema, migration, map gateway change, provider config,
    cache write, autocomplete, or route-result parser is introduced.

## Key Changes

- Frontend:
  - `web/src/naver-map-links.ts`
    - Add pure helpers for:
      - base62 Naver coordinate token encoding;
      - safe label encoding;
      - single-location Naver search URL generation;
      - best-effort public-transit directions URL generation for two resolved
        coordinate+label endpoints.
    - Reject non-finite/out-of-range coordinates by returning `null` instead of
      throwing inside render paths.
  - `web/src/naver-map-links.test.ts`
    - Cover the observed coordinate-token samples, URL escaping, missing label
      fallback, invalid coordinates, and full directions URL shape.
  - `web/src/Today.tsx`
    - Replace existing Google search link builders with Naver search helpers.
    - Pass `locationContexts` into the transition section.
    - Render one compact external action on a transition row only when both
      endpoints have resolved coordinates.
    - Keep the action low-noise and distinct from the existing travel-time copy;
      the link opens Naver for route details instead of making Cairn responsible
      for public-transit timing.
  - `web/src/Today.test.tsx`
    - Cover direct transit link rendered for a resolved adjacent pair.
    - Cover no direct link when either endpoint is missing/uncached/ambiguous or
      coordinate-less.
    - Cover event detail and Today location links using Naver URLs with safe
      external-link attributes.
    - Recheck existing travel evidence, transition, event detail, and Today card
      interactions remain intact.
  - `web/src/styles.css`
    - Add or reuse semantic-token-only styles for the compact link, preserving
      44px touch target expectations where it is a tap action.
- Docs:
  - `docs/naver-directions-roadmap-cycles-77-79.md`
    - Mark Cycle 77 promoted/active and keep later Naver place/search work as
      unpromoted candidates.
  - `docs/map-roadmap-cycles-72-76.md`
    - Mark the previous map roadmap complete.
  - `docs/codebase-map.md`
    - Update after implementation with the frontend-only Naver link helper and
      Today transition action boundary.

## Sprint Contract

- Passing criteria:
  - Naver URL construction is centralized in one pure frontend helper with unit
    tests for the observed coordinate-token formula.
  - Direct public-transit directions links render only from existing resolved
    `locationContexts` coordinates for both transition endpoints.
  - Single-location map/search links use Naver Map URLs and preserve external
    link safety attributes.
  - Missing/uncached/ambiguous/failed/coordinate-less locations omit the direct
    directions link without causing UI errors.
  - The implementation performs no Naver API/network request, no URL validation
    fetch, no scraping, no transit-result parsing, and no storage of route
    results.
  - No backend, shared API contract, DB schema, migration, map gateway, provider
    env/config, travel-time cache, or feasibility computation behavior changes.
  - Existing Today loading/quiet/live/error states, event detail geocode preview,
    transition travel copy, energy/gap/sequence sections, cards, and actions
    remain covered.
  - The UI copy does not promise that Naver's web route format is a stable API;
    it simply offers an external map/directions action.
  - `docs/codebase-map.md` reflects the new frontend helper after implementation.
- Automatic checks:
  - `corepack pnpm lint`
  - `corepack pnpm typecheck`
  - `corepack pnpm test`
  - `corepack pnpm test:integration`
  - `corepack pnpm build`
  - `corepack pnpm verify`
  - `git diff --check master...HEAD`
  - Static negative checks:
    - No backend/shared implementation scope:
      `git diff --name-only master...HEAD | rg '^(server|shared)/'`
      should have no matches except documentation/review files are outside this
      pattern.
    - No Naver API call or credential use:
      `git diff -U0 master...HEAD -- web | rg -n 'openapi\\.naver|ncloud|X-Naver|x-ncp|fetch\\(|apiJson\\('`
      should have no new Naver/network call matches.
    - No route-result parsing/storage:
      `git diff -U0 master...HEAD -- web docs | rg -n 'scrap|crawler|fare|tollFare|subwayLine|busRoute|arrival|route result|transit result|cache.*naver'`
      should have no implementation matches except explicit negative docs/tests.
    - No provider-key exposure:
      `git diff -U0 master...HEAD -- web docs | rg -n 'NAVER_.*SECRET|NAVER_.*CLIENT|MAP_PROVIDER_API_KEY|maps.googleapis.com'`
      should have no implementation matches.
- Test cases:
  - Helper encodes the user-provided sample coordinates to `3zjD4Y`, `2AJrSI`,
    `3zk0AC`, and `2AJz2N`.
  - Helper builds a `/p/directions/.../-/transit?c=15.00,0,0,0,dh` URL with
    encoded labels and deterministic segment order.
  - Helper returns `null` for NaN/Infinity/out-of-range coordinates.
  - Helper builds Naver search URLs for authored text and coordinate-backed
    labels without leaking provider keys.
  - Today transition row with two resolved location contexts renders an external
    Naver public-transit action.
  - Transition row omits the action when either endpoint is not resolved or has
    null coordinates.
  - Event detail geocode preview map action opens a Naver URL and still handles
    resolved/ambiguous/zero/failed/error states.
  - Existing Cycle 76 travel evidence tests still pass and the new link does not
    replace or reinterpret `travel.durationMinutes`.
- gas limit: N/A
- slither pass: N/A

## Missing Edge Case Candidates

- Naver's `/p/directions` route is an observed web route, not a documented API
  contract. Keep construction isolated and always fail soft by omitting the
  direct action when required inputs are missing.
- Cairn currently has Google/provider-neutral geocode ids, not Naver place ids.
  The helper must not pretend a Google place id is a Naver id; use coordinate
  tokens and labels only for this A cycle.
- Labels can contain Korean, commas, slashes, or whitespace. Segment generation
  must encode labels safely so generated URLs do not corrupt the path shape.

## Simpler Alternative

Only replace single-location map links with Naver search links and skip direct
directions. This is safer because search URLs are less coupled to Naver's web
router, but it misses the user's immediate need: opening Naver directly to
public-transit directions between adjacent locations. The adopted plan keeps
the direct link best-effort, isolated, tested against known coordinate samples,
and non-critical to Today.

## Assumptions

- The observed coordinate token formula is stable enough for a best-effort
  external link, but it is not treated as an official provider API.
- `TodaySurface.locationContexts` already contains enough resolved coordinates
  for many adjacent event pairs; this cycle does not force geocoding.
- Public-transit timing and "what to take" remain in Naver Map. Cairn does not
  ingest, cache, or reason over those route details in this cycle.
- Browser users can open `https://map.naver.com/` links directly; no installed
  native Naver Map app is required.

## Review Guidance

### Enumeration Needed

- Naver URL helper usage:
  - Search: `rg -n 'naver|map\\.naver|directions|transit' web/src docs .review/cycle-77`
  - Expected: implementation references are centralized in the helper and Today
    render/tests; docs/review may explain the boundary.
- Today transition path:
  - Search: `rg -n 'TransitionCostsSection|TransitionTravelLine|locationContexts|transitionCosts' web/src/Today.tsx web/src/Today.test.tsx`
  - Expected: direct directions links are additive and do not remove existing
    travel-time copy or transition rows.
- Existing location links:
  - Search: `rg -n 'mapSearchHref|locationMapHref|google\\.com/maps|map\\.naver' web/src`
  - Expected: Google search URL builders are replaced or isolated so user-facing
    map actions use Naver for this cycle.
- Scope boundary:
  - Search: `git diff --name-only master...HEAD`
  - Expected: production implementation files are limited to `web/src/*` plus
    docs/review. No `server/`, `shared/`, migration, or provider config changes.

### Verification Method Guide

- URL token correctness:
  - Unit tests are sufficient because the helper is pure deterministic string
    generation.
  - Manual browser smoke is optional and should not become a test dependency.
- Today rendering:
  - Frontend Vitest coverage is required for live transition rows, missing
    coordinate omission, and event detail link behavior.
  - Backend or SQLite integration tests are not required because this cycle only
    consumes existing `TodaySurface.locationContexts` payloads.
- Provider/network boundary:
  - Static negative checks are required. Mock tests alone are insufficient
    because the main risk is accidentally adding a Naver API call or credential
    path.
- Existing feasibility/travel behavior:
  - Existing frontend tests plus `pnpm verify` are required. The reviewer should
    confirm the new action does not change `travel` semantics or feasibility
    computation.
