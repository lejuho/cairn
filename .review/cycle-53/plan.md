# Thread Settlement A Implementation Plan

Branch: feature/cycle-53-thread-settlement-a
Skills: backend-fastify, frontend-react-pwa

## Summary
Remaining implementation specs after cycle 52:

- `FR-THR-07` is still incomplete beyond existing done/total progress counts.
  The spec requires completed threads to show "paid cost + avoided missing
  cost"; current rollup still exposes `missingCostStatus: "unavailable"`.
- `FR-THR-08` missing-node suggestions is still open, but it should come after
  completed-thread settlement because it needs a reliable corpus of completed
  thread evidence.
- `FR-CV-01` STAR extraction also depends on completed thread
  goal+nodes+annotations+settlement, so settlement is the next prerequisite.

Cycle 53 implements a bounded deterministic A-slice of `FR-THR-07`: extend
`GET /api/threads/:id` with a read-only settlement summary for the requested
thread's direct nodes. It surfaces actual paid cost evidence from moved/cancelled
thread events and a conservative avoided-missing-cost count from done direct
nodes. It does **not** mark threads done, infer avoided money, mutate events,
run LLM extraction, implement CV export, or change contains rollup.

## Input/Output Spec
- Input:
  - Existing `GET /api/threads/:id`.
  - No new route body/query.
  - Existing direct thread data: thread, direct events, direct tasks.
- Output:
  - Success extends `ThreadDetail` with:
    - `settlement: ThreadSettlement`
  - `ThreadSettlement` is a read-only deterministic object:
    - `status`: `"not_ready" | "ready"`
      - `ready` only when `thread.status === "done"`.
      - `not_ready` for active/paused/dropped/null thread statuses.
    - `paidCost`: direct actual cost summary:
      - `eventCount`: number of direct moved/cancelled events considered.
      - `money`: sum of direct moved/cancelled `events.cancel_money`.
      - `social`: sum of direct moved/cancelled `events.cancel_social`.
      - `effort`: bucket counts for `none|low|medium|high|unknown`.
      - `windowCount`: direct moved/cancelled events with non-empty
        `cancel_window`.
    - `avoidedMissing`: conservative completion evidence:
      - `doneCount`: direct events/tasks with status `done`.
      - `totalCount`: direct events/tasks counted in progress denominator.
      - `knownAvoidedCount`: equals direct `doneCount` in this A-slice.
      - `unknownCostCount`: `max(0, totalCount - doneCount)`.
      - `money`: always `null`.
      - `moneyStatus`: `"unavailable"`.
    - `sampleStatus`: `"empty" | "partial" | "complete"`
      - `empty`: no direct countable nodes.
      - `complete`: totalCount > 0 and doneCount == totalCount.
      - `partial`: totalCount > 0 and doneCount < totalCount.
    - `reasonCodes`: deterministic string enum array.
  - Failure:
    - Existing `GET /api/threads/:id` failures unchanged:
      - invalid id: `400 VALIDATION_ERROR`
      - unknown thread: `404 NOT_FOUND`
  - Side effects:
    - None. Read-only route extension only.

### Settlement Rules
- Direct nodes only. Contains descendants remain represented by existing
  `rollup`, not this settlement A-slice.
- Countable direct nodes:
  - events with status not in `cancelled`
  - tasks with status not in `dropped`
  - This mirrors current progress semantics where cancelled/dropped are excluded
    from the denominator.
- Done direct nodes:
  - events/tasks whose status is exactly `done`.
- Paid cost:
  - Only direct events with status `moved` or `cancelled` are considered
    actual paid-cost evidence.
  - `money`: sum non-null `cancelMoney`; null/undefined treated as `0`.
  - `social`: sum non-null `cancelSocial`; null/undefined treated as `0`.
  - `effort`: bucket direct `cancelEffort`; blank/null/unrecognized becomes
    `unknown`.
  - `windowCount`: count non-empty trimmed `cancelWindow`.
