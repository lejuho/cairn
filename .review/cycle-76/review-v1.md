# Codex Review v1

## Verdict
BLOCKED

## Findings
### ISSUE-1 [MEDIUM] Same-thread travel risk is hidden in Today transition UI
- Location: web/src/Today.tsx:316
- Analysis: `TransitionCostsSection` filters out every transition whose `costLevel` is `none`. Cycle 76 attaches travel evidence to the existing transition object regardless of thread relation, so a same-thread adjacent pair can have `costLevel: "none"` and `travel.status: "fresh"` with enough duration to make the gap tight/impossible. In that case the gap row can become a generic "여유 부족" warning, but the transition row and `TransitionTravelLine` are never rendered, so the user cannot see that the warning came from travel time. The same filter also hides stale/unavailable/missing-geocode travel evidence on same-thread pairs.
- Impact: This misses the Sprint Contract requirement that Today shows high-risk travel, stale travel, unavailable travel, and missing-geocode states honestly. It also weakens the core product behavior that travel time may make an adjacent transition look tight/impossible while explaining that as additive evidence.
- Fix direction: Render travel evidence for adjacent pairs even when thread transition `costLevel` is `none`, at least when `travel.status` is `fresh|stale|unavailable|missing_geocode` and not `same_location`. Either adjust the existing filter or add a dedicated travel-transition row/section. Add frontend tests for a same-thread pair with fresh travel that affects the gap, plus stale/unavailable/missing-geocode same-thread cases as quiet evidence.

### ISSUE-2 [MEDIUM] Route integration does not prove provider failure fallback
- Location: server/src/routes/feasibility.integration.test.ts:735
- Analysis: The added route tests cover a fresh cache hit with a `google` gateway and a missing-geocode case with no gateway. Provider failure with resolved geocodes is only covered at the service level. There is no route integration test proving `GET /api/feasibility/day` or `GET /api/today` returns 200 with `travel.status: "unavailable"` when a gateway exists, both geocodes resolve, and `travelTime()` returns a scoped failure.
- Impact: The Sprint Contract and Review Guidance explicitly require route integration proof that provider disabled/failure/timeout/rate-limit/no-route leaves Today/feasibility successful with unavailable evidence. This is the highest-risk boundary because route wiring now calls the impure travel builder during read endpoints.
- Fix direction: Add temporary-SQLite route integration tests for `GET /api/feasibility/day` and `GET /api/today` with two resolved geocode endpoints and a fake gateway whose `travelTime()` returns `ok:false` (and ideally disabled/no-route variants). Assert HTTP 200, `transitionCosts[0].travel.status === "unavailable"`, and no unexpected travel cache write for transient provider failures.

## Sprint Contract Check
- `travel_time_cache` table, migration, enum/check/unique constraints, temporary DB tests: PASS.
- Server-only provider boundary and no frontend key/provider URL exposure: PASS by diff/static checks.
- Provider calls only with resolved geocodes and cache policy: PASS for service-level tests; route provider-failure fallback coverage is incomplete (ISSUE-2).
- Missing/unresolved geocode and provider failure do not fail Today/feasibility: BLOCKED for route-level provider failure proof (ISSUE-2).
- Existing deterministic thread-based transition costs remain valid: PASS.
- Gap required minutes include travel only for fresh usable facts; unavailable/missing do not fabricate hard truth: PASS.
- Sequence energy does not double-count travel load: PASS by code review; travel is additive on `TransitionCost`, while sequence energy still reads `costLevel`.
- Today UI shows high-risk/stale/unavailable/missing travel honestly: BLOCKED for same-thread `costLevel: none` cases hidden by the UI filter (ISSUE-1).
- No automatic rescheduling/provider hard-blocking/route optimization/autocomplete/cron/bulk geocoding scope: PASS by static diff checks.
- `docs/codebase-map.md` updated: PASS.

## Automatic Checks
- `corepack pnpm verify`: PASS
  - lint: PASS
  - typecheck: PASS
  - unit tests: PASS (`shared` 438, `server` 519, `web` 504)
  - shared build: PASS
  - integration tests: PASS (`server` 731)
  - production build: PASS
- `git diff --check master...HEAD`: PASS
- Static negative checks:
  - No frontend provider/API-key usage: PASS
  - No automatic mutation/rescheduling scope: PASS
  - No LLM path in travel-time implementation: PASS

## Changes Outside Plan
None found in the Cycle 76 branch diff. The worktree still contains unrelated uncommitted dotfile/config and old cycle artifact changes outside this review scope.

<!-- RESOLVED-BOUNDARY · above=Codex immutable, below=Executor append-only · check-resolved-immutable.sh enforces -->

## RESOLVED (Executor response, append at file end)

### Issue Classification
- ISSUE-1: APPLY (Sprint Contract requires Today to show high-risk/stale/unavailable/missing travel honestly; the costLevel-none filter hid same-thread travel evidence — including gap-affecting fresh travel.)
- ISSUE-2: APPLY (Sprint Contract + Review Guidance require route-level proof that a provider failure with resolved geocodes leaves Today/feasibility at 200 with unavailable evidence.)

### Applied

RESOLVED: ISSUE-1 — same-thread travel evidence is no longer hidden by the Today transition filter.
- `web/src/Today.tsx`: `TransitionCostsSection` now keeps a row when `costLevel !== "none" OR (t.travel != null && t.travel.status !== "same_location")`. A same-thread (`costLevel: none`) adjacent pair whose travel is `fresh` (e.g. enough to make the gap tight) — or `stale`/`unavailable`/`missing_geocode` — renders its transition row ("전환 비용 없음" + relation) and its `TransitionTravelLine`. A `none` pair with no travel, or with `same_location` travel, stays hidden (unchanged).
- `web/src/Today.test.tsx` (+3): a same-thread fresh pair surfaces the travel line with `data-cost="none"`; same-thread `stale`/`unavailable`/`missing_geocode` render quietly (no `role="alert"`); a same-thread `same_location` pair renders no transition row.

RESOLVED: ISSUE-2 — route integration now proves provider-failure fail-open on both read endpoints.
- `server/src/routes/feasibility.integration.test.ts` (+1) and `server/src/routes/today.integration.test.ts` (+1): two resolved geocode endpoints, an empty travel cache, and a fake gateway whose `travelTime()` returns `{ ok:false }` (a scoped failure). Each asserts HTTP **200**, `transitionCosts[0].travel.status === "unavailable"`, the gap reason `gap_travel_unavailable`, and `travel_time_cache` row count **0** (a transient failure is never cached).

Scope: the only production change is the one Today.tsx filter line; the rest is additive tests plus one `docs/codebase-map.md` line documenting the filter. No shared schema, gateway, repository, travel service, feasibility computation, or migration changed; the cache-only/server-only/fail-open/no-double-count boundaries are untouched. (Unrelated worktree `.claude/*`, `AGENTS.md`, `CONTRACT_MARKERS.md`, and old cycle-artifact edits predate this cycle and are excluded from the pass-002 commit, as review-v1 noted.)

자동 체크: `corepack pnpm lint` ✅ / `typecheck` ✅ / `test` shared 438 / server 519 / web 507 (+3) ✅ / `test:integration` 733 (+2) ✅ / `build` ✅ / `git diff --check master...HEAD` ✅. Committed in pass-002.
