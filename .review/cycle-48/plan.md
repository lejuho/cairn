# Sequence Ordering Diagnostics A Implementation Plan

Branch: feature/cycle-48-sequence-ordering-a
Skills: backend-fastify, frontend-react-pwa

## Summary
Cycles 41-43 exposed context-switch cost, sequence-aware energy, and
needs-review placement. Cycle 48 implements the first A-slice of FR-FEAS-10:
deterministic sequence-ordering diagnostics for the current day's scheduled
events.

This cycle is read-only. It does not move events, apply a schedule, create a
new optimizer UI, mutate tasks/events/links, call the LLM, or add external
travel APIs. It computes and displays evidence: hard dependency order, current
order violations, topological parallel groups, critical path, and a candidate
order preview that respects hard dependencies and uses existing transition-cost
signals only as a deterministic tie-break.

Full schedule application, drag/drop reorder, task scheduling, live travel,
overrun learning, and route-time movement options remain future cycles.

## 입력/출력 명세
- 입력:
  - Existing `GET /api/today?date=<YYYY-MM-DD>&now=<RFC3339 offset>`.
  - Existing `GET /api/feasibility/day?date=<YYYY-MM-DD>&now=<RFC3339 offset>`.
  - Existing `POST /api/feasibility/day/preview` body `{ date, now, params }`.
  - Scheduled `planned|confirmed` events whose `start` begins with the target
    date, ordered by the same deterministic order used by `computeDayFeasibility`.
  - Existing `links` rows among those day events, limited to `kind in
    ("requires", "blocks")`.
  - Existing `thread_links` rows among day event threads, used only through
    the already-defined context-switch cost model.
- 출력:
  - 정상:
    - Extend `DayFeasibility` with required `sequenceOrder`.
    - Proposed `sequenceOrder` shape:
      - `scope: "day_scheduled_events"`.
      - `currentOrder: number[]` event ids in current scheduled order.
      - `candidateOrder: number[]` deterministic preview order.
      - `orderChanged: boolean`.
      - `hardEdges: SequenceOrderEdge[]`.
      - `softEdges: SequenceOrderEdge[]`.
      - `violations: SequenceOrderViolation[]`.
      - `parallelGroups: SequenceOrderGroup[]`.
      - `criticalPath: number[]`.
      - `cycleDetected: boolean`.
      - `reasonCodes: string[]`.
    - Dependency direction:
      - `A requires B` means `B` must come before `A`.
      - `A blocks B` means `A` must come before `B`.
    - Only `firmness="hard"` edges constrain the candidate order. Soft and
      tentative edges are returned as evidence but do not force ordering.
    - If the hard dependency graph is acyclic:
      - `candidateOrder` is Kahn topological order.
      - When multiple nodes are ready, tie-break by lower transition cost from
        the previously chosen event (`none < low < high < unknown`), then by
        current scheduled rank, then event id.
      - `parallelGroups` are Kahn ready layers before transition tie-break.
      - `criticalPath` is the longest hard-dependency path by scheduled event
        duration; ties use current scheduled rank then id.
    - If a hard cycle exists:
      - `cycleDetected=true`.
      - `candidateOrder=currentOrder`.
      - `criticalPath=[]`.
      - `reasonCodes` includes `sequence_order_cycle_detected`.
    - Today UI renders a compact "순서 힌트" section in the feasibility panel
      when there is at least one dependency edge, current-order violation,
      candidate-order change, or cycle. It shows no apply/mutate button.
  - 실패:
    - Existing validation failures remain unchanged (`400 VALIDATION_ERROR`).
    - Missing dependency links yields a quiet valid `sequenceOrder` with
      current/candidate order equal and empty edge/violation groups.
    - Missing thread ids affect only transition tie-break confidence; they must
      not invent a hard dependency.
    - Invalid event duration contributes `0` to critical-path weight, not a
      guessed duration.

## Key Changes
- Shared:
  - Add strict sequence-order schemas and types in `shared/src/feasibility.ts`:
    `SequenceOrderSchema`, `SequenceOrderEdgeSchema`,
    `SequenceOrderViolationSchema`, and `SequenceOrderGroupSchema`.
  - Extend `DayFeasibilitySchema` to require `sequenceOrder`.
  - Add shared tests for valid data, required field, strict rejection of
    injected recommendation/action/apply fields, and cycle/quiet shapes.
