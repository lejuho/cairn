# Thread Unknown Blocking A Implementation Plan

Branch: feature/cycle-52-thread-unknown-blockers-a
Skills: backend-fastify, frontend-react-pwa

## Summary
Remaining implementation specs after cycle 51:

- `FR-THR-04` unknown propagation is the best next step because cycle 51 now
  persists natural-language draft unknowns as `null` plus warnings, but
  `/threads/:id` does not yet explain which missing values block downstream
  scheduling/back-planning.
- `FR-THR-07` settlement is still incomplete beyond existing progress counts,
  but it depends on better completion/cost semantics and is less directly
  connected to the just-merged draft flow.
- `FR-THR-08` missing-node suggestions is still open, but it requires a corpus
  of comparable completed threads and has higher suggestion/overreach risk.

Cycle 52 implements a narrow deterministic A-slice of `FR-THR-04`: show
read-only "unknown blockers" on thread detail when a dependency link has a
downstream scheduled/due node but the upstream prerequisite lacks the minimum
duration/timing data needed for reverse planning. This cycle does **not**
perform reverse-date arithmetic, auto-schedule anything, infer missing values,
create nodes, or mutate dependency links.

## Input/Output Spec
- Input:
  - Existing `GET /api/threads/:id`.
  - No new route body/query.
  - Existing thread detail data: thread, events, tasks, and `nodeLinks`.
- Output:
  - Success extends `ThreadDetail` with:
    - `unknownBlockers: ThreadUnknownBlocker[]`
  - `ThreadUnknownBlocker` is a read-only diagnostic object:
    - `id`: stable string key, e.g. `link:<linkId>:<field>`
    - `linkId`: dependency link id
    - `linkKind`: existing link kind
    - `firmness`: existing link firmness
    - `source`: existing link source
    - `prerequisite`: `{ kind: "event"|"task", id, title }`
    - `blockedNode`: `{ kind: "event"|"task", id, title }`
    - `missingField`: one of the exact missing input fields, e.g.
      `task.estMinutes`, `event.start`, `event.end`
    - `blockedField`: blocked-node date/time field whose reverse planning is
      blocked, e.g. `event.start`, `task.due`
    - `message`: short user-facing Korean copy
    - `reasonCodes`: deterministic string enum array
  - Failure:
    - Existing `GET /api/threads/:id` failures unchanged:
      - invalid id: `400 VALIDATION_ERROR`
      - unknown thread: `404 NOT_FOUND`
  - Side effects:
    - None. Read-only route extension only.

### Blocker Rules
- Consider only in-thread event/task dependency links returned by
  `findThreadNodeLinks`.
- A-slice kind scope is `requires` and `blocks` only.
- Normalize link direction using the existing sequence-order convention:
  - `A requires B` means `B` must come before `A`; prerequisite=`to`,
    blockedNode=`from`.
  - `A blocks B` means `A` must come before `B`; prerequisite=`from`,
    blockedNode=`to`.
- A blocked node has a reverse-planning target when:
  - blocked event has `start`, or
  - blocked task has `due`.
- A prerequisite node blocks reverse planning when the blocked-node target exists
  and:
  - upstream task has `estMinutes == null`, or
  - upstream event has `start == null`, or
  - upstream event has `end == null`.
- Each missing field creates at most one blocker per link.
- `soft/inferred` links are diagnostics only. They still surface blockers, but
  the UI must visually keep firmness/source evidence and never treat them as
  confirmed facts.
- If either endpoint is missing or outside the thread, it is already excluded by
  `findThreadNodeLinks`; this cycle does not add a second orphan-link contract.
- If the blocked node has no date/time target (`event.start == null` and
  `task.due == null`), do not emit a blocker yet; there is no reverse-planning
  target to block.

## Key Changes
- Shared:
  - Add strict schemas/types in `shared/src/threads.ts`:
    - `ThreadUnknownBlockerMissingFieldSchema`
    - `ThreadUnknownBlockerBlockedFieldSchema`
    - `ThreadUnknownBlockerReasonCodeSchema`
    - `ThreadUnknownBlockerSchema`
  - Extend `ThreadDetailSchema` with required
    `unknownBlockers: ThreadUnknownBlocker[]`.
  - Reject injected fields such as `score`, `recommendation`, `advice`,
    `autoApply`, `suggestedStart`, `apply`, or `confirmed`.
- Backend:
  - Add pure service `server/src/services/thread-unknown-blockers.ts`.
    - Inputs are already-loaded thread events, tasks, and nodeLinks.
    - Returns sorted blockers only; no DB, no LLM, no mutation.
  - Wire the service in `server/src/routes/threads.ts` / existing detail helper
    so `GET /api/threads/:id` returns `unknownBlockers`.
  - Reuse existing repository reads; no migration and no new table.
- Frontend:
  - Update `web/src/Thread.tsx`.
  - Add a read-only "입력 필요" / unknown blockers section near the node-link
    section.
  - Render nothing when `unknownBlockers.length === 0` to preserve the current
    quiet thread detail shape.
  - For each blocker, show:
    - prerequisite node
    - blocked node
    - missing field copy
    - blocker reason
    - firmness/source evidence from the link context when available
  - Do not add an apply/schedule/confirm shortcut. Existing node edit buttons
    remain the way to fill missing fields.
- Docs:
  - Update `docs/codebase-map.md` for the new shared contract, pure service,
    `GET /api/threads/:id` response field, and UI section.

