# Feasibility Gap + Energy A 구현 계획

Branch: `feature/cycle-17-feasibility-gap-energy-a`
Cycle: `17`
Created: `2026-06-18`
Skills: `backend-fastify, frontend-react-pwa`

## Summary

Current Cairn can show Today, create/schedule events, review ended events, and
open an event action sheet. The next missing foundation is feasibility: the
system should warn when the day is physically tight and show a coarse energy
load estimate without pretending high precision.

Cycle 17 implements Feasibility A: deterministic day-level gap checks and a
coarse energy gauge. It adds a backend feasibility service, shared contracts,
`GET /api/feasibility/day`, Today API integration, and a compact Today UI
surface.

Out of scope:
- Live travel-time oracle.
- Weather/traffic shock input.
- Param slider/editor UI.
- Context-switch sequencing.
- Slot candidate scoring rewrite.
- People preference weighting.
- Overrun learning from history.
- Hard blocking of user choices.
- New DB tables or migrations.
- New LLM use.

Preparation pass creates only `.review/cycle-17/*` artifacts and stops before
implementation.

## 입력/출력 명세

- `GET /api/feasibility/day?date=YYYY-MM-DD&now=<ISO datetime>`
  - Input:
    - `date`: literal `YYYY-MM-DD`.
    - `now`: parseable ISO datetime.
  - Output:
    - Success: `{ ok: true, data: DayFeasibility }`.
  - Failure:
    - `400 VALIDATION_ERROR`.
  - Deterministic. No LLM gateway import.

- `DayFeasibility`
  - `date`: `YYYY-MM-DD`.
  - `now`: ISO datetime from request.
  - `params`: resolved params with defaults:
    - `energyBudget`: default `8`.
    - `meetBufferMinutes`: default `15`.
    - `deepBufferMinutes`: default `30`.
    - `travelMargin`: default `1`.
    - `maxContinuousMinutes`: default `600`.
  - `energy`:
    - `loadUnits`: coarse sum of scheduled planned/confirmed event duration hours.
    - `budgetUnits`: resolved `energyBudget`.
    - `remainingUnits`: `budgetUnits - loadUnits`.
    - `deficit`: `loadUnits > budgetUnits`.
    - `confidence`: always `"cold_start"` in Cycle 17.
  - `gaps`:
    - Adjacent scheduled planned/confirmed events for the day.
    - `availableMinutes`.
    - `requiredMinutes = meetBufferMinutes` in Cycle 17.
    - `status`: `ok | tight | impossible`.
    - `mode`: `planning | near`.
    - `reasonCodes`: stable machine-readable strings.
  - `continuous`:
    - day span from first start to last end.
    - `exceedsMax`: span > `maxContinuousMinutes`.

- `GET /api/today`
  - Extend response with `feasibility: DayFeasibility`.
  - Existing cards remain deterministic and priority order unchanged.
  - Feasibility warnings are display data, not automatic decisions.

## Key Changes

- Shared:
  - Add `feasibility.ts` schemas/types:
    - query schema.
    - param schema.
    - energy schema.
    - gap schema.
    - day feasibility schema.
  - Export from `shared/src/index.ts`.
  - Extend Today surface schema with `feasibility`.

- Backend:
  - Add params repository helpers for numeric reads with defaults.
  - Add `server/src/services/feasibility.ts`.
  - Add `server/src/routes/feasibility.ts` for `GET /api/feasibility/day`.
  - Register route in `app.ts` when DB exists.
  - Extend `server/src/services/today.ts` to include feasibility for the
    requested date/now.
  - Keep service deterministic and gateway-free.

- Frontend:
  - Extend `Today.tsx` to render:
    - compact energy mini gauge.
    - cold-start confidence copy.
    - gap warning/tight/impossible cards when present.
    - continuous-span warning when present.
  - Preserve existing loading, quiet, live, and error states.
  - Do not add param editing UI in this cycle.

- Docs:
  - Update `docs/codebase-map.md` after implementation with feasibility route,
    shared contract, service, and Today UI locations.

## Sprint Contract