- Backend:
  - Add a pure service, likely `server/src/services/sequence-order.ts`.
  - Add a small repository helper for event-event dependency links among a
    bounded day event id set, likely `server/src/repositories/links.ts` or a
    focused helper near existing event repositories.
  - Extend `computeDayFeasibility` with an optional dependency-link input that
    defaults to `[]`, so slot/mirror callers stay deterministic and quiet.
  - Update Today and feasibility routes to prefetch the bounded dependency
    links alongside existing day events/thread links.
  - Keep DB schema and migrations unchanged.
  - Update `docs/codebase-map.md`.
- Frontend:
  - Update `web/src/Today.tsx` feasibility panel to render "순서 힌트" from
    `feasibility.sequenceOrder` when non-quiet.
  - Show current-order violations, candidate order preview, and critical path
    in compact copy. Do not add an apply button.
  - Use semantic tokens only; no motion-dependent meaning.

## Sprint Contract
- 통과 기준:
  - Every `DayFeasibility` producer returns required `sequenceOrder`.
  - Current order remains the existing scheduled event order: start time asc,
    then deterministic tie-break consistent with existing implementation.
  - `requires` and `blocks` dependency directions match the input/output spec.
  - Only hard edges constrain `candidateOrder`; soft/tentative edges remain
    visible evidence and never become hidden hard blockers.
  - Acyclic hard dependencies produce a deterministic topological
    `candidateOrder`.
  - Candidate tie-break uses existing transition cost levels only after hard
    dependency readiness, and never creates a new transition-cost model.
  - Current-order violations are reported when scheduled order contradicts a
    hard dependency.
  - Cycles are detected without throwing; candidate order falls back to current
    order.
  - Critical path is deterministic and based on hard dependencies plus known
    scheduled durations only.
  - Today UI presents the result as explanation/preview, not an instruction or
    automatic reschedule.
  - No DB write, event/task/link mutation, LLM call, external API call, push
    send, automatic schedule reorder, drag/drop, or apply button is introduced.
  - Existing energy, gap, continuous, transition-cost, sequence-energy,
    needs-review placement, slot candidate, and mirror-energy behavior remains
    unchanged except for the added required field.
- 자동 체크:
  - `corepack pnpm db:generate`
  - `corepack pnpm verify`
  - `git diff --check master..HEAD`
  - Static deterministic boundary:
    `git diff -U0 master..HEAD -- shared/src server/src web/src | rg -n "\b(completeChat|LLM_PROXY_BASE_URL|googleapis|gcal|gmail|telegram|fetch\(http|https?://)\b"`
  - Static no mutation in ordering path:
    `git diff -U0 master..HEAD -- server/src/services server/src/routes server/src/repositories | rg -n "\b(insert|update|delete|transaction|onConflict|run\()\b"`
  - Static no schedule-apply UI:
    `git diff -U0 master..HEAD -- web/src | rg -n "apply|reschedule|drag|drop|reorder|scheduleOrder|autoAction"`