- Avoided missing cost:
  - A-slice is intentionally conservative. It counts completed direct nodes as
    avoided-missing evidence, but does not invent monetary value.
  - `money` stays `null`; `moneyStatus="unavailable"`.
- No LLM, no scoring, no recommendation, no mutation.

## Key Changes
- Shared:
  - Add strict schemas/types in `shared/src/threads.ts`:
    - `ThreadSettlementStatusSchema`
    - `ThreadSettlementSampleStatusSchema`
    - `ThreadSettlementEffortBucketSchema`
    - `ThreadSettlementReasonCodeSchema`
    - `ThreadSettlementSchema`
  - Extend `ThreadDetailSchema` with required `settlement: ThreadSettlement`.
  - Reject injected fields such as `score`, `recommendation`, `advice`,
    `autoApply`, `apply`, `suggestedAction`, or `estimatedMoney`.
- Backend:
  - Add pure service `server/src/services/thread-settlement.ts`.
    - Inputs: already-loaded thread row, direct events, direct tasks.
    - Output: `ThreadSettlement`.
    - No DB, no LLM, no time, no randomness, no mutation.
  - Wire the service into `getThreadDetail` in `server/src/services/threads.ts`.
  - Reuse existing repository reads; no migration and no new route.
- Frontend:
  - Update `web/src/Thread.tsx`.
  - Add a read-only "정산" section on `/threads/:id`.
  - Render the full B-temperature settlement card only when
    `settlement.status === "ready"`.
  - For non-done threads, render no section or a quiet minimal note only if it
    does not clutter active work; no primary action in this cycle.
  - Show paid money/social/effort/window evidence and avoided-missing counts.
  - Do not add status mutation, apply, CV extraction, recommendation, or score.
- Docs:
  - Update `docs/codebase-map.md` for the new shared contract, pure service,
    thread detail response field, and UI section.

## Sprint Contract
- Pass criteria:
  - `GET /api/threads/:id` includes required `settlement`.
  - Settlement status is `ready` only when the direct thread row has
    `status='done'`.
  - Direct moved/cancelled events contribute paid money/social/effort/window
    evidence.
  - Done direct events/tasks contribute avoided-missing count evidence.
  - Incomplete direct nodes increase `unknownCostCount`; no avoided money is
    invented.
  - Cancelled events and dropped tasks stay excluded from the progress
    denominator and settlement avoided count.
  - Existing thread detail fields (`relations`, `rollup`, `nodeLinks`,
    `unknownBlockers`, progress, events, tasks) remain stable.
  - The UI presents settlement as descriptive evidence only; no score,
    recommendation, apply, CV generation, or thread-status mutation.
  - Today, slot, feasibility, decision, watcher, mirror, resources, GCal,
    Telegram, and LLM behavior are not changed.
  - `docs/codebase-map.md` reflects the new boundary.
- Automatic checks:
  - `corepack pnpm db:generate`
  - `corepack pnpm verify`
  - `git diff --check master..HEAD`
  - Static deterministic-boundary scan:
    - `rg -n "ThreadSettlement|settlement|computeThreadSettlement" shared/src server/src web/src`
    - Expected: new shared schemas, pure service, thread detail route wiring,
      UI/tests, and docs only.
  - Static no LLM/mutation scan:
    - `git diff -U0 master..HEAD -- server/src shared/src web/src | rg -n "completeChat|parseThreadDraft|insert|update|delete|PATCH|POST|autoApply|recommendation|advice|score|estimatedMoney|suggestedAction|apply"`
    - Expected: no new LLM call or DB mutation for settlement; matches are
      schema/tests or untouched context only.
  - Static scope scan:
    - `git diff -U0 master..HEAD -- server/src shared/src web/src docs/codebase-map.md | rg -n "slot-candidates|movement|procurement|gmail|googleapis|telegram|watcher|mirror|decision|resources/promotion|relations/ego|cv|STAR"`
    - Expected: no new implementation outside thread settlement A.
