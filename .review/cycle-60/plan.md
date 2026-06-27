# Thread Rollup Paid Cost A Implementation Plan

Branch: feature/cycle-60-thread-rollup-paid-cost-a
Cycle: 60
Created: 2026-06-27
Skills: backend-fastify, frontend-react-pwa

## Summary

Remaining implementation specs after cycle 59:

- `FR-SYNC-05` now has a backend-only Gmail cancellation-cost A-slice. The next
  Gmail slice would be parse-failure fallback, but the product spec still marks
  that fallback as undecided (`manual one-time question` vs `keep empty`), so it
  is not the best immediate cycle.
- `FR-SLOT` still has an important gap for due tasks with no scheduled block,
  but accepting a task slot would need a clear task→event write contract. The
  existing slot implementation is event-only, and inventing that persistence
  rule in a cycle plan would be too risky.
- `FR-MOV`, GCal mirror export/recovery, and watcher-B automation are either
  optional, external-API-heavy, or explicitly later-phase work.
- `FR-THR-10` still has a concrete gap in code: hard `contains` rollup aggregates
  progress and energy, while cost remains unavailable in the parent rollup.
  Cycle 53 added direct thread settlement, and cycle 59 added a cost input path,
  so paid-cost rollup is now a bounded, deterministic next step.

Recommended next spec: **FR-THR-10 / FR-THR-07 Thread Rollup Paid Cost A**.

This cycle extends existing thread rollup data and UI so a parent thread can see
actual paid cost evidence from its direct nodes and hard-contained descendants.
It reuses the existing settlement cost shape and counts only observed
moved/cancelled event cost fields. It does not invent avoided/missing money,
change thread settlement readiness, add schema migrations, add routes, call
Gmail, call the LLM gateway, mutate events/tasks/threads, or automate any
decision.

## Input/Output Spec

- Input:
  - Existing `GET /api/threads/:id`.
  - Path `id`: existing positive integer validation and not-found behavior.
  - Existing DB state:
    - direct thread events/tasks
    - hard `thread_links.kind='contains'` descendants
    - descendant events with `status`, `cancel_money`, `cancel_social`,
      `cancel_effort`, and `cancel_window`
- Output:
  - Success keeps the existing `ThreadDetail` response and extends
    `rollup` with paid-cost evidence:
    - `rollup.direct.paidCost`
    - `rollup.contains.paidCost`
    - `rollup.total.paidCost`
    - `rollup.children[].paidCost`
  - `paidCost` reuses the existing decomposed settlement cost shape:
    - `eventCount`: count of moved/cancelled events contributing paid cost
    - `money`: sum of `cancel_money ?? 0`
    - `social`: sum of `cancel_social ?? 0`
    - `effort`: bucket counts using the existing settlement effort buckets
    - `windowCount`: count of non-empty `cancel_window`
  - `rollup.direct.paidCost` covers only the requested thread's direct events.
  - `rollup.contains.paidCost` covers all reachable hard-contained descendant
    threads, each visited at most once.
  - `rollup.total.paidCost` is direct + contains.
  - `rollup.children[].paidCost` is each child row's direct paid cost only,
    matching the current child progress/energy row semantics.
  - `missingCost` and `missingCostStatus` remain unchanged:
    - `missingCost: null`
    - `missingCostStatus: "unavailable"`
  - Failure behavior is unchanged:
    - invalid id -> existing `400 VALIDATION_ERROR`
    - unknown thread -> existing `404 NOT_FOUND`

## Key Changes

- Shared:
  - `shared/src/threads.ts`
    - Extend rollup metric/bucket/child schemas and types with `paidCost`.
    - Reuse `ThreadSettlementPaidCostSchema` rather than introducing a scalar or
      second cost model.
  - `shared/src/threads.test.ts`
    - Update rollup fixtures and add schema assertions for decomposed paid cost.
- Backend:
  - `server/src/repositories/threads.ts`
    - Extend the rollup event slim projection to include the cost columns needed
      for paid-cost aggregation.
    - Keep the read batch scoped to root + reachable hard-contained descendants.
  - `server/src/services/thread-rollup.ts`
    - Compute direct, contains, total, and child-row paid cost deterministically.
    - Ensure historical contains cycles or duplicate paths do not double-count
      paid cost.
  - `server/src/services/thread-settlement.ts`
    - If useful, extract a small pure helper for paid-cost aggregation so direct
      settlement and rollup share the same semantics.
  - `server/src/routes/threads.integration.test.ts`
    - Add real SQLite integration coverage for direct/contains/total paid-cost
      rollup through `GET /api/threads/:id`.