## Sprint Contract
- Pass criteria:
  - `GET /api/threads/:id` includes `unknownBlockers` for thread detail.
  - A normalized prerequisite task with missing `estMinutes` blocks a downstream
    scheduled event/due task and produces a deterministic blocker.
  - A normalized prerequisite event with missing `start` or `end` blocks a
    downstream scheduled event/due task and produces deterministic blockers.
  - No blocker is emitted when the blocked node has no schedule/due target.
  - No blocker is emitted for unrelated nodes or links outside the thread.
  - Existing thread detail fields (`relations`, `rollup`, `nodeLinks`,
    progress, events, tasks) remain stable.
  - The UI surfaces blockers as input-needed diagnostics only; no auto-apply,
    no auto-schedule, no hidden mutation.
  - Today, slot, feasibility, decision, watcher, mirror, resource, and LLM
    behavior are not changed.
  - `docs/codebase-map.md` reflects the new boundary.
- Automatic checks:
  - `corepack pnpm db:generate`
  - `corepack pnpm verify`
  - `git diff --check master..HEAD`
  - Static deterministic-boundary scan:
    - `rg -n "unknownBlockers|ThreadUnknownBlocker|computeThreadUnknownBlockers" shared/src server/src web/src`
    - Expected: new shared schemas, pure service, thread detail route wiring,
      and UI/tests only.
  - Static no LLM/mutation scan:
    - `git diff -U0 master..HEAD -- server/src shared/src web/src | rg -n "completeChat|parseThreadDraft|insert|update|delete|schedule|autoApply|recommendation|advice|score|suggestedStart|apply"`
    - Expected: no new LLM call or DB mutation for unknown blockers; matches
      are schema/tests or untouched context only.
  - Static scope scan:
    - `git diff -U0 master..HEAD -- server/src shared/src web/src docs/codebase-map.md | rg -n "slot-candidates|movement|procurement|gmail|googleapis|telegram|watcher|mirror|decision|resources/promotion|relations/ego"`
    - Expected: no new implementation outside thread detail unknown blockers.
- Test cases:
  - Shared schema tests:
    - valid blocker parses.
    - injected fields reject.
    - missing/blocked field enums reject unknown values.
    - `ThreadDetailSchema` requires `unknownBlockers`.
  - Backend unit tests:
    - `event requires task`: missing prerequisite task `estMinutes` with
      blocked event start emits one blocker.
    - `task requires event`: missing prerequisite event `start` and `end` can
      emit two blockers when blocked task has `due`.
    - `event blocks task`: missing prerequisite event fields can block a due
      task.
    - blocked node without event start/task due emits no blocker.
    - soft/inferred links produce diagnostics but do not change firmness/source.
    - sorting is deterministic.
  - Backend integration tests with real temporary SQLite:
    - `GET /api/threads/:id` returns blockers for normalized `requires` and
      `blocks` dependency chains.
    - unrelated thread links/nodes are not included.
    - existing thread detail response still validates with relations, rollup,
      and nodeLinks.
  - Frontend tests:
    - thread detail renders no unknown-blockers section when the array is empty.
    - thread detail renders blocker cards with prerequisite/blocked-node labels
      and missing-field copy.
    - blocker section does not call PATCH/POST on render.
    - existing node edit and node-link confirm tests remain stable.
- gas limit: N/A
- slither pass: N/A

## Missing Edge Case Candidates
- Link kinds other than `requires`/`blocks` may be semantically relevant later
  (`follows`, `triggers`, `caused_by`), but this A-slice skips them until their
  reverse-planning direction is explicitly specified.
- An upstream task has `estMinutes=0` impossible under current schema, but legacy
  or direct DB data may contain unexpected values; service should fail-open by
  treating only `null`/missing as unknown.
- A downstream event has `end` but no `start`; this cycle should not infer a
  target from `end` unless explicitly added and tested.

## Simpler Alternative
Only show generic "some fields are missing" warnings from the draft response.
That is simpler, but it loses propagation: after cycle 50/51 editing, the user
needs to know which specific missing prerequisite blocks which downstream node.
The selected approach is still read-only and deterministic while making the
unknown actionable.

## Assumptions
- Existing event/task nullable fields are enough for A-slice diagnostics; no DB
  migration is required.
- `findThreadNodeLinks` is the correct link enumeration because it already
  filters to event/task nodes inside the requested thread, but the service must
  still normalize `requires`/`blocks` direction before computing blockers.
- `task.estMinutes == null` is the only task duration unknown for this slice.
- Event reverse-planning completeness requires both `start` and `end`.
- The UI can guide the user to fill missing fields via existing node edit
  affordances; no new mutation endpoint is required.

## Review Guidance
### Enumeration Required
- Locate every new contract and call site:
  - `rg -n "ThreadUnknownBlocker|unknownBlockers|computeThreadUnknownBlockers" shared/src server/src web/src`
- Confirm the service is deterministic and isolated:
  - `rg -n "completeChat|gateway|Date\\.now|Math\\.random|db\\.|insert|update|delete" server/src/services/thread-unknown-blockers.ts`
  - Expected: no LLM, time, random, DB, or mutation.
- Confirm `GET /api/threads/:id` still returns all existing fields:
  - `rg -n "relations|rollup|nodeLinks|unknownBlockers" server/src/routes/threads.ts shared/src/threads.ts web/src/Thread.tsx`
- Confirm UI has no hidden mutation from blocker rendering:
  - `rg -n "unknownBlockers|fetch\\(|apiJson|PATCH|POST|schedule|apply|autoApply" web/src/Thread.tsx web/src/Thread.test.tsx`

### Verification Method Guide
- Shared schema strictness:
  - Unit tests are sufficient.
- Unknown blocker computation:
  - Pure service unit tests are required and sufficient for rule coverage and
    deterministic sorting.
- Route response shape:
  - Integration tests against a real temporary SQLite database are required.
- UI rendering / no mutation:
  - Component tests are sufficient for render/no-render and no extra request
    behavior.
- Full workspace safety:
  - `corepack pnpm verify` is required.
