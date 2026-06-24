# Sequence Energy A Implementation Plan

Branch: feature/cycle-42-sequence-energy-a
Skills: backend-fastify, frontend-react-pwa

## Summary
Cycle 41 added deterministic `transitionCosts` for consecutive scheduled event
pairs. Cycle 42 implements the first A-slice of FR-FEAS-09: expose a separate
sequence-aware energy view that adds deterministic context-switch cost to the
day's existing work load.

This cycle is descriptive only. It must not reorder events, optimize schedules,
mutate decisions, create suggestions, add LLM calls, or change slot scoring.
Existing `energy.loadUnits` remains the work-duration load. New
`sequenceEnergy` reports `workLoadUnits + transitionLoadUnits` separately so
older semantics stay stable while FR-FEAS-09 becomes visible.

FR-FEAS-10 ordering and FR-FEAS-11 needs-review placement remain future cycles.

## 입력/출력 명세
- 입력:
  - Existing `GET /api/today?date=<YYYY-MM-DD>&now=<RFC3339 offset>`.
  - Existing `GET /api/feasibility/day?date=<YYYY-MM-DD>&now=<RFC3339 offset>`.
  - Existing `POST /api/feasibility/day/preview` body `{ date, now, params }`.
  - Scheduled `planned|confirmed` events for the target day, ordered by start.
  - Existing `DayFeasibility.transitionCosts` from cycle 41.
- 출력:
  - 정상:
    - Extend `DayFeasibility` with required `sequenceEnergy`.
    - Proposed shape:
      - `workLoadUnits`: existing duration-only load.
      - `transitionLoadUnits`: deterministic added load from known transition
        categories.
      - `totalLoadUnits`: `workLoadUnits + transitionLoadUnits`.
      - `budgetUnits`, `remainingUnits`, `deficit`.
      - `unknownTransitionCount`: transitions not converted into load because
        their cost is unknown.
      - `confidence: "cold_start"`.
      - `reasonCodes: string[]`.
    - Transition conversion for A-slice:
      - `none` → `0`
      - `low` → `0.25`
      - `high` → `0.75`
      - `unknown` → no added load; count in `unknownTransitionCount`
    - Today UI shows compact "전환 포함" evidence near the feasibility panel:
      work load, transition added load, total load, deficit state, and unknown
      count when present.
  - 실패:
    - Existing validation failures remain unchanged (`400 VALIDATION_ERROR`).
    - Unknown transition cost is not guessed and does not become hidden high
      energy.
    - Invalid/malformed event times remain fail-open as today: invalid work
      duration contributes no load; transition rows still follow deterministic
      scheduled order.

## Key Changes
- Shared:
  - Add `SequenceEnergySchema` and `SequenceEnergy` type in
    `shared/src/feasibility.ts`.
  - Extend `DayFeasibilitySchema` to require `sequenceEnergy`.
  - Update shared tests and fixtures.
- Backend:
  - Add pure sequence-energy computation, likely inside
    `server/src/services/feasibility.ts` unless a small
    `sequence-energy.ts` helper keeps readability better.
  - Compute sequence energy from already-sorted scheduled events and
    `transitionCosts`.
  - Keep original `energy` computation unchanged.
  - Keep `/api/today`, `/api/feasibility/day`, and
    `/api/feasibility/day/preview` read-only and deterministic.
  - Update server unit/integration tests for transition-to-energy conversion,
    unknown handling, and route payload shape.
  - Update `docs/codebase-map.md` for the new `DayFeasibility.sequenceEnergy`
    contract.
- Frontend:
  - Update `web/src/Today.tsx` feasibility panel to render sequence-energy
    evidence without new tab/page/navigation.
  - Preserve current energy/gap/continuous/transition rows.
  - Use semantic tokens only; no motion-dependent meaning.

## Sprint Contract
- 통과 기준:
  - `energy.loadUnits`, `energy.remainingUnits`, and `energy.deficit` remain
    duration-only and unchanged for existing scenarios.
  - `sequenceEnergy.workLoadUnits` equals `energy.loadUnits`.
  - `sequenceEnergy.transitionLoadUnits` is the sum of known transition category
    units: none=0, low=0.25, high=0.75.
  - `unknown` transition costs add `0` load and increment
    `unknownTransitionCount`.
  - `sequenceEnergy.totalLoadUnits` equals work load plus transition load.
  - `sequenceEnergy.deficit` compares `totalLoadUnits` to the same
    `energyBudget`.
  - The result is read-only and deterministic. No LLM, external API, mutation,
    schedule reorder, auto-decision, or recommendation.
  - Slot candidate scoring, mirror energy trend extraction, gap status, and
    continuous span behavior remain unchanged.
  - Today UI shows sequence total as an explanatory cold-start estimate, not a
    precise recommendation.
  - Touch targets remain at least 44px where new controls exist. This cycle
    should add no required new control; keyboard focus and reduced-motion
    behavior remain unaffected.