- 통과 기준:
  - `GET /api/feasibility/day` validates `date` and `now`.
  - Scheduled planned/confirmed events on the requested date are included.
  - Cancelled/done/moved/late events are excluded from load and gaps.
  - Energy load is deterministic duration-hours sum.
  - Missing params fall back to explicit Cycle 17 defaults.
  - Invalid numeric params do not crash the route; defaults are used.
  - Adjacent gaps classify as `ok`, `tight`, or `impossible`.
  - Overlapping events create an `impossible` gap with negative available minutes.
  - `near` mode applies when the gap or next event is within 6 hours of `now`;
    otherwise `planning`.
  - Continuous span warning fires when first-start to last-end exceeds
    `maxContinuousMinutes`.
  - `GET /api/today` includes `feasibility`.
  - Today UI renders energy gauge in quiet and live states.
  - Today UI renders gap/continuous warnings without changing card priority.
  - No LLM gateway imports in feasibility service/route/Today aggregation.
  - No migration is added.
  - `docs/codebase-map.md` is updated.

- 자동 체크:
  - `corepack pnpm db:generate`
  - `corepack pnpm test:integration`
  - `corepack pnpm verify`
  - `git diff --check`

- 테스트 케이스:
  - Backend integration: default params produce budget `8`, buffer `15`,
    max continuous `600`.
  - Backend integration: custom params in `params` override defaults.
  - Backend integration: invalid numeric params fall back to defaults.
  - Backend integration: load sums scheduled planned/confirmed durations.
  - Backend integration: excluded statuses do not affect load or gaps.
  - Backend integration: `ok` gap when available >= required.
  - Backend integration: `tight` gap when available >= 0 and < required.
  - Backend integration: `impossible` gap when events overlap.
  - Backend integration: `near` vs `planning` mode.
  - Backend integration: continuous span warning.
  - Backend integration: Today response includes feasibility.
  - Frontend: quiet Today renders energy gauge.
  - Frontend: live Today renders energy gauge and gap warning.
  - Frontend: existing timeline, schedule prompt, and event detail sheet tests remain covered.

- gas 한도: N/A
- slither 통과: N/A

## 누락된 엣지 케이스 후보 3개

- Event timestamps are parseable but use mixed offsets. Cycle 17 should compare
  epoch milliseconds for gap math, while day membership stays existing literal
  `YYYY-MM-DD` prefix behavior.
- All events lack `end`. They should not produce load/gap/continuous warnings;
  route still returns empty feasibility rather than error.
- Param values may be JSON strings, plain numeric strings, or malformed text.
  Numeric extraction must be conservative and default on ambiguity.

## 더 단순한 대안 1개

Only render a Today energy gauge from event durations and skip the standalone
route. This is faster, but route-level integration tests are the cleanest way
to prove deterministic gap/param behavior against real SQLite before wiring it
into Today.

## Assumptions

- Existing `params` table is enough; no migration is expected.
- Cycle 17 energy units are coarse event-duration hours, not a personalized
  fatigue model.
- `energy_budget=8`, `meet_buffer=15`, `deep_buffer=30`,
  `travel_margin=1`, and `max_continuous=600` are explicit cold-start defaults.
- Live travel and overrun learning wait for later cycles.
- Feasibility warnings never block scheduling or status changes.

## Review Guidance

### Enumeration 필요 항목

- Feasibility boundary:
  - Search: `rg -n "feasibility|DayFeasibility|energyBudget|gap" shared/src server/src web/src docs/codebase-map.md`
  - Expected: shared contract, server route/service, Today integration, tests,
    codebase map entry.

- Today API integration:
  - Search: `rg -n "feasibility" server/src/services/today.ts shared/src/today.ts web/src/Today.tsx web/src/Today.test.tsx`
  - Expected: Today surface includes feasibility and UI renders it in quiet/live states.

- Params usage:
  - Search: `rg -n "energy_budget|meet_buffer|deep_buffer|travel_margin|max_continuous|params" server/src`
  - Expected: numeric param read isolated in repository/helper; no ad hoc SQL spread.

- LLM boundary:
  - Search: `rg -n "createLlmGateway|completeChat|LLM_PROXY_BASE_URL|/v1/chat/completions" server/src web/src`
  - Expected: no feasibility service/route or Today aggregation dependency on LLM.

- Migration boundary:
  - Search: `find server/drizzle -maxdepth 2 -type f -print | sort`
  - Expected: no new migration files.

### 검증 방식 가이드

- Backend feasibility requires real temporary SQLite integration tests because
  event filtering, params, and gap math must be proven against persisted rows.
- Frontend can use mocked fetch, but must verify quiet/live rendering and that
  existing Today interactions still work.
- Mock-only backend tests are insufficient for params/default behavior.
- Reviewer should treat live travel, param sliders, slot scoring rewrite, and
  hard blocking as scope creep.
