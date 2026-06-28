# Event Map Preview A Implementation Plan

Branch: feature/cycle-74-event-map-preview-a
Cycle: 74
Created: 2026-06-28
Skills: frontend-react-pwa

## Summary

Cycle 74 promotes **Event Map Preview A** from
`docs/map-roadmap-cycles-72-76.md`.

Cycles 72-73 created the server-side map gateway and SQLite geocode cache. This
cycle uses that backend from the existing Today event-detail bottom sheet so a
user can see whether Cairn recognized an event's authored `location` text and
can open an external map action. It remains a frontend-only UX cycle: no new
map SDK, no browser provider key, no Today card priority change, no travel-time
logic, and no event creation autocomplete.

## Input/Output Spec

- Input:
  - Existing event detail data loaded by `GET /api/events/:id`.
  - Existing event field:
    - `event.location` is the authored location text.
    - Blank/null location does not call the geocoding endpoint.
  - Existing geocoding endpoint from Cycle 73:
    - `POST /api/events/:id/geocode`
    - no request body
    - no query parameters
    - response validated with the shared geocode response schema.
- Normal output:
  - When the event detail sheet opens and the loaded event has non-empty
    `location`, the frontend requests geocode data once for that selected event
    open by calling `POST /api/events/:id/geocode`.
  - The detail sheet renders a location preview section with four local states:
    - loading: shape-matched location preview skeleton/copy while geocoding is
      pending.
    - quiet: no event location text, no provider call, compact "no location"
      treatment that does not imply an error.
    - live:
      - `resolved`: display label, authored location, confidence/status chip,
        and an external map action using coordinates.
      - `ambiguous`: authored location, provider-neutral ambiguity copy, limited
        candidate labels when present, no fabricated selected coordinate, and an
        external map action using authored text.
      - `zero_results` / `failed`: authored location and honest unresolved copy
        with no fabricated coordinate; external map action uses authored text.
      - `hit|miss` cache status may be surfaced quietly as metadata but must not
        become a primary UX concern.
    - error: scoped provider/session/parse error copy with a retry action. The
      event detail sheet remains usable.
  - External map action opens a public map/search URL in a new tab/window using
    encoded coordinates or authored text. It never includes API keys, provider
    request URLs, raw provider payloads, or raw provider `error_message`.
- Failure behavior:
  - Event detail fetch failure continues to show the existing sheet error.
  - Geocode failure affects only the location preview section.
  - Access/session/network errors use the existing `apiJson` error
    classification style.
  - Invalid geocode response shape becomes a local preview error, not a crash.
  - Closing and reopening the sheet resets preview state for the selected event.
  - No Today card order, status action, notes, preparation suggestions, or
    schedule-brief behavior changes.

## Key Changes

- Frontend:
  - `web/src/Today.tsx`
    - Add a small event-geocode fetch helper using
      `EventGeocodeResponseSchema`.
    - Add local location-preview state alongside the event detail sheet state.
    - Trigger geocode only after event detail data is loaded and only for a
      non-empty `event.location`.
    - Render an event-detail location preview section before the schedule brief.
    - Add retry behavior that reuses the same selected event id and does not
      refetch Today or mutate the event.
  - `web/src/Today.test.tsx`
    - Extend the existing event detail sheet tests to cover loading, quiet,
      resolved, ambiguous, zero-result/failed, provider error, invalid response,
      retry, and no-body/no-query geocode request behavior.
  - `web/src/styles.css`
    - Add semantic-token-only styles for the preview section, chips, candidate
      list, skeleton/loading treatment, and 44px external/retry actions.
- Shared:
  - No new shared contract expected. Reuse `EventGeocodeResponseSchema` and
    related geocode types from `shared/src/maps.ts`.
- Backend:
  - No backend route, service, repository, schema, migration, or provider
    gateway changes expected.
- Docs:
  - `docs/map-roadmap-cycles-72-76.md`
    - Mark Cycle 73 merged and Cycle 74 promoted/active.
  - `docs/codebase-map.md`
    - Update after implementation to mention the event detail location preview
      UI and its dependency on the Cycle 73 route.

## Sprint Contract

- Passing criteria:
  - Event detail sheet shows a location preview only from the existing event
    detail context; Today cards and Today priority/order are unchanged.
  - Blank/null event location renders a quiet no-location state and performs no
    geocode POST.
  - Non-empty event location triggers exactly one no-body/no-query
    `POST /api/events/:id/geocode` per selected event open.
  - The geocode response is validated with `EventGeocodeResponseSchema`; invalid
    response shape becomes a local preview error.
  - Loading, quiet, live, and error states are all rendered and tested.
  - Resolved geocode results show coordinates-backed external map action.
  - Ambiguous, zero-result, and failed geocode results show no fabricated
    coordinate and preserve uncertainty/status honestly.
  - Provider/config/rate/session errors do not close or break the event detail
    sheet; retry is local to the preview section.
  - External map URL includes only encoded coordinates or authored location
    text; no API key, raw provider URL, raw payload, or provider `error_message`
    is exposed.
  - No embedded interactive map, browser provider SDK, provider API key, travel
    time, Today location cards, event creation autocomplete, backend migration,
    or backend route change is introduced.
  - Touch targets for map/retry actions are at least 44px; styles use semantic
    tokens and respect reduced-motion through the existing CSS motion rules.
  - `docs/codebase-map.md` reflects the new frontend UI boundary after
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
    - No backend persistence/provider changes:
      `git diff --name-only master...HEAD | rg '^(server/drizzle/|server/src/db/|server/src/maps/|server/src/repositories/geocode-cache|server/src/services/geocoding|server/src/routes/geocoding)'`
      should have no implementation matches.
    - No browser map SDK/key:
      `git diff -U0 master...HEAD -- web shared docs | rg -n 'MAP_PROVIDER_API_KEY|maps.googleapis.com.*key=|@googlemaps|mapbox|leaflet|naver|kakao|Maps JavaScript|rawProvider|raw_payload|error_message'`
      should have no implementation matches outside tests/docs proving absence.
    - No travel-time/Today-context scope:
      `git diff -U0 master...HEAD -- web server shared docs | rg -n 'travel_time|duration|distanceMeters|computeRouteMatrix|distanceMatrix|Today Location|autocomplete|cron|bulk geocod'`
      should have no implementation matches outside roadmap/plan text.
