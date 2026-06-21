# Thread Rollup A Implementation Plan

Branch: `feature/cycle-26-thread-rollup-a`
Cycle: `26`
Created: `2026-06-21`
Skills: backend-fastify, frontend-react-pwa, design-principles

## Summary

Cycle 25 made manual `thread_links` usable. Cycle 26 starts FR-THR-10 by
turning hard `contains` links into a read-only parent rollup on thread detail:
direct progress, descendant progress, descendant energy load, and drilldown
links.

This is Rollup A. It computes live data from existing tables and does not add
rollup cache, settlement, cancellation cascade, LLM inference, or new schema.

Goal:

- expose a deterministic `contains` rollup in `GET /api/threads/:id`;
- aggregate only confirmed hard `contains` descendants;
- show parent-vs-descendant progress and child drilldown on `/threads/:id`;
- keep unknown missing-cost/settlement data honest instead of fabricating it.

Out of scope:

- natural-language thread generation;
- node/link editing inside a thread;
- missing-node suggestions;
- missing-cost accounting or completed-thread settlement;
- parent cancellation cascade;
- context-switch scoring or sequence optimization;
- inferred/soft relationship generation;
- cached rollup tables, migrations, or new columns;
- LLM calls.

This is a partial delivery of FR-THR-10. Progress and energy roll up now;
missing-cost rollup remains explicitly unavailable until a cost model exists.

## Input/Output Contract

- Existing endpoints remain compatible:
  - `POST /api/threads`
  - `GET /api/threads`
  - `GET /api/threads/:id`
  - `POST /api/threads/:id/links`
  - `DELETE /api/threads/:id/links/:linkId`

- Extend `GET /api/threads/:id` detail:
  ```json
  {
    "thread": {},
    "events": [],
    "tasks": [],
    "progress": { "done": 1, "total": 3 },
    "relations": { "incoming": [], "outgoing": [] },
    "rollup": {
      "direct": {
        "progress": { "done": 1, "total": 3 },
        "energyHours": 2
      },
      "contains": {
        "childCount": 2,
        "descendantCount": 3,
        "progress": { "done": 4, "total": 7 },
        "energyHours": 5.5,
        "missingCost": null,
        "missingCostStatus": "unavailable"
      },
      "total": {
        "progress": { "done": 5, "total": 10 },
        "energyHours": 7.5,
        "missingCost": null,
        "missingCostStatus": "unavailable"
      },
      "children": [
        {
          "thread": { "id": 2, "name": "하위 스레드" },
          "depth": 1,
          "relationId": 10,
          "progress": { "done": 2, "total": 4 },
          "energyHours": 3,
          "descendantCount": 1
        }
      ],
      "warnings": []
    }
  }
  ```

- Rollup rules:
  - Include only `thread_links.kind="contains"` and `firmness="hard"`.
  - `direct` is the current thread's own events/tasks only.
  - `contains` is all hard contains descendants, excluding the current thread.
  - `total` is `direct + contains`.
  - `children` includes direct hard children first, then deeper descendants with
    `depth > 1`, ordered by depth, thread name, then id.
  - `energyHours` is deterministic event duration sum:
    - include events with valid `start` and `end`;
    - ignore unscheduled or malformed ranges;
    - clamp negative duration to 0;
    - tasks do not add energy in Rollup A.
  - `missingCost` stays `null` and `missingCostStatus="unavailable"` until a
    later missing-cost/settlement cycle defines the model.
  - Defensive graph traversal must not infinite-loop if historical bad data
    contains a cycle. It should visit each thread at most once and add a stable
    warning code, for example `CONTAINS_CYCLE_DETECTED`.

- Error behavior:
  - Existing `GET /api/threads/:id` 400/404 behavior remains unchanged.
  - Bad historical rollup graph data should not turn detail into 500.
  - Rollup computation must be deterministic and gateway-free.

## Key Changes

