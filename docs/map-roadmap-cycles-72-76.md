# Map API Roadmap: Cycles 72-76

Status: Cycle 76 promoted and active; Cycles 72-75 merged
Created: 2026-06-28

This document concatenates the intended map/location integration roadmap for
cycles 72-76. It is separate from the Composer roadmap because map work crosses
backend integration, persistence, frontend location UX, Today context, and
event-to-event travel-time logic.

## Product Direction

Cairn already has event locations as authored text, but location is not yet a
first-class operational signal. Map integration should make location useful
without making the app dependent on a third-party map provider for core Today
behavior.

The roadmap keeps these boundaries:

- API keys and provider calls stay server-side.
- SQLite remains the source of truth and cache boundary.
- Unknown, ambiguous, or failed geocoding stays visible as uncertainty.
- Existing event creation, Today queue order, and feasibility remain usable when
  the map provider is down.
- Frontend map UI is progressive: first links/previews, then Today context, then
  travel-time-aware reasoning.

Provider choice is intentionally deferred to Cycle 72 promotion. Candidate
providers can include Google Maps, Mapbox, Naver, Kakao, or another provider,
but the implementation should hide provider-specific details behind a small
server-side gateway contract.

## Cycle 72: Map Provider Boundary A

Branch when promoted: `feature/cycle-72-map-provider-boundary-a`
Skills when promoted: `backend-fastify`
Status: promoted + implemented + merged 2026-06-28 (`.review/cycle-72/`)
Selected initial provider: Google Maps Platform (server-side Geocoding behind the
`server/src/maps/` gateway; default `MAP_PROVIDER=disabled`). Diagnostic-only
`GET /api/maps/provider-smoke`; no DB/cache/UI/travel-time. Cycles 73-76 stay roadmap.

### Goal

Create the server-side map provider boundary without changing user-facing
screens or persistence.

### Scope

- Choose and document the initial map provider.
- Add env/config parsing for provider base URL, API key, timeout, and disabled
  mode.
- Add one provider gateway module owned by `server`.
- Define bounded timeout, error mapping, and no-secret logging rules.
- Add a minimal diagnostic/smoke route or internal test seam that proves the
  gateway can be called in mock/disabled mode.

Out of scope:

- DB schema or migrations.
- Event geocoding cache.
- Frontend map UI.
- Today or feasibility changes.
- Client-side provider SDKs or exposed browser API keys.

### Expected Behavior

When configured, the server can call the map provider through one gateway. When
not configured or unavailable, map-dependent calls fail gracefully with a typed
error and no fabricated location data. Existing Cairn routes behave unchanged.

## Cycle 73: Geocoding Cache A

Branch when promoted: `feature/cycle-73-geocoding-cache-a`
Skills when promoted: `backend-fastify`
Status: promoted + implemented + merged 2026-06-28 (`.review/cycle-73/`). SQLite
`geocode_cache` table keyed by (provider, normalized_location); `POST
/api/events/:id/geocode` resolves/reuses an event's authored `location` via the
cycle-72 gateway's new `geocodeAddress`, preserving ambiguous/zero/failed
uncertainty. No frontend/Today/travel-time. Cycles 74-76 stay roadmap.

### Goal

Turn authored event location text into cached, provenance-preserving geocode
data.

### Scope

- Add a SQLite-backed geocode cache keyed by normalized location text and
  provider identity.
- Store latitude, longitude, display label, provider result id when available,
  confidence/status, timestamps, and raw uncertainty state.
- Add server route/service for geocoding event locations on demand.
- Preserve ambiguous/failed/unknown results instead of pretending coordinates
  exist.
- Add integration tests with a temporary SQLite database and mocked provider.

Out of scope:

- Map rendering in the frontend.
- Travel-time/directions calls.
- Automatic bulk geocoding cron.
- Rewriting existing event location fields.

### Expected Behavior

Given an event with a non-empty `location`, the server can resolve or reuse a
cached geocode result. Provider failures return a scoped map/geocode error while
the event itself remains readable and editable.

## Cycle 74: Event Map Preview A

Branch when promoted: `feature/cycle-74-event-map-preview-a`
Skills when promoted: `frontend-react-pwa`
Status: promoted + implemented + merged 2026-06-28 (`.review/cycle-74/`). The Today event
detail sheet now calls the cycle-73 `POST /api/events/:id/geocode` once per open
(non-empty location only) and renders loading/quiet/live(resolved|ambiguous|
zero_results|failed)/error states with a public external map link (encoded
coordinates or authored text — no key/SDK). Frontend-only; no Today card,
travel-time, or backend change. Cycles 75-76 stay roadmap.