- Frontend:
  - `web/src/Thread.tsx`
    - Render compact paid-cost chips in the existing rollup section when there
      is child rollup data.
    - Keep the existing progress/energy table readable on mobile; avoid adding
      a wide table that can overflow.
    - Preserve the current "missing cost unavailable" copy, updated to clarify
      that only observed paid cost is available.
  - `web/src/Thread.test.tsx`
    - Update rollup fixtures.
    - Assert direct/contains/total and child paid-cost chips render from the
      rollup response.
- Docs:
  - `docs/codebase-map.md`
    - Update shared/backend/frontend rollup map entries with paid-cost rollup.

## Sprint Contract

- Passing criteria:
  - `GET /api/threads/:id` returns a valid `ThreadDetail` with paid-cost fields
    on every rollup metric/bucket/child row.
  - Paid cost is decomposed only; no scalar cost score, recommendation, advice,
    auto-apply, or decision output is introduced.
  - Paid cost counts only events whose status is `moved` or `cancelled`.
  - Cancelled events still stay excluded from progress denominator but included
    in paid-cost evidence.
  - `cancel_money=null` and `cancel_money=0` contribute zero money, while
    social/effort/window evidence can still make the event count as paid cost.
  - `contains` paid cost includes only hard `contains` descendants; soft
    contains, non-contains links, incoming parent links, and unrelated threads
    are excluded.
  - Historical contains cycles or duplicate descendant paths do not double-count
    a thread's paid cost and continue to surface the existing rollup warning.
  - `total.paidCost` equals `direct.paidCost + contains.paidCost` bucket by
    bucket.
  - `missingCost` remains `null` and `missingCostStatus` remains
    `"unavailable"`; avoided/missing money is not fabricated.
  - No schema migration, new DB table/column, new route, DB write, Gmail call,
    LLM gateway call, GCal mirror/export, cron/scheduler, or decision behavior
    is added.
  - Thread rollup UI remains mobile-first, semantic-token based, and does not
    overflow on narrow viewports.
- Automatic checks:
  - `corepack pnpm lint`
  - `corepack pnpm typecheck`
  - `corepack pnpm test`
  - `corepack pnpm test:integration`
  - `corepack pnpm build`
  - `corepack pnpm verify`
  - `git diff --check master...HEAD`
- Test cases:
  - Shared/unit:
    - Valid rollup payload with direct/contains/total/child `paidCost` parses.
    - Missing `paidCost` on a rollup object fails the shared schema.
    - `paidCost` rejects non-decomposed injected scalar fields through the
      reused strict paid-cost schema.
  - Pure service:
    - Direct moved/cancelled event cost aggregates into `direct.paidCost`.
    - Descendant moved/cancelled event cost aggregates into `contains.paidCost`
      and `total.paidCost`.
    - Planned/done events with cancel fields do not count as paid cost.
    - Cancelled events count as paid cost but not progress.
    - Null/zero money with social/effort/window evidence is represented without
      losing event count.
    - Soft contains and non-contains links do not affect paid-cost rollup.
    - Historical cycle/duplicate path is visited once and keeps the warning.
  - SQLite integration:
    - `GET /api/threads/:id` returns paid-cost rollup for a hard
      parent→child→grandchild chain.
    - A child row exposes only that child thread's direct paid cost, while the
      parent `contains` bucket includes all reachable descendants.
    - Existing direct settlement remains direct-thread only and unchanged.
    - No row counts change for `threads`, `events`, `tasks`, `thread_links`,
      `links`, `annotations`, or `params`.
  - Frontend:
    - Thread rollup renders paid-cost chips for direct/contains/total.
    - Child drilldown rows show each child paid-cost evidence.
    - Quiet no-child rollup still renders without paid-cost clutter.
    - Existing settlement, node links, unknown blockers, resume, and relation
      sections still render from updated fixtures.
  - Static negative checks:
    - No LLM/Gmail/external boundary:
      `rg -n "completeChat|LLM_PROXY_BASE_URL|gmail|Gmail|googleapis|chat/completions" shared/src/threads.ts server/src/services/thread-rollup.ts server/src/services/threads.ts server/src/repositories/threads.ts web/src/Thread.tsx`
    - No writes/migrations/routes:
      `git diff --name-only master...HEAD | rg 'server/drizzle|server/src/gmail|server/scripts|server/src/routes/threads.ts|web/src/Today|shared/src/today'`
      should have no matches.
