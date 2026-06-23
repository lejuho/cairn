# Context-Switch Cost A 구현 계획

Branch: feature/cycle-41-transition-cost-a
Skills: backend-fastify, frontend-react-pwa

## Summary
Cycle 40 finished the first cross-cutting relation view, including typed
`thread_link` edges. This cycle implements the first A-slice of FR-FEAS-08:
deterministic context-switch cost calculation for consecutive scheduled events
on a day.

The slice is explanatory only. It must not reorder the day, mutate events,
create schedules, add LLM calls, or fold transition cost into the energy total.
FR-FEAS-09 sequence energy integration, FR-FEAS-10 ordering, and FR-FEAS-11
needs-review placement remain future cycles.

## 입력/출력 명세
- 입력:
  - Existing `GET /api/today?date=<YYYY-MM-DD>&now=<RFC3339 offset>`.
  - Existing `GET /api/feasibility/day?date=<YYYY-MM-DD>&now=<RFC3339 offset>`.
  - Existing `POST /api/feasibility/day/preview` body `{ date, now, params }`.
  - Scheduled `planned|confirmed` events for the target day, ordered by start.
  - `thread_links` rows among the day event `threadId`s.
- 출력:
  - 정상:
    - Extend `DayFeasibility` with `transitionCosts: TransitionCost[]`.
    - One row per consecutive scheduled event pair that has valid start/end
      ordering.
    - Proposed shape:
      - `fromEventId`, `toEventId`
      - `fromThreadId`, `toThreadId` (`null` when either event has no thread)
      - `relation`: `same_thread | context_link | non_context_link | unrelated | missing_thread`
      - optional `relationKind`: `contains | blocks | feeds | competes | shares`
      - optional `firmness`: `hard | soft`
      - `costLevel`: `none | low | high | unknown`
      - `reasonCodes: string[]`
    - Today UI shows a compact "맥락 전환" section in the feasibility panel for
      non-`none` transitions, with event titles, relation/cost label, and
      reason text. It stays descriptive and non-prescriptive.
  - 실패:
    - Existing validation failures remain unchanged (`400 VALIDATION_ERROR`).
    - Missing `threadId` on either side yields `relation="missing_thread"` and
      `costLevel="unknown"`, not an inferred high-cost relation.
    - Invalid dates or unsorted/overlapping events do not throw; impossible gaps
      remain represented by existing `gaps`, while transition rows still follow
      the deterministic event order.

## Key Changes
- Shared:
  - Extend `shared/src/feasibility.ts` with transition-cost schemas/types.
  - Update `DayFeasibilitySchema` and tests to require `transitionCosts`.
- Backend:
  - Add a pure transition-cost service, likely
    `server/src/services/context-switch.ts`, or a tightly scoped helper under
    `server/src/services/feasibility.ts` if the existing file remains readable.
  - Add a read-only repository helper for `thread_links` among a set of thread
    ids, likely in `server/src/repositories/threads.ts`.
  - Update `computeDayFeasibility` to accept optional transition relation rows
    and return `transitionCosts`.
  - Update `/api/today`, `/api/feasibility/day`, and `/api/feasibility/day/preview`
    to load day-thread relations and pass them into the deterministic service.
  - Update unit and SQLite integration tests.
  - Update `docs/codebase-map.md` for the new `DayFeasibility.transitionCosts`
    contract and backend/UI boundaries.
- Frontend:
  - Update `web/src/Today.tsx` `FeasibilityPanel` to render transition-cost
    evidence in the existing Today surface.
  - Keep the UI mobile-first, semantic-token-only, and compact; no new page,
    nav item, graph, drag-and-drop, reorder action, or scheduling mutation.

## Sprint Contract
- 통과 기준:
  - For consecutive same-thread events, transition cost is `none`.
  - For consecutive events whose thread ids are connected by `contains`,
    `shares`, or `feeds` in either direction, transition cost is `low`.
  - For `blocks` or `competes` links, transition cost is not treated as
    context-sharing; it is `high` with a distinct reason code.
  - For unlinked thread ids, transition cost is `high`.
  - If either event has no thread id, transition cost is `unknown`, not guessed.
  - Multiple links between the same two threads resolve deterministically:
    context-sharing kinds win over non-context kinds; within the same class use
    relation kind order `contains`, `shares`, `feeds`, `blocks`, `competes`,
    then firmness order `hard`, `soft`, then link id ascending.
  - The result is read-only and deterministic. No LLM, external API, mutation,
    schedule reorder, or auto-decision.
  - Energy `loadUnits`, `deficit`, gaps, continuous span, and slot scoring
    behavior remain unchanged in this cycle.
  - Today UI exposes transition cost level and reason text, but does not show a
    fake precise numeric score.
  - Touch targets remain at least 44px, keyboard focus is unaffected, and
    reduced-motion preferences are honored.
