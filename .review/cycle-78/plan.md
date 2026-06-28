# Pinned Transit Facts A Implementation Plan

Branch: feature/cycle-78-pinned-transit-facts-a
Cycle: 78
Created: 2026-06-28
Skills: backend-fastify, frontend-react-pwa

## Summary

Cycle 78 promotes **Pinned Transit Facts A** after Cycle 77 made Naver public
transit directions available as an external link.

The user need is feasibility, not map display: most relevant origin/destination
pairs are stable, so Cairn should let the user pin a known public-transit
duration for a recurring pair and then use that deterministic user-authored fact
in day feasibility. This avoids scraping Naver, parsing public-transit routes,
or depending on a provider for live route details.

The core boundary is: pinned transit facts are manual/user-authored facts for a
normalized adjacent location pair. They may contribute to the same gap math that
Cycle 76 uses for fresh travel evidence, but they must be provenance-labeled and
must not masquerade as provider-fetched live data.

## Input/Output Spec

- Input:
  - Existing scheduled event pairs from `GET /api/today`,
    `GET /api/feasibility/day`, and `POST /api/feasibility/day/preview`.
  - Existing event `location` text and resolved `geocode_cache` rows. This cycle
    must not call geocoding providers to create pinned facts.
  - User-entered duration minutes for a specific adjacent event pair, submitted
    from Today transition UI.
  - Optional user note, kept short and displayed as manual context only.
- Normal output:
  - New SQLite table `pinned_transit_facts` with additive migration only.
  - A fact stores:
    - provider-neutral pair identity for origin/destination locations;
    - origin/destination display labels and coordinates for audit/display;
    - `mode='public_transit'`;
    - `duration_minutes`;
    - optional note;
    - source/provenance fixed to user-authored/manual;
    - active flag and created/updated/last_confirmed timestamps.
  - A server route lets the user upsert a pinned public-transit fact for a pair
    of existing event ids:
    - Proposed: `PUT /api/transit-facts/pair`
    - Body: `{ fromEventId, toEventId, durationMinutes, note? }`
    - The server derives location pair keys from existing DB event/geocode data;
      the browser does not submit arbitrary coordinates.
  - The route returns a typed shared response containing the pinned fact.
  - Day travel building checks pinned transit facts before provider travel-time
    cache/provider calls for the same adjacent pair.
  - If a pinned fact matches, `TransitionTravel` is populated as a usable fact
    with:
    - `status: "fresh"` because it is usable for gap math;
    - `durationMinutes`;
    - `provider: null`;
    - `source: "pinned_user"` as the provenance marker;
    - reason codes including `travel_pinned_transit`.
  - Feasibility gap required minutes include pinned transit duration using the
    existing `travelMargin`, with a distinct reason code such as
    `gap_travel_pinned_included`.
  - Today transition rows show compact copy such as `고정 이동 약 12분` and allow
    adding/updating the pinned duration.
- Failure behavior:
  - Unknown event id -> 404.
  - Blank/missing event location -> 409 `LOCATION_MISSING`.
  - No resolved geocode cache row for either endpoint -> 409
    `LOCATION_UNRESOLVED`; no provider/geocode call is made.
  - Invalid duration, invalid event ids, or note too long -> 400
    `VALIDATION_ERROR`.
  - If no pinned fact exists for a pair, current Cycle 76 travel behavior
    remains unchanged.
  - Preview endpoints remain read-only: they may read pinned facts but must not
    create/update them.
  - No automatic schedule mutation, recommendation application, route scraping,
    or provider-dependent hard block is introduced.

## Key Changes

- Shared:
  - `shared/src/transitFacts.ts`
    - Add strict runtime schemas and types for pinned transit fact data,
      upsert request, success response, and stable route errors.
  - `shared/src/feasibility.ts`
    - Extend `TransitionTravelSchema` with optional `source` (`provider` |
      `pinned_user`) to distinguish provider facts from pinned user facts without
      breaking existing payloads.
    - Add/allow reason code values via ordinary string arrays; no enum churn
      unless the existing schema requires it.
  - Tests:
    - Accept pinned/user-authored travel evidence and reject raw provider route
      payloads, Naver route steps, or injected recommendation/action fields.
