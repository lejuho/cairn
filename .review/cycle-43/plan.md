# Needs-Review Placement A Implementation Plan

Branch: feature/cycle-43-needs-review-placement-a
Skills: backend-fastify, frontend-react-pwa

## Summary
Cycles 41 and 42 exposed context-switch cost and sequence-aware energy. Cycle 43
implements the first A-slice of FR-FEAS-11: deterministic placement metadata for
Today `needs_review` cards so AI review prompts can be shown with honest
"why now" context instead of appearing as context-free interruptions.

This slice does not hide, snooze, delay, reorder schedules, mutate events, call
the LLM, or optimize the day. It preserves the existing Today card priority.
The new behavior is explanatory: each `needs_review` card gets placement
metadata derived from current day context and bounded staleness.

FR-FEAS-10 ordering and any actual deferred delivery/scheduling of review
prompts remain future cycles.

## 입력/출력 명세
- 입력:
  - Existing `GET /api/today?date=<YYYY-MM-DD>&now=<RFC3339 offset>`.
  - Existing `needsReviewEvents` from `listNeedsReviewEvents(db, now)`.
  - Existing `dayEvents` for the requested date.
  - Existing `feasibility.transitionCosts` from cycle 41.
  - `now` from request, used for bounded staleness.
- 출력:
  - 정상:
    - Extend Today `needs_review` card payload with `placement`.
    - Proposed shape:
      - `mode`: `low_context_slot | stale_due | no_context`
      - `anchorEventId`: event id when placement is tied to an adjacent/nearby
        low-cost context slot, else `null`.
      - `ageHours`: nonnegative integer hours since reviewed event end when
        known, else `null`.
      - `reasonCodes: string[]`
    - Rules for A-slice:
      - If a needs-review event has a same-day adjacent transition with
        `costLevel="none"|"low"`, mode = `low_context_slot`.
      - Else if the reviewed event ended at least 12 hours before `now`, mode =
        `stale_due`.
      - Else mode = `no_context`.
      - A `stale_due` card still appears; staleness is an upper bound signal,
        not an auto decision.
    - Today UI displays a compact placement line on needs-review cards:
      - low context: "맥락 맞는 틈"
      - stale: "미루면 기억이 흐려져"
      - no context: "짧게 확인"
  - 실패:
    - Existing validation failures remain unchanged (`400 VALIDATION_ERROR`).
    - Missing/invalid reviewed-event end time yields `ageHours=null` and never
      fabricates staleness.
    - Missing transition data yields `no_context`, not guessed low context.

## Key Changes
- Shared:
  - Add `NeedsReviewPlacementSchema` and `NeedsReviewCardSchema` in
    `shared/src/today.ts`.
  - Update `TodaySurfaceSchema.cards` so `needs_review` cards carry
    `{ event, placement }`.
  - Keep top-level `needsReviewEvents` unchanged for compatibility.
- Backend:
  - Add pure deterministic placement helper, likely in
    `server/src/services/today.ts` or `needsReviewPlacement.ts`.
  - Inputs only: `needsReviewEvents`, `dayEvents`,
    `feasibility.transitionCosts`, `now`.
  - Preserve existing card priority: conflict → watcher → next_event →
    two_minute_task → needs_review → schedule_prompt.
  - Do not mutate review rows, events, annotations, or params.
  - Update route/service integration tests for placement modes and unchanged
    card ordering.
  - Update `docs/codebase-map.md`.
- Frontend:
  - Update `web/src/Today.tsx` `needs_review` card rendering to show placement
    reason text.
  - Keep existing reply form behavior unchanged.
  - Use semantic tokens only; no new tab/page/nav.

## Sprint Contract
- 통과 기준:
  - Every `needs_review` card in `TodaySurface.cards` has `placement`.
  - Top-level `needsReviewEvents` remains the same array of events.
  - Low-context placement is selected when the reviewed event participates in a
    same-day transition with `costLevel="none"` or `"low"`.
  - Stale placement is selected when no low-context slot exists and the event
    ended at least 12 hours before `now`.
  - No-context placement is selected otherwise.
  - Invalid/missing event end time does not throw and does not infer staleness.
  - Card priority remains unchanged relative to conflict, watcher, next event,
    two-minute task, and schedule prompt cards.
  - No LLM, external API, DB write, push send, snooze/dismiss mutation, schedule
    reorder, or auto-review completion.
  - Today UI keeps existing needs-review submit/refetch/error behavior.
  - Placement copy is explanatory, not prescriptive.