- 자동 체크:
  - `corepack pnpm db:generate`
  - `corepack pnpm verify`
  - `git diff --check master..HEAD`
  - Static deterministic boundary:
    `rg -n "completeChat|LLM_PROXY_BASE_URL|googleapis|gcal|gmail|telegram|fetch\\(" shared/src/feasibility.ts server/src/services/feasibility.ts server/src/services/context-switch.ts server/src/routes/feasibility.ts server/src/routes/today.ts`
  - Static no mutation in new transition read path:
    `rg -n "\\b(insert|update|delete|transaction|onConflict|run\\()\\b" server/src/services/context-switch.ts server/src/services/feasibility.ts server/src/routes/feasibility.ts server/src/routes/today.ts`
- 테스트 케이스:
  - Shared unit:
    - `TransitionCostSchema` accepts all valid relation/cost levels.
    - `DayFeasibilitySchema` requires `transitionCosts`.
    - Injected `score`, `recommendation`, `advice`, or numeric precision fields
      are rejected.
  - Pure service unit:
    - Same thread → `none`.
    - `contains|shares|feeds` either direction → `low`.
    - `blocks|competes` only → `high` with non-context reason.
    - No link → `high`.
    - Missing thread id → `unknown`.
    - Multiple links resolve by the deterministic priority above.
    - Event pairs are based on sorted scheduled order and do not include
      unscheduled/cancelled/done events.
  - Backend integration:
    - `GET /api/feasibility/day` returns transition costs using real
      `thread_links` rows in SQLite.
    - `GET /api/today` includes the same transition-cost rows under
      `data.feasibility.transitionCosts`.
    - `POST /api/feasibility/day/preview` uses supplied params and remains
      read-only while still returning transition costs for the day.
    - Row counts for events and thread_links do not change.
  - Frontend:
    - Today live state renders a "맥락 전환" section when non-none transition
      costs exist.
    - Same-thread-only days do not render warning-like transition copy.
    - Unknown thread relation is displayed as uncertainty, not as a hard warning.
    - Existing energy/gap/continuous rendering remains intact.
  - 수동:
    - Mobile Chrome light/dark: Today feasibility panel remains readable and not
      cramped with 2-3 transition rows.
    - Keyboard: Today focus order unchanged; no new trap.
    - Reduced motion: transition section understandable without motion.
- gas 한도: N/A
- slither 통과: N/A

## 누락된 엣지 케이스 후보 3개
- A day has events with the same start time; event ordering must remain stable
  enough for deterministic transition pair output.
- Two threads have both `feeds` and `blocks` links; context-sharing relation
  should win deterministically without double-counting.
- A transition pair has one event without `threadId`; the UI must show
  uncertainty rather than implying unrelated high cost.

## 더 단순한 대안 1개
Only compare adjacent event `threadId`s and render "same/different thread" with
no `thread_links` lookup. This is faster, but it fails FR-FEAS-08 because the
spec explicitly defines adjacent `thread_links` as lower switch cost.

## Assumptions
- Existing `thread_links` data is sparse and small enough for a single read per
  day request on the Raspberry Pi.
- Transition cost levels are explanatory categories, not precise energy units.
- `contains`, `shares`, and `feeds` mean context-sharing for this A-slice;
  `blocks` and `competes` are known relations but do not reduce context switch
  cost.
- This cycle does not add a new params slider for transition coefficients.

## Review Guidance
### Enumeration 필요 항목
- All `DayFeasibility` producers:
  - Search: `rg -n "computeDayFeasibility\\(" server/src`
  - Expected: every call path either passes thread relation rows or has an
    explicit documented fallback. No response should omit `transitionCosts`.
- Transition relation kinds:
  - Search: `rg -n "contains|shares|feeds|blocks|competes|same_thread|context_link|non_context_link|unrelated|missing_thread" shared/src server/src`
  - Expected: all relation/cost states covered by schema and service tests.
- Today UI:
  - Search: `rg -n "맥락 전환|transitionCosts|costLevel|reasonCodes" web/src/Today.tsx web/src/Today.test.tsx`
  - Expected: UI renders non-none transitions, unknown as uncertainty, and no
    numeric fake score.
- Deterministic/no external boundary:
  - Search: `rg -n "completeChat|LLM_PROXY_BASE_URL|googleapis|gcal|gmail|telegram|fetch\\(" shared/src/feasibility.ts server/src/services/feasibility.ts server/src/services/context-switch.ts server/src/routes/feasibility.ts server/src/routes/today.ts`
  - Expected: no hits in shared/backend transition-cost path.

### 검증 방식 가이드
- Shared schema changes: unit tests are sufficient.
- Transition pair enumeration and relation priority: pure service unit tests
  are required.
- `thread_links` lookup correctness: SQLite integration tests are required
  because relation rows live in DB and direction/multiple-kind behavior matters.
- Read-only guarantee: static mutation search plus integration row-count checks
  are required.
- Today rendering: Vitest + Testing Library is sufficient for live/quiet-ish
  panel behavior; mobile/light/dark/reduced-motion checks remain manual or must
  record headless code/test evidence before merge.