- Backend:
  - `server/src/db/schema.ts` and generated migration:
    - Add `pinned_transit_facts` with lowercase enum/check values.
    - Unique key `(mode, origin_key, dest_key)` prevents duplicates for the same
      directed pair. `origin_key`/`dest_key` come from the same normalized
      resolved location identity used by the travel/geocode path; coordinates
      are stored for audit/display, not as browser-provided truth.
    - Add CHECK constraints for active flag, duration range, coordinate pairs,
      and mode/source values.
  - `server/src/repositories/pinned-transit-facts.ts`
    - Add read-by-pair-key, upsert, and list helpers.
    - Use real SQLite constraints; no provider calls.
  - `server/src/services/pinned-transit-facts.ts`
    - Resolve two event ids to existing event rows and resolved geocode cache
      rows.
    - Build deterministic pair keys.
    - Validate that both endpoints are resolved; fail with typed domain errors
      otherwise.
    - Upsert one user-authored fact and return the shaped response.
  - `server/src/services/travel-time.ts`
    - Before provider/cache travel fallback, check pinned transit facts for the
      adjacent pair. A match yields pinned travel evidence and prevents provider
      travel calls for that pair.
    - Keep missing geocode/same-location handling honest and unchanged.
  - `server/src/routes/transit-facts.ts`
    - Register DB-backed routes only when DB exists.
    - Validate params/body with shared schemas; handlers stay thin.
  - `server/src/routes/feasibility.ts` and `server/src/routes/today.ts`
    - Ensure pinned facts are read for day pairs and passed into the existing
      route-level travel builder.
    - Preview reads pinned facts but does not write them.
  - Tests:
    - Temporary-SQLite repository/service/route integration tests for insert,
      update, duplicate upsert, missing location, unresolved geocode, validation,
      and preview read-only behavior.
- Frontend:
  - `web/src/Today.tsx`
    - Add a compact "고정 이동시간" action on transition rows that already expose
      adjacent event ids.
    - The action opens a small inline form or sheet with duration minutes and
      optional note; submit calls `PUT /api/transit-facts/pair`.
    - On success, refresh Today so feasibility/gap math reflects the pinned
      duration from the server response.
    - Render pinned travel evidence distinctly from provider estimate copy.
    - Preserve Cycle 77 Naver directions link as an external check action.
  - `web/src/api` usage stays page-level; reusable visual pieces remain
    data-in/callbacks-out if extracted.
  - `web/src/styles.css`
    - Semantic-token-only compact styles; 44px tap targets; reduced-motion safe.
  - Tests:
    - Cover form open/submit/success refresh, validation error, unresolved
      location conflict, pinned evidence copy, and preservation of existing
      transition/travel/Naver link behavior.
- Docs:
  - `docs/naver-directions-roadmap-cycles-77-79.md`
    - Mark Cycle 77 merged and Cycle 78 promoted/active as Pinned Transit Facts
      A. Shift Naver Place Search to a later candidate.
  - `docs/codebase-map.md`
    - Update after implementation with the new table, route, service, travel
      precedence, and Today UI action.

## Sprint Contract

- Passing criteria:
  - `pinned_transit_facts` exists with additive migration only; no existing table
    rebuild/alter beyond the new table/index.
  - Pinned transit facts are user-authored/manual and provenance-labeled in API
    responses/UI; they are never presented as live provider data.
  - The upsert route derives pair identity from existing DB events and resolved
    geocode cache rows. Browser input cannot provide arbitrary coordinates.
  - Missing event, missing location, unresolved geocode, invalid duration, and
    too-long note fail with typed errors and no DB write.
  - Day feasibility and Today use pinned transit facts before provider travel
    cache/provider calls for matching pairs.
  - A pinned fact contributes to gap required minutes using `travelMargin`, with
    a distinct reason code; absent pinned facts keep Cycle 76 behavior unchanged.
  - Preview endpoints read pinned facts but remain write-free.
  - No Naver API call, route scraping, route-step parsing, fare/arrival parsing,
    external provider credential, cron job, bulk enrichment, or automatic
    rescheduling is introduced.
  - Existing deterministic thread transition cost and sequence energy semantics
    remain valid; travel is still additive and not double-counted as context
    transition load.
  - Today UI offers add/update pinned duration without breaking existing
    loading/quiet/live/error states, event detail, Naver directions links, or
    transition travel copy.
  - `docs/codebase-map.md` reflects the new pinned transit table/route/service
    boundary after implementation.
- Automatic checks:
  - `corepack pnpm db:generate`
  - `corepack pnpm lint`
  - `corepack pnpm typecheck`
  - `corepack pnpm test`
  - `corepack pnpm test:integration`
  - `corepack pnpm build`
  - `corepack pnpm verify`
  - `git diff --check master...HEAD`
  - Migration/schema checks:
    - Generated migration creates `pinned_transit_facts` and index/checks only.
    - Existing applied migrations are not edited.
    - Temporary SQLite tests validate unique/check constraints.
  - Static negative checks:
    - No Naver API/scraping/provider credential path:
      `git diff -U0 master...HEAD -- server shared web docs | rg -n 'openapi\\.naver|ncloud|X-Naver|x-ncp|scrap|crawler|cheerio|jsdom|fare|arrival|subwayLine|busRoute|route step|transit result|NAVER_.*SECRET|NAVER_.*CLIENT'`
      should have no implementation matches except negative tests/docs.
    - No automatic schedule mutation:
      `git diff -U0 master...HEAD -- server shared web | rg -n 'auto.?resched|PATCH /api/events/.*/schedule|schedule automatically|apply.*schedule|cron|bulk'`
      should have no Cycle 78 implementation matches except tests/docs that
      assert absence.
    - Pinned route does not accept browser coordinates:
      `git diff -U0 master...HEAD -- server shared web | rg -n 'fromLat|fromLng|toLat|toLng|originLat|originLng|destLat|destLng'`
      should show no request-body schema fields accepting coordinates.
    - No LLM path:
      `git diff -U0 master...HEAD -- server/src shared/src web/src | rg -n 'llm|chat/completions|Grok|prompt'`
      should have no pinned transit implementation matches.