- 자동 체크:
  - `corepack pnpm db:generate`
  - `corepack pnpm verify`
  - `git diff --check master..HEAD`
  - Static deterministic boundary:
    `rg -n "completeChat|LLM_PROXY_BASE_URL|googleapis|gcal|gmail|telegram|fetch\\(" shared/src/today.ts server/src/services/today.ts server/src/routes/today.ts web/src/Today.tsx`
  - Static no mutation in placement path:
    `rg -n "\\b(insert|update|delete|transaction|onConflict|run\\()\\b" server/src/services/today.ts server/src/routes/today.ts`
- 테스트 케이스:
  - Shared unit:
    - `NeedsReviewPlacementSchema` accepts all three modes.
    - `TodaySurfaceSchema` requires placement on `needs_review` cards.
    - Injected `recommendation`, `autoAction`, `delayUntil`, or `score` fields
      are rejected.
  - Pure service unit:
    - Low-cost adjacent transition yields `low_context_slot`.
    - Same-thread `none` transition also yields `low_context_slot`.
    - High/unknown/no transition with age >= 12h yields `stale_due`.
    - High/unknown/no transition with age < 12h yields `no_context`.
    - Missing/malformed `event.end` yields `ageHours=null` and `no_context`.
    - Existing card priority order remains unchanged.
  - Backend integration:
    - `GET /api/today` returns placement on needs-review cards.
    - Top-level `needsReviewEvents` remains unchanged.
    - Row counts for events and annotations do not change.
    - Deterministic route works without LLM gateway.
  - Frontend:
    - Needs-review card renders the placement line for each mode.
    - Submit reply still posts annotation and refetches Today.
    - Failed submit still keeps the card visible with local error.
    - Existing loading/quiet/live/error/access-session states remain covered.
  - 수동:
    - Mobile Chrome light/dark: card copy remains readable.
    - Keyboard: reply form focus order unchanged.
    - Reduced motion: placement meaning does not depend on motion.
- gas 한도: N/A
- slither 통과: N/A

## 누락된 엣지 케이스 후보 3개
- A needs-review event is not part of the requested day's `dayEvents`; placement
  should not invent a low-context slot from absent transition data.
- Multiple adjacent low-context transitions include the same reviewed event;
  anchor selection must be deterministic.
- Event end is in the future relative to `now`; age should clamp to `0`, not a
  negative stale signal.

## 더 단순한 대안 1개
Only add static copy to all needs-review cards. This is safer, but it does not
advance FR-FEAS-11 because the prompt still has no context-aware placement
evidence.

## Assumptions
- `listNeedsReviewEvents` already sorts review candidates by most recently
  ended first; this cycle does not change candidate selection.
- A 12-hour staleness bound is an A-slice constant, not a tuned preference.
- "Placement" is metadata and copy only. Actual delayed delivery or grouping
  waits for a later cycle.

## Review Guidance
### Enumeration 필요 항목
- Today card builders:
  - Search: `rg -n "needs_review|buildTodaySurface|cards" shared/src/today.ts server/src/services/today.ts server/src/routes/today.ts web/src/Today.tsx web/src/Today.test.tsx`
  - Expected: every `needs_review` card has placement; top-level
    `needsReviewEvents` remains event-only.
- Placement modes:
  - Search: `rg -n "low_context_slot|stale_due|no_context|placement" shared/src server/src web/src`
  - Expected: all modes covered by schema, service tests, route tests, and UI
    copy.
- No mutation / no external:
  - Search: sprint contract static commands above.
  - Expected: no hits in placement path.
- Scope creep:
  - Search: `rg -n "delayUntil|snooze|dismiss|reorder|optimi[sz]e|autoAction|completeChat" shared/src server/src web/src`
  - Expected: no new delayed delivery, optimizer, mutation, or LLM path.

### 검증 방식 가이드
- Shared schema changes: unit tests sufficient.
- Placement classification: pure service unit tests required.
- Today route shape and read-only guarantee: SQLite integration tests required.
- UI copy and existing submit behavior: Vitest + Testing Library sufficient.
- Mobile/light/dark/reduced-motion checks remain manual or must record headless
  code/test evidence before merge.
