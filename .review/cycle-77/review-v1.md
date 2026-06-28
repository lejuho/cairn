# Codex Review v1

## Verdict
BLOCKED

## Findings
### ISSUE-1 [MEDIUM] Direction URLs accept impossible latitude values
- Location: `web/src/naver-map-links.ts:24`
- Analysis: `naverCoordToken()` accepts any finite coordinate in `[-180, 180]`, and `directionsSegment()` applies that same helper to both `point.lng` and `point.lat`. That means a point like `{ lat: 120, lng: 127 }` can still produce a Naver directions URL. Upstream schemas do not protect this path: `TodayEventLocationContextSchema` and `EventGeocodeDataSchema` accept arbitrary numbers, and the SQLite geocode cache only checks latitude/longitude null parity.
- Impact: The Sprint Contract requires invalid/out-of-range coordinates to return `null` instead of rendering a direct directions action. An impossible latitude can currently render a bogus external directions link instead of failing soft.
- Fix direction: Validate direction points with axis-specific WGS84 bounds before building a segment: latitude must be finite and within `[-90, 90]`, longitude must be finite and within `[-180, 180]`. Keep the token formula isolated, but make `naverTransitDirectionsUrl()` return `null` for invalid latitude/longitude pairs. Add helper tests for `lat > 90`, `lat < -90`, and existing invalid longitude behavior; a Today render test for an invalid latitude omission is acceptable but not strictly required if helper coverage is explicit.

## Sprint Contract Check
- Naver URL construction is centralized in one pure frontend helper with sample-token tests: PASS.
- Direct public-transit directions links render only from existing resolved `locationContexts` coordinates for both transition endpoints: PARTIAL. Status/null-coordinate gating is present, but out-of-range latitude is not rejected.
- Single-location map/search links use Naver Map URLs and preserve `target="_blank"` plus `rel="noopener noreferrer"`: PASS.
- Missing/uncached/ambiguous/failed/coordinate-less locations omit the direct directions link without causing UI errors: PASS for covered absence states.
- No Naver API/network request, URL validation fetch, scraping, transit-result parsing, or route-result storage was introduced: PASS.
- No backend, shared API contract, DB schema, migration, map gateway, provider env/config, travel-time cache, or feasibility computation behavior changed: PASS.
- Existing Today loading/quiet/live/error states, event detail geocode preview, transition travel copy, energy/gap/sequence sections, cards, and actions remain covered: PASS.
- UI copy does not promise Naver's web route format is a stable API: PASS.
- `docs/codebase-map.md` reflects the new frontend helper boundary: PASS.

## Automatic Checks
- `corepack pnpm verify`: PASS
  - lint: PASS
  - typecheck: PASS
  - unit tests: PASS (`shared` 438, `server` 519, `web` 516)
  - shared build: PASS
  - integration tests: PASS (`server` 733)
  - production build: PASS
- `git diff --check master...HEAD`: PASS.
- Static negative checks:
  - `git diff --name-only master...HEAD | rg '^(server|shared)/'`: PASS (no matches).
  - No provider-key exposure in `web`/`docs`: PASS.
  - No implementation Naver API call, credential use, scraping, route-result parser, or storage path: PASS. Matches found by broad static searches were negative docs/comments or a negative test assertion, not implementation calls.

## Changes Outside Plan
None in the Cycle 77 branch diff. Unrelated uncommitted dotfile/config changes and older cycle artifacts remain in the working tree and were not included in this review.

<!-- RESOLVED-BOUNDARY · above=Codex immutable, below=Executor append-only · check-resolved-immutable.sh enforces -->

## RESOLVED (Executor response, append at file end)

### Issue Classification
- ISSUE-1: APPLY (the Sprint Contract requires out-of-range coordinates to omit the directions link / return null; an impossible latitude must not produce a bogus Naver directions URL.)

### Applied

RESOLVED: ISSUE-1 — direction points are now validated with axis-specific WGS84 bounds before tokenizing.
- `web/src/naver-map-links.ts`: `directionsSegment` now rejects a point unless latitude is finite and within `[-90, 90]` AND longitude is finite and within `[-180, 180]` (new `isValidLat`/`isValidLng` guards), returning `null` — so `naverTransitDirectionsUrl` returns `null` for any invalid latitude/longitude pair and the transition row renders no directions link (fail soft). The token formula stays isolated; `naverCoordToken` keeps its broad `[-180, 180]` formula-overflow guard (it is a single-coordinate encoder and cannot know which axis it is).
- `web/src/naver-map-links.test.ts` (+1): asserts `lat: 120` → `null`, `lat: -120` → `null` (out of latitude range despite being inside the broad token range), and that valid boundary coordinates (`lat 90/-90`, `lng 180/-180`) still produce a non-null URL. Existing invalid-longitude and NaN/Infinity cases remain covered.

Scope: frontend-only, change limited to the one helper file (+ its test). No Today render change, shared/server/DB/migration/gateway/config change; the Naver-search path, the valid-coordinate directions path, and all travel/feasibility/transition behavior are unchanged. (Unrelated worktree dotfile/config and old cycle-artifact edits predate this cycle and are excluded from the pass-002 commit, as review-v1 noted.)

자동 체크: `corepack pnpm lint` ✅ / `typecheck` ✅ / `test` shared 438 / server 519 / web 517 (+1) ✅ / `test:integration` 733 ✅ / `build` ✅ / `git diff --check master...HEAD` ✅. Committed in pass-002.
