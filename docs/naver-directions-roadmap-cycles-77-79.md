# Naver Directions Roadmap: Cycles 77-79

Status: Cycle 77 promoted and active; Cycles 78-79 candidates
Created: 2026-06-28

This roadmap follows the completed map/location roadmap in
`docs/map-roadmap-cycles-72-76.md`.

The product need is narrower than embedded maps: when Cairn knows where two
events are, the user should be able to jump into Naver Map and immediately see
public-transit directions. Cairn should not become a public-transit scraper or
store Naver route results.

## Product Direction

- Keep provider APIs and credentials out of the browser.
- Prefer existing cached geocode/location context before adding new provider
  calls.
- Use Naver Map as an external action for Korean public-transit UX.
- Do not embed a map, parse transit itineraries, cache route steps, or mutate
  schedules from a route result.
- Treat Naver web route URLs as best-effort external links, not as an official
  API contract.

## Cycle 77: Naver External Directions Link A

Branch when promoted: `feature/cycle-77-naver-external-directions-link-a`
Skills when promoted: `frontend-react-pwa`
Status: promoted + implemented 2026-06-28 (`.review/cycle-77/`). Frontend-only.
New pure `web/src/naver-map-links.ts` (base62 coordinate token verified against
the observed samples; Naver search URL; best-effort `/p/directions/.../-/transit`
URL from two resolved coordinate+label endpoints — reverse-engineered, isolated,
fail-soft null). Today/event-detail single-location map links now use Naver
search; a transition row renders a compact external "길찾기" Naver transit link
only when BOTH adjacent endpoints have resolved `locationContexts` coordinates.
No Naver API call/key/fetch/scrape/storage; no backend/shared/DB/gateway change.
Cycles 78-79 (Naver place search, manual transit detail) stay candidates.

### Goal

Open Naver Map directly to public-transit directions for adjacent scheduled
event pairs when Cairn already has resolved coordinates for both endpoints.

### Scope

- Add a pure frontend helper for Naver Map search and best-effort transit
  directions URLs.
- Encode coordinates using the observed Naver token formula:
  `base62(round((coordinate + 200) * 10_000_000))`.
- Render a compact external Naver public-transit action on Today transition rows
  only when both endpoints have resolved coordinates.
- Switch existing single-location map/search actions to Naver Map URLs.
- Add unit and frontend tests for URL generation, resolved-pair rendering, and
  missing-coordinate omission.

Out of scope:

- Naver API calls, credentials, or server provider integration.
- Naver place autocomplete/search.
- Embedded maps.
- Parsing or caching route duration, fare, subway/bus steps, or arrival times.
- Feasibility math changes or automatic rescheduling.

### Expected Behavior

For a resolved adjacent event pair, Today offers an external action that opens
Naver Map in public-transit directions mode. If coordinates are missing or the
link cannot be constructed, the action is simply absent and Today remains fully
usable.

## Cycle 78: Naver Place Search A

Branch when promoted: `feature/cycle-78-naver-place-search-a`
Skills when promoted: `backend-fastify, frontend-react-pwa`
Status: candidate

### Goal

Use Naver's official local search API as an autocomplete-like place candidate
source without changing event creation semantics.

### Scope

- Add a server-side Naver local search boundary with credentials kept out of
  the browser.
- Return a small provider-neutral candidate list: title, category, road/jibun
  address, coordinate fields when provided, and public Naver link when provided.
- Add frontend candidate UI only where location text is already being edited or
  confirmed.
- Keep selection explicit; suggestions never rewrite event locations silently.

Out of scope:

- Public-transit route parsing.
- Bulk place enrichment.
- Replacing the existing provider-neutral geocode cache.

### Expected Behavior

When editing a location, the user can choose from a small set of Naver local
place candidates. Choosing a candidate improves the external Naver link quality
but does not create automatic route decisions.

## Cycle 79: Manual Transit Detail Capture A

Branch when promoted: `feature/cycle-79-manual-transit-detail-capture-a`
Skills when promoted: `frontend-react-pwa, backend-fastify`
Status: candidate

### Goal

Let the user record a manually confirmed transit summary from Naver Map without
scraping or provider-side ingestion.

### Scope

- Add an explicit user-entered transit note or lightweight event transition
  annotation such as "9호선 1정거장, 약 8분".
- Keep the note clearly user-authored, separate from provider-fetched travel
  facts.
- Show the note next to transition travel evidence when present.

Out of scope:

- Scraping Naver route pages.
- Automatic transport-mode inference.
- Schedule mutation or route optimization.

### Expected Behavior

After opening Naver Map externally, the user can store a short human-confirmed
summary in Cairn. That summary is provenance-labeled as user-authored and does
not masquerade as live provider data.

## Promotion Rules

Before promoting a roadmap section to a real cycle:

- create exactly one `.review/cycle-N/plan.md`;
- create `.review/cycle-N/status.txt` with `in_progress`;
- add a concrete branch line;
- declare the exact domain skills;
- keep Naver credentials server-side when a future cycle adds Naver APIs;
- define static negative checks that prevent scraping, route-result storage, and
  hidden schedule mutation;
- do not implement later Naver search/capture cycles inside the directions-link
  cycle.