- Shared:
  - Extend `shared/src/threads.ts` with:
    - `ThreadRollupMetricSchema`;
    - `ThreadRollupBucketSchema`;
    - `ThreadRollupChildSchema`;
    - `ThreadRollupSchema`;
    - extended `ThreadDetailSchema.rollup`.
  - Reuse `ThreadProgressSchema`.
  - Export new types from the shared barrel if needed.

- Backend:
  - Add focused repository helpers in `server/src/repositories/threads.ts` or a
    new rollup repository module:
    - load hard `contains` adjacency with link ids;
    - load thread names for involved ids;
    - load direct event/task progress counts for a set of thread ids;
    - load event duration data for a set of thread ids.
  - Add a pure rollup service, for example `server/src/services/thread-rollup.ts`:
    - traverse hard contains descendants from a root id;
    - compute direct/contains/total progress;
    - compute direct/contains/total energy hours;
    - sort drilldown children deterministically;
    - guard cycles and duplicates with a visited set.
  - Extend `server/src/services/threads.ts` detail assembly with `rollup`.
  - Keep routes thin and unchanged unless parameter validation currently blocks
    the extended response.
  - Keep all behavior deterministic and independent from the LLM gateway.
  - No migration expected. If `db:generate` emits schema changes, stop and
    reassess scope before adding migration files.

- Frontend:
  - Extend `/threads/:id` live state with a compact `포함 롤업` section:
    - direct progress;
    - contains progress;
    - total progress;
    - direct/contains/total energy hours;
    - child drilldown cards linking to child threads.
  - Show honest missing-cost copy, for example `누락 비용 모델은 아직 없어`.
  - If no hard children exist, render a quiet state such as
    `포함된 하위 스레드가 아직 없어`.
  - If rollup warnings exist, show a small non-blocking warning.
  - Preserve existing relation section, empty-thread behavior, link create/delete
    behavior, and access-session recovery.
  - Use semantic tokens only, mobile-first layout, 44px targets, focus-visible
    states, and reduced-motion-safe rendering.

- Docs:
  - Update `docs/codebase-map.md` with the rollup shared schemas, backend
    service/repository ownership, and Thread UI rollup section.

## Sprint Contract

- Passing criteria:
  - Existing thread create/list/detail/link endpoints still pass.
  - `GET /api/threads/:id` includes a valid `rollup` object for every detail.
  - A thread with no hard contains children returns zero contains counts and a
    quiet-friendly rollup shape.
  - Hard contains descendants roll up progress across multiple depths.
  - Soft contains links, non-contains links, incoming parent links, and unrelated
    branches are not included in descendant rollup.
  - Direct/current-thread progress is not double-counted in descendants.
  - Event duration energy rollup includes valid scheduled events and ignores
    unscheduled/malformed ranges without throwing.
  - Historical cycle-like bad data cannot hang or crash rollup traversal.
  - Missing-cost fields remain explicit `null`/`unavailable`; no fabricated cost
    values are returned.
  - Thread UI renders rollup direct/contains/total metrics and child drilldown.
  - Thread UI preserves relation management, loading, quiet, live, error, and
    access-session behavior.
  - No automatic cascade, inferred links, sequencing optimization, LLM call, or
    migration is added.
  - `docs/codebase-map.md` is accurate and updated.

- Automatic checks:
  - `corepack pnpm db:generate`
  - `corepack pnpm test:integration`
  - `corepack pnpm verify`
  - `git diff --check`

- Test cases:
  - Shared unit:
    - valid rollup direct/contains/total payload parses;
    - invalid missingCostStatus/progress/child shapes fail;
    - extended `ThreadDetailSchema` requires `rollup`.
  - Pure backend unit:
    - hard contains chain A→B→C produces descendants B/C;
    - duplicate/cyclic historical adjacency visits each id once;
    - sorting is deterministic by depth/name/id;
    - soft/non-contains edges are excluded.
  - Backend integration with temporary SQLite:
    - parent detail includes direct, contains, and total rollup;
    - grandchild progress is included exactly once;
    - soft contains and `feeds` links do not affect rollup;
    - scheduled event durations sum to energy hours;
    - unscheduled events do not add energy;
    - detail endpoint still works without LLM gateway.
  - Frontend:
    - Thread detail renders no-child quiet rollup;
    - Thread detail renders direct/contains/total metrics;
    - child drilldown cards link to `/threads/:id`;
    - warning copy appears when warnings exist;
    - existing relation create/delete tests still pass;
    - access-session state remains covered.
  - Manual checks:
    - mobile and wide Thread rollup section;
    - light and dark themes;
    - keyboard focus through rollup links and relation controls;
    - 44px targets and reduced motion.