- 테스트 케이스:
  - Shared unit:
    - `DayFeasibilitySchema` requires `sequenceOrder`.
    - Quiet sequence order with no dependencies is valid.
    - Hard/soft edge shapes are valid and strict.
    - Injected `recommendation`, `advice`, `action`, `apply`, `delayUntil`, or
      score fields are rejected.
  - Pure service unit:
    - No events → quiet empty order.
    - No dependency links → current order equals candidate order.
    - `A requires B` yields edge `B -> A` and reports a violation when current
      order is `A,B`.
    - `A blocks B` yields edge `A -> B`.
    - Soft/tentative dependency appears in `softEdges` but does not reorder.
    - Multiple ready nodes use transition-cost tie-break, then current rank,
      then id.
    - Hard cycle sets `cycleDetected=true` and keeps candidate order equal to
      current order.
    - Critical path chooses the longest known-duration hard-dependency path
      with deterministic tie-breaks.
    - Invalid event duration counts as `0` for critical-path weight.
  - Backend integration:
    - `GET /api/feasibility/day` returns `sequenceOrder` using real SQLite
      `links` and `thread_links` rows.
    - `GET /api/today` includes the same `sequenceOrder` under
      `data.feasibility`.
    - `POST /api/feasibility/day/preview` returns `sequenceOrder` and remains
      read-only.
    - Row counts for events, tasks, links, thread_links, params, and
      annotations do not change.
    - Route works without an LLM gateway.
  - Frontend:
    - Today does not render "순서 힌트" for quiet equal order.
    - Dependency violation renders clear explanatory copy.
    - Candidate order preview renders without any apply/mutate button.
    - Cycle warning renders without crashing the feasibility panel.
    - Existing energy/gap/continuous/transition/sequence-energy sections remain
      covered.
  - 수동:
    - Mobile Chrome light/dark: "순서 힌트" section remains readable with 3-5
      events.
    - Keyboard: Today focus order unchanged; no new trap.
    - Reduced motion: ordering meaning does not depend on animation.
- gas 한도: N/A
- slither 통과: N/A

## 누락된 엣지 케이스 후보 3개
- A hard dependency points to an event outside the selected day. This A-slice
  should ignore it for day ordering but may add a reason code for out-of-scope
  dependency if surfaced by the bounded query.
- Two hard dependency chains have equal total duration and equal transition
  cost from the previous node. Candidate order must still be stable by current
  rank and id.
- A GCal/imported external meeting participates in a dependency edge. This
  cycle must still remain read-only and must not imply the external event was
  automatically movable.

## 더 단순한 대안 1개
Only flag current-order dependency violations and skip candidate order,
parallel groups, and critical path. This is safer and smaller, but it would not
advance the FR-FEAS-10 requirement for deterministic topological ordering and
parallel-possible sets. The chosen A-slice keeps the output read-only while
making the core graph logic reviewable.

## Assumptions
- `links.kind="requires"` follows the existing reverse-plan convention:
  downstream `from` requires upstream `to`.
- `links.kind="blocks"` means `from` blocks `to`, so `from` should be before
  `to` when both are in the same day ordering scope.
- Only `firmness="hard"` is strong enough to constrain order. Soft/tentative
  edges remain visible because inferred certainty must not be presented as
  hard.
- Candidate order is a preview over already scheduled day events. It is not a
  command to move fixed calendar appointments.
- This cycle does not schedule unscheduled tasks. Task ordering enters a later
  cycle when task time boxes or day assignment are defined.

## Review Guidance
### Enumeration 필요 항목
- All `DayFeasibility` producers:
  - Search:
    `rg -n "computeDayFeasibility\\(" server/src`
  - Expected: every returned `DayFeasibility` includes `sequenceOrder`.
- Sequence-order contract:
  - Search:
    `rg -n "SequenceOrder|sequenceOrder|candidateOrder|parallelGroups|criticalPath" shared/src server/src web/src`
  - Expected: strict shared schemas, pure backend service, route assembly, UI
    display, and tests.
- Dependency-link read path:
  - Search:
    `rg -n "requires|blocks|find.*Links|sequence-order" server/src/repositories server/src/routes server/src/services`
  - Expected: bounded read of event-event links only; no broad unfiltered link
    scan in route code.
- No mutation / no external:
  - Run the static commands from Sprint Contract.
  - Expected: no DB writes or LLM/external calls in ordering path.
- UI scope:
  - Search:
    `rg -n "순서 힌트|candidateOrder|sequenceOrder|apply|reschedule|drag|drop|reorder" web/src`
  - Expected: read-only rendering only; no apply button or drag/drop scheduler.

### 검증 방식 가이드
- Shared schema changes: unit tests sufficient.
- Dependency direction, topological order, cycle detection, parallel groups, and
  critical path: pure service unit tests required.
- Route payload shape and read-only guarantee: SQLite integration tests
  required.
- Today rendering: Vitest + Testing Library sufficient.
- Mobile/light/dark/reduced-motion checks remain manual until visual regression
  tooling exists; reviewer must block merge if manual evidence is missing and
  the implementation adds meaningful UI surface.