- Test cases:
  - Opening event detail with blank/null `location` shows quiet location state
    and does not call `/geocode`.
  - Opening event detail with non-empty `location` shows loading then live
    resolved preview.
  - Resolved preview renders display label, confidence/status, authored
    location, and external map action based on coordinates.
  - Ambiguous preview renders uncertainty/candidate labels and no coordinate
    copy/action based on fabricated selected point.
  - Zero-results and failed previews render honest unresolved states.
  - Provider error response renders a sheet-local location error and retry
    button; retry issues one more POST and can recover.
  - Access/session/network failure uses the existing access-session copy and
    keeps the event detail sheet open.
  - Invalid geocode response shape renders local error rather than throwing.
  - Geocode POST carries no body and no query string.
  - Existing detail sheet tests for status patch, annotation, preparations,
    schedule brief, people, and close behavior still pass.
- gas limit: N/A
- slither pass: N/A

## Missing Edge Case Candidates

- The geocode request can finish after the user closes the sheet or opens a
  different event. The implementation must avoid showing stale geocode data in
  the wrong sheet.
- A cached row can be ambiguous/failed and still include useful authored
  location text. The UI should not hide the location just because coordinates
  are unavailable.
- External map URL generation must handle whitespace, Hangul, punctuation, and
  coordinates without leaking raw provider request data.

## Simpler Alternative

Render only a static external map link from `event.location` without calling
`/api/events/:id/geocode`. This would be faster, but it would ignore the Cycle
73 cache/status/uncertainty work and would not let the user know whether Cairn
recognized the location, so this cycle should use the typed geocode route.

## Assumptions

- `POST /api/events/:id/geocode` is already merged, verified, and available to
  the PWA API base path.
- Event detail data includes `event.location` through the existing
  `EventRowSchema`.
- A public external map/search URL that contains only encoded coordinates or
  authored text is acceptable because it is not an embedded provider SDK and
  does not expose any browser API key.
- The first implementation can keep geocode preview state in `Today.tsx`; a
  separate reusable component may be extracted only if it reduces testable
  complexity.

## Review Guidance

### Enumeration Needed

- Event detail sheet open/render paths:
  - Search: `rg -n 'selectedEventId|eventDetail|fetchEventDetail|일정 상세|ScheduleBriefSection' web/src/Today.tsx web/src/Today.test.tsx`
  - Expected scope: existing Today event detail sheet only; no new primary route.
- Geocode frontend call sites:
  - Search: `rg -n '/geocode|EventGeocodeResponseSchema|fetchEventGeocode' web/src shared/src`
  - Expected: one frontend fetch helper/call path, plus tests/shared exports.
- Backend/provider boundary scope:
  - Search: `git diff --name-only master...HEAD | rg '^(server/drizzle/|server/src/db/|server/src/maps/|server/src/repositories/geocode-cache|server/src/services/geocoding|server/src/routes/geocoding)'`
  - Expected: no implementation changes in those paths.
- Frontend map SDK/key exposure:
  - Search: `git diff -U0 master...HEAD -- web shared docs | rg -n 'MAP_PROVIDER_API_KEY|maps.googleapis.com.*key=|@googlemaps|mapbox|leaflet|naver|kakao|Maps JavaScript|rawProvider|raw_payload|error_message'`
  - Expected: no SDK/key/raw provider exposure. Public external URL helper may
    appear only without API keys and with encoded user-facing query data.

### Verification Method Guide

- Four UI states:
  - Unit/component tests in `web/src/Today.test.tsx` are required. Manual visual
    inspection is helpful but insufficient by itself.
- No stale geocode on sheet close/switch:
  - Unit test should simulate close/switch or guard via selected event id before
    state update. Mock-only test is sufficient because this is frontend state
    isolation.
- No geocode POST for blank location:
  - Unit test with fetch mock is sufficient; assert no `/geocode` call.
- No backend/provider changes:
  - Git diff enumeration is required. Backend tests should still run through
    `pnpm verify`, but no new backend integration test is expected.
- External URL safety:
  - Unit test the rendered link href for encoded coordinates/location and static
    negative grep for keys/raw provider fields. No browser/provider integration
    test is required.