- 자동 체크:
  - `corepack pnpm db:generate`
  - `corepack pnpm verify`
  - `git diff --check master..HEAD`
  - Static deterministic boundary:
    `rg -n "completeChat|LLM_PROXY_BASE_URL|googleapis|gcal|gmail|telegram|fetch\\(" shared/src/feasibility.ts server/src/services/feasibility.ts server/src/services/context-switch.ts server/src/routes/feasibility.ts server/src/routes/today.ts`
  - Static no mutation in sequence-energy path:
    `rg -n "\\b(insert|update|delete|transaction|onConflict|run\\()\\b" server/src/services/feasibility.ts server/src/services/context-switch.ts server/src/routes/feasibility.ts server/src/routes/today.ts`
- 테스트 케이스:
  - Shared unit:
    - `SequenceEnergySchema` accepts valid cold-start data.
    - `DayFeasibilitySchema` requires `sequenceEnergy`.
    - Injected `recommendation`, `advice`, `action`, or reorder fields are
      rejected.
  - Pure service unit:
    - No transitions → transition load `0`, total equals work load.
    - Same-thread `none` transition adds `0`.
    - Context `low` transition adds `0.25`.
    - Unrelated/non-context `high` transition adds `0.75`.
    - `unknown` transition adds `0` and increments unknown count.
    - Total deficit can be true even when duration-only `energy.deficit` is
      false.
    - Existing gap and continuous outputs remain byte-for-byte equivalent in
      representative cases except for the new field.
  - Backend integration:
    - `GET /api/feasibility/day` returns `sequenceEnergy` using real SQLite
      `thread_links` rows.
    - `GET /api/today` includes the same `sequenceEnergy` under
      `data.feasibility`.
    - `POST /api/feasibility/day/preview` uses supplied params, remains
      read-only, and returns `sequenceEnergy`.
    - Row counts for events, params, and thread_links do not change.
  - Frontend:
    - Today live state renders "전환 포함" when sequence total differs from
      work load or unknown transitions exist.
    - Same-thread-only day does not render warning-like sequence copy.
    - Unknown transition shows uncertainty copy, not inflated energy.
    - Existing energy/gap/continuous/transition rendering remains intact.
  - 수동:
    - Mobile Chrome light/dark: feasibility panel remains readable with
      sequence-energy line plus 2-3 transition rows.
    - Keyboard: Today focus order unchanged; no trap.
    - Reduced motion: sequence-energy meaning understandable without motion.
- gas 한도: N/A
- slither 통과: N/A

## 누락된 엣지 케이스 후보 3개
- Energy budget sits between duration-only load and sequence total; UI must show
  the distinction without implying automatic rescheduling.
- All transition costs are unknown because event threads are missing; total must
  not silently become high or fake precise.
- Multiple events have same start time; sequence-energy pair order must follow
  the same deterministic order used by `transitionCosts`.

## 더 단순한 대안 1개
Fold transition load directly into existing `energy.loadUnits`. This is simpler,
but it breaks current callers that interpret `energy` as duration-only work
load and makes it harder to compare "before transition" vs "after transition."

## Assumptions
- The A-slice coefficients (`low=0.25`, `high=0.75`) are cold-start constants
  for relative pressure only. They are not personal calibrated truth.
- Unknown transition cost should remain unpriced until the user links threads
  or enough evidence exists in a future tuning cycle.
- Existing route callers that ignore `sequenceEnergy` should keep behaving the
  same.
- This cycle does not add a parameter slider for transition coefficients.

## Review Guidance
### Enumeration 필요 항목
- All `DayFeasibility` producers:
  - Search: `rg -n "computeDayFeasibility\\(" server/src`
  - Expected: every returned `DayFeasibility` includes `sequenceEnergy`.
- All `DayFeasibility` fixtures:
  - Search: `rg -n "DayFeasibility|feasibility:|transitionCosts" shared/src server/src web/src`
  - Expected: tests/fixtures updated with `sequenceEnergy` and no relaxed schema.
- Transition-to-energy conversion:
  - Search: `rg -n "sequenceEnergy|transitionLoadUnits|unknownTransitionCount|cold_start" shared/src server/src web/src`
  - Expected: conversion lives in pure deterministic service code; UI only
    displays returned values.
- No ordering/suggestion scope creep:
  - Search: `rg -n "optimi[sz]e|reorder|topological|critical path|recommend|suggestion|auto" server/src/services server/src/routes web/src`
  - Expected: no new scheduler/order optimizer/recommendation path in this
    cycle.

### 검증 방식 가이드
- Shared schema changes: unit tests are sufficient.
- Sequence-energy arithmetic: pure service unit tests required.
- DB route shape/read-only guarantee: SQLite integration tests required.
- Slot/mirror unchanged behavior: existing tests plus focused assertions are
  enough; no new DB mutation should appear.
- Today rendering: Vitest + Testing Library is sufficient for live/error-ish
  behavior. Mobile/light/dark/reduced-motion checks remain manual or must record
  headless code/test evidence before merge.