### Goal

Show useful location feedback in event detail without changing Today logic.

### Scope

- Event detail sheet/page fetches geocode status for events with location text.
- Render loading, resolved, ambiguous/unknown, and error states.
- Provide an external map action using the resolved coordinates or authored
  location text.
- Keep the UI mobile-first and semantic-token based.
- Add frontend tests for all map preview states.

Out of scope:

- Embedded interactive map if it requires a browser-exposed provider key.
- Today cards.
- Travel time.
- Event creation autocomplete.

### Expected Behavior

Users can open an event detail and understand whether Cairn recognized the
location. A successful result offers a clear map action; an unresolved result
keeps the authored location visible and honest.

## Cycle 75: Today Location Context A

Branch when promoted: `feature/cycle-75-today-location-context-a`
Skills when promoted: `frontend-react-pwa, backend-fastify`
Status: promoted + implemented + merged 2026-06-28 (`.review/cycle-75/`). `GET /api/today`
now attaches a cache-only `locationContexts` array (read from the cycle-73
`geocode_cache`, never a provider/geocode call) keyed by event id, with
missing/uncached/resolved/ambiguous/zero_results/failed status. Today cards
(next_event, needs_review, schedule_prompt, both conflict pair events) render a
compact location chip + an external map link (coordinates for resolved, authored
text otherwise; uncached shows no link). Card order/priority/actions unchanged;
no migration/travel-time/provider call. Cycle 76 stays roadmap.

### Goal

Make location context visible in Today without changing scheduling decisions.

### Scope

- Add lightweight location metadata needed by Today cards, either through the
  existing Today surface or a focused frontend data load.
- Show location status/chips/actions on event-bearing Today cards.
- Preserve Today card priority and all existing card actions.
- Avoid automatic geocoding storms; use cache-first reads and explicit or
  bounded resolution.
- Add tests for `next_event`, `needs_review`, `schedule_prompt`, and conflict
  card location behavior where relevant.

Out of scope:

- Travel-time scoring.
- Feasibility budget changes.
- Route/directions display.
- Map clustering or full-screen map views.

### Expected Behavior

Today cards can reveal where an event happens and offer a map action when
location data is available. If location is missing or unresolved, Today remains
quiet and functional.

## Cycle 76: Travel Time / Transition Cost A

Branch when promoted: `feature/cycle-76-travel-time-transition-cost-a`
Skills when promoted: `backend-fastify, frontend-react-pwa`
Status: promoted 2026-06-28 (`.review/cycle-76/`). Travel-time / transition
cost planning only; implementation pending.

### Goal

Use cached map travel-time data as one deterministic input to transition
friction and feasibility, without making Today provider-dependent.

### Scope

- Add a travel-time cache for event-to-event location pairs, provider identity,
  mode/profile, duration, distance when available, status, and freshness.
- Add backend service logic that requests travel time only when both endpoints
  have usable geocodes and cache policy allows it.
- Feed cached travel-time facts into transition-cost/feasibility surfaces as
  an additive signal.
- Show clear Today/event-detail copy for high-risk transitions and stale or
  unavailable travel-time data.
- Add integration tests for cache hits, provider failure, stale data, missing
  coordinates, and deterministic fallback.

Out of scope:

- Automatic rescheduling.
- Provider-dependent hard blocking of Today.
- Multi-stop route optimization.
- Market/commute prediction beyond provider-supplied travel estimates.

### Expected Behavior

Cairn can warn when two adjacent events look location-impossible or tight, but
it never mutates schedules automatically. When the provider is down or data is
missing, existing deterministic transition logic still works and the UI marks
travel-time confidence as unavailable or stale.

## Promotion Rules

Before promoting a roadmap section to a real cycle:

- create exactly one `.review/cycle-N/plan.md`;
- create `.review/cycle-N/status.txt` with `in_progress`;
- add a concrete branch line;
- declare the exact domain skills;
- keep provider-specific behavior behind the server boundary;
- define automatic checks and temporary-SQLite integration tests for backend
  persistence work;
- do not implement later map cycles inside an earlier cycle.

Cycle 76 is promoted. No later unpromoted cycle remains in this 72-76 roadmap;
choose the next roadmap source after Cycle 76 is implemented, verified, and
merged.