- Test cases:
  - Shared schema tests:
    - valid ready settlement parses.
    - valid not-ready settlement parses.
    - injected score/recommendation/apply/estimatedMoney rejects.
    - `ThreadDetailSchema` requires `settlement`.
  - Backend unit tests:
    - active thread with no nodes returns not-ready + empty sample.
    - done thread with all direct nodes done returns ready + complete sample.
    - moved/cancelled direct events aggregate money/social/effort/window.
    - cancelled event and dropped task are excluded from avoided denominator.
    - partial completion increments `unknownCostCount`.
    - null/blank/unrecognized effort buckets become `unknown`.
    - service has deterministic reason code ordering.
  - Backend integration tests with real temporary SQLite:
    - `GET /api/threads/:id` returns settlement for a done thread with direct
      events/tasks and cost fields.
    - contains child thread nodes do not enter direct settlement.
    - existing thread detail response still validates with relations, rollup,
      nodeLinks, and unknownBlockers.
  - Frontend tests:
    - ready settlement renders the settlement section with paid and avoided
      evidence.
    - non-ready settlement does not render the full settlement card.
    - settlement render does not fire PATCH/POST or show apply/CV controls.
    - existing thread detail, rollup, node link, and unknown blocker tests remain
      stable.
- gas limit: N/A
- slither pass: N/A

## Missing Edge Case Candidates
- A thread marked `done` while direct nodes are still incomplete. This cycle
  should surface `sampleStatus="partial"` instead of auto-correcting status.
- Moved/cancelled event has `cancelMoney=0` but non-empty effort/window. It must
  still count as paid-cost evidence because non-money cost matters.
- Completed child thread under hard contains has cost evidence. This A-slice
  should not include it in direct settlement; contains rollup/settlement can be
  a later cycle.

## Simpler Alternative
Only keep the existing header progress chip and postpone settlement. That keeps
the UI smaller, but it blocks the next product chain: missing-node suggestions
and CV extraction both need a completed-thread evidence surface. A direct
read-only settlement summary gives that surface without introducing mutation or
speculative cost estimates.

## Assumptions
- Thread status can already be `done` in persisted data even though this cycle
  does not add a thread-status mutation UI/API.
- Current event cost columns (`cancelMoney`, `cancelSocial`, `cancelEffort`,
  `cancelWindow`) are the correct paid-cost source for A-slice settlement.
- `events.status='cancelled'` remains excluded from progress denominator, but
  still contributes to paid cost because cancellation itself is a cost event.
- Avoided missing cost cannot be priced from current schema without fabrication,
  so `money` remains unavailable.
- Settlement is direct-thread only; contains aggregation remains future work.

## Review Guidance
### Enumeration Required
- Locate every new contract and call site:
  - `rg -n "ThreadSettlement|settlement|computeThreadSettlement" shared/src server/src web/src`
- Confirm the service is deterministic and isolated:
  - `rg -n "completeChat|gateway|Date\\.now|Math\\.random|db\\.|insert|update|delete" server/src/services/thread-settlement.ts`
  - Expected: no LLM, time, random, DB, or mutation.
- Confirm `GET /api/threads/:id` still returns all existing fields:
  - `rg -n "relations|rollup|nodeLinks|unknownBlockers|settlement" server/src/services/threads.ts shared/src/threads.ts web/src/Thread.tsx`
- Confirm UI has no hidden mutation from settlement rendering:
  - `rg -n "settlement|fetch\\(|apiJson|PATCH|POST|apply|autoApply|STAR|cv" web/src/Thread.tsx web/src/Thread.test.tsx`

### Verification Method Guide
- Shared schema strictness:
  - Unit tests are sufficient.
- Settlement computation:
  - Pure service unit tests are required and sufficient for aggregation and
    deterministic reason-code coverage.
- Route response shape:
  - Integration tests against a real temporary SQLite database are required.
- UI rendering / no mutation:
  - Component tests are sufficient for render/no-render and no extra request
    behavior.
- Full workspace safety:
  - `corepack pnpm verify` is required.