- gas limit: N/A
- slither pass: N/A

## Three Missing Edge-Case Candidates

- Historical data can contain invalid contains cycles if inserted before the
  invariant existed or through manual DB edits. Rollup must be defensive even
  though API creation rejects new cycles.
- A descendant can be reachable through multiple soft/hard paths if future
  relationship rules loosen. Rollup A should use a visited set now so later
  changes do not double-count.
- Energy duration can become misleading for all-day or malformed imported
  events. Rollup A should ignore malformed ranges and keep the calculation
  visibly approximate rather than over-precise.

## One Simpler Alternative

Only show direct child links and skip aggregate math. This would be safer, but
it would not advance FR-THR-10 meaningfully because the parent would still not
show whether its contained work is progressing. Live progress and energy
aggregation are the smallest useful rollup slice.

## Assumptions

- Cycle 25 already enforces normal API-created `contains` graph invariants.
- Rollup A treats only hard `contains` as confirmed enough to aggregate.
- Soft/inferred relationships should be visible as relationships but should not
  affect parent progress or energy until explicitly confirmed.
- Existing `events` and `tasks` status values are enough for progress:
  `done` counts as done; all other statuses count toward total only when they
  are currently included by existing thread progress logic.
- Energy can be approximated from event duration hours for now. Task energy and
  missing-cost models wait for later cycles.
- No new DB schema is needed.
- User's uncommitted `docs/cairn-spec.md` section 11 change is not part of this
  cycle unless explicitly pulled into a future plan.

## Review Guidance

### Enumeration Required

- Thread detail response contract:
  - Search: `rg -n "ThreadDetail|ThreadRollup|rollup|ThreadProgress" shared/src server/src web/src`
  - Expected: shared schemas/types, backend detail producer, Thread consumer, and
    tests all agree on required `rollup`.

- Contains graph traversal:
  - Search: `rg -n "threadLinks|thread_links|contains|firmness|rollup|adjacency" server/src`
  - Expected: rollup includes only hard `contains` edges and excludes soft or
    non-contains edges.

- Progress and energy ownership:
  - Search: `rg -n "doneCount|totalCount|energyHours|duration|start|end" server/src/repositories server/src/services`
  - Expected: repository reads minimal columns; pure service computes aggregate
    shape; routes do not contain SQL or rollup math.

- Frontend rollup UI:
  - Search: `rg -n "포함 롤업|rollup|missingCost|energyHours|Thread" web/src`
  - Expected: Thread detail owns the rollup display with tests for quiet/live
    states and child links.

- Scope creep boundaries:
  - Search: `rg -n "cascade|sequence|switch|completeChat|LLM_PROXY_BASE_URL|inferred|settlement|missing cost" server/src web/src shared/src`
  - Expected: no LLM call, no context-switch scoring, no cascade, no inferred
    relationship generation, and no fabricated missing-cost model.

- Migration boundary:
  - Search: `find server/drizzle -maxdepth 2 -type f -print | sort`
  - Expected: no new migration files unless `db:generate` proves a necessary
    schema change and the plan is amended before implementation.

### Verification Guide

- Rollup traversal and aggregation should have pure unit tests because graph
  behavior is deterministic and easy to regress.
- SQLite integration tests are still required for thread detail producer
  behavior, real status values, event duration reads, and no-LLM route behavior.
- Frontend tests may mock API responses but must verify visible rollup metrics,
  child links, warnings, and preservation of existing relation UI.
- Manual UI verification remains required until visual regression coverage
  exists: mobile/wide, light/dark, keyboard focus, 44px targets, reduced motion.