- Test cases:
  - Shared schemas accept valid upsert request and pinned fact response; reject
    extra `recommendation`, route-step, provider raw payload, and coordinate
    input fields.
  - Repository inserts and idempotently updates one fact per pair/mode using a
    real temporary SQLite DB.
  - Repository rejects invalid duration, invalid active flag, invalid mode/source,
    and duplicate key violations when bypassing the upsert helper.
  - Upsert route returns 404 for unknown events, 409 for blank location, 409 for
    unresolved geocode, and writes no row on each failure.
  - Upsert route success returns the pinned fact and subsequent upsert updates
    duration/note/last_confirmed_at without creating a duplicate.
  - Travel builder prefers pinned fact over provider/cache travel and does not
    call `mapGateway.travelTime` for that pair.
  - Absent pinned fact preserves existing Cycle 76 cache/provider/fail-open
    behavior.
  - `GET /api/feasibility/day` and `GET /api/today` include pinned travel
    evidence for adjacent pairs and gap reason includes pinned travel.
  - `POST /api/feasibility/day/preview` includes pinned facts but performs zero
    pinned-fact writes and no provider calls unless Cycle 76 cache-read policy
    already allows reads.
  - Frontend shows pinned travel copy, opens/submits the duration form, refreshes
    Today on success, and shows scoped errors without closing/breaking Today.
  - Existing Cycle 77 Naver transit link still renders for resolved pairs and is
    not confused with the pinned duration.
- gas limit: N/A
- slither pass: N/A

## Missing Edge Case Candidates

- Directionality matters. `A -> B` and `B -> A` may have different public-transit
  duration. The table key must preserve direction and tests must prove reverse
  pairs do not collide.
- Same-location pairs should not need pinned transit facts. The travel builder
  should keep Cycle 76 `same_location` behavior unless a deliberate product
  reason is introduced later.
- Location text can change after a fact is pinned. Cycle 78 should key facts to
  normalized resolved location pair at creation time and only match when the
  current adjacent pair resolves to the same pair identity; it must not silently
  apply an old fact to unrelated new text.

## Simpler Alternative

Use Cycle 76 `travel_time_cache` and insert manual rows into it. This is simpler
structurally but blurs provider facts with user-authored facts and makes it hard
to explain provenance in the UI. The adopted plan creates a small separate table
so "known because user pinned it" remains distinct from "known because a
provider returned it."

## Assumptions

- Cycle 73 resolved geocode cache rows are available for the recurring places
  the user wants to pin. This cycle does not force geocoding.
- Most useful transit pairs are stable and directional, so exact pair matching is
  enough for the A version.
- Pinned public-transit duration should affect gap feasibility the same way a
  fresh provider travel fact does, but should be labeled manual/pinned.
- Cycle 77 Naver link remains the confirmation/update escape hatch.

## Review Guidance

### Enumeration Needed

- Travel fact precedence path:
  - Search: `rg -n 'buildDayTravelFacts|travel_time_cache|TransitionTravel|gap_travel|mapGateway\\.travelTime' server/src shared/src web/src`
  - Expected: pinned facts are checked before provider/cache travel calls and
    travel remains additive to transition costs.
- Persistence boundary:
  - Search: `rg -n 'pinned_transit_facts|PinnedTransit|transit-facts|manual|user' server/src shared/src server/drizzle`
  - Expected: new table/repository/service/route only; no existing table rebuild
    or migration edits.
- Route write boundary:
  - Search: `rg -n 'PUT /api/transit-facts|transit-facts|fromEventId|toEventId|durationMinutes' server/src shared/src web/src`
  - Expected: route request takes event ids + duration/note only; server derives
    pair identity and coordinates.
- UI boundary:
  - Search: `rg -n 'Pinned|고정|transit fact|naverTransitDirections|TransitionTravelLine|TransitionCostsSection' web/src`
  - Expected: pinned duration UI is additive and does not remove Naver external
    link or provider travel copy.

### Verification Method Guide

- SQLite constraints and upsert behavior:
  - Temporary SQLite integration tests are required. Unit tests are insufficient
    because CHECK/unique constraints and migration shape matter.
- Pair identity and no browser coordinates:
  - Route integration tests must prove the server derives location facts from DB
    event/geocode rows and that request schemas reject coordinate fields.
- Feasibility math:
  - Service/unit tests plus route integration are required. The route test proves
    real day surfaces include pinned evidence; the service test proves the pure
    gap math only changes for usable travel.
- Frontend behavior:
  - Vitest coverage is required for form state, success refresh, scoped failure,
    and coexistence with Cycle 77 Naver links.
- Negative provider boundary:
  - Static checks are required for no Naver API/scraping/LLM/provider credential
    path. Mock tests alone would not prove absence.