- gas limit: N/A
- slither pass: N/A

## Missing Edge Case Candidates

- Historical bad data contains a hard `contains` cycle. Rollup must warn and
  avoid double-counting paid cost, just like progress/energy.
- A cancelled child event has `cancel_money=0` but non-empty `cancel_window` or
  social/effort evidence. It must count as an observed paid-cost event without
  inventing money.
- A parent and child both contain paid-cost events with malformed/unknown
  effort values. Known buckets must remain stable and unknown values must be
  bucketed as `unknown`, not dropped.

## Simpler Alternative

Leave parent rollup unchanged and require the user to open each child thread's
direct settlement. That avoids contract changes, but it defeats the purpose of
`FR-THR-10`: a parent thread should summarize confirmed hard-contained work.
Now that direct settlement and Gmail cost input exist, paid-cost rollup is the
smallest useful parent-level improvement.

## Assumptions

- Hard `contains` is confirmed enough to aggregate; soft/tentative relationships
  stay visible as relationships but are not rollup inputs.
- Existing settlement paid-cost semantics are correct for rollup: moved/cancelled
  events are actual paid-cost evidence; done/planned events are not.
- Avoided/missing monetary cost still has no reliable model. This cycle keeps it
  unavailable rather than guessing.
- No migration is needed because all required cost columns already exist on
  `events`.
- The Thread rollup section can stay in the existing `/threads/:id` screen
  without a new page or modal.

## Review Guidance

### Enumeration Needed

- Rollup contract and all required fixture updates:
  - Search:
    `rg -n "ThreadRollup|rollup|paidCost|missingCost|ThreadSettlementPaidCost" shared/src server/src web/src`
  - Expected: shared schema/types/tests, rollup service/repository integration,
    Thread UI/tests, and codebase map all agree on the new required `paidCost`
    fields.
- Rollup DB read and aggregation boundary:
  - Search:
    `rg -n "findEventsSlimByThreadIds|EventSlim|cancelMoney|cancelSocial|cancelEffort|cancelWindow|computeRollup|contains" server/src/repositories/threads.ts server/src/services/thread-rollup.ts server/src/services/thread-settlement.ts`
  - Expected: cost columns are read only for rollup inputs; aggregation happens
    in pure service code, not in the route.
- Negative scope:
  - Search:
    `rg -n "completeChat|LLM_PROXY_BASE_URL|gmail|Gmail|googleapis|chat/completions|db\\.update|\\.insert\\(|\\.delete\\(" shared/src/threads.ts server/src/services/thread-rollup.ts server/src/services/threads.ts server/src/repositories/threads.ts web/src/Thread.tsx`
  - Expected: no LLM/Gmail/external calls and no writes in the new rollup path.
- Frontend rollup surface:
  - Search:
    `rg -n "thread-rollup|rollup-paid|paidCost|누락 비용|치른 비용" web/src/Thread.tsx web/src/Thread.test.tsx web/src/styles.css`
  - Expected: paid-cost evidence is displayed as compact descriptive chips, not
    as a recommendation or score.

### Verification Guidance

- "Shared rollup payload requires paidCost":
  - Shared unit tests are sufficient for schema shape. Reviewer should confirm
    mocks across web tests were updated instead of bypassing validation with
    unchecked casts.
- "Paid cost aggregation is correct":
  - Pure service unit tests are necessary for deterministic bucket math.
  - SQLite integration tests are also required because the cost columns are in
    repository projections and hard `contains` traversal depends on real stored
    rows.
- "No write or external side effect":
  - Static grep is sufficient for LLM/Gmail/external boundaries, but row-count
    assertions in integration tests should prove `GET /api/threads/:id` remains
    read-only.
- "Frontend remains usable":
  - Vitest component tests should cover render states and updated fixtures.
  - Manual/code-level UI verification should check mobile width, wide width,
    light/dark tokens, reduced-motion neutrality, keyboard focus through child
    thread links, and no horizontal overflow in the rollup section.
