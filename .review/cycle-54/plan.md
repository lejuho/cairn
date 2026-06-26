# Thread Missing Node Suggestions A Implementation Plan

Branch: feature/cycle-54-thread-missing-node-suggestions-a
Skills: backend-fastify, frontend-react-pwa

## Summary
Remaining implementation specs after cycle 53:

- `FR-THR-08` is still open. The spec requires missing-node suggestions from
  same-kind completed historical threads, with suggested nodes staying `soft`.
- `FR-CV-01` depends on completed thread goal + nodes + annotations +
  settlement. Cycle 53 added settlement, but CV extraction should wait until
  missing-node evidence is available so completed threads are less sparse.
- Slot/feasibility advanced slices remain valuable, but the current thread
  chain should finish `FR-THR-08` before moving to STAR/CV.

Cycle 54 implements a deterministic read-only A-slice of `FR-THR-08`: extend
`GET /api/threads/:id` with missing-node suggestions for the requested thread.
Suggestions are derived from direct `done` nodes in other completed threads
with the same exact `kind`. They are evidence cards only. This cycle does not
create nodes, confirm suggestions, copy historical order, infer dates, call an
LLM, or mutate thread status.

## Input/Output Spec
- Input:
  - Existing `GET /api/threads/:id`.
  - No new route body/query.
  - Existing direct thread data:
    - requested thread row
    - requested thread direct events/tasks
    - other completed same-kind thread rows and their direct events/tasks
- Output:
  - Success extends `ThreadDetail` with:
    - `missingNodeSuggestions: ThreadMissingNodeSuggestion[]`
  - `ThreadMissingNodeSuggestion` is a strict read-only object:
    - `id`: deterministic string, e.g. `missing-node:event:visa`
    - `nodeKind`: `"event" | "task"`
    - `title`: suggested node title copied from historical direct node title
    - `firmness`: literal `"soft"`
    - `source`: literal `"inferred"`
    - `evidenceThreadCount`: number of distinct completed same-kind threads
      that contain this direct done node title
    - `evidenceNodeCount`: number of historical direct done nodes contributing
      after per-thread duplicate collapse
    - `sampleThreads`: up to 3 historical `{id,name}` examples
    - `reasonCodes`: deterministic enum array
      - `missing_same_kind_completed_thread`
      - `missing_absent_from_current_thread`
      - `missing_repeated_evidence`
  - Failure:
    - Existing `GET /api/threads/:id` failures unchanged:
      - invalid id: `400 VALIDATION_ERROR`
      - unknown thread: `404 NOT_FOUND`
  - Side effects:
    - None. Read-only route extension only.

### Suggestion Rules
- Eligible target threads:
  - Current thread must have a non-empty `kind`.
  - Current thread must not be `done` or `dropped`; completed/dropped threads
    return an empty suggestion array in this A-slice.
- Eligible evidence threads:
  - `threads.status === "done"`.
  - `threads.kind` exactly equals the current thread kind.
  - `thread.id !== currentThread.id`.
- Eligible evidence nodes:
  - Direct nodes only. Contains descendants are excluded.
  - Historical events/tasks must have `status === "done"`.
  - Blank titles are ignored.
  - Duplicate normalized titles within the same historical thread are counted
    once for evidence purposes.
- Missing test:
  - Normalize title by trimming, lowercasing, and collapsing whitespace.
  - If the current thread already has a direct event/task with the same
    normalized title, no suggestion is emitted, regardless of node kind.
- Ordering:
  - Sort suggestions by `evidenceThreadCount` desc, then `evidenceNodeCount`
    desc, then `title` asc, then `nodeKind` asc.
  - Limit to 5 suggestions.
  - Do **not** copy historical sequence, start/end/due dates, link order, or
    dependency edges.
- No LLM, no scoring scalar, no recommendation text, no auto-apply, no DB
  mutation, no new route.

## Key Changes
- Shared:
  - Add strict schemas/types in `shared/src/threads.ts`:
    - `ThreadMissingNodeSuggestionReasonCodeSchema`
    - `ThreadMissingNodeSuggestionSchema`
  - Extend `ThreadDetailSchema` with required
    `missingNodeSuggestions: ThreadMissingNodeSuggestion[]`.
  - Reject injected fields such as `score`, `recommendation`, `advice`,
    `autoApply`, `apply`, `suggestedAction`, `estimatedMoney`, `suggestedStart`,
    `suggestedDue`, `order`, or `sequence`.
- Backend:
  - Add pure service `server/src/services/thread-missing-node-suggestions.ts`.
    - Inputs: current thread row, current direct events/tasks, completed
      same-kind thread rows, and their direct events/tasks.
    - Output: deterministic `ThreadMissingNodeSuggestion[]`.
    - No DB, no LLM, no time, no randomness, no mutation.
  - Add repository helper(s) in `server/src/repositories/threads.ts` only if the
    existing slim thread/event/task reads are insufficient:
    - list completed same-kind threads excluding current id
    - read direct event/task title/status data by thread ids
  - Wire the service into `getThreadDetail` in `server/src/services/threads.ts`.
  - No migration and no new route.
- Frontend:
  - Update `web/src/Thread.tsx`.
  - Add a read-only "빠진 것 후보" section on `/threads/:id` when
    `missingNodeSuggestions.length > 0`.
  - Each card shows title, kind, `soft/inferred` evidence, sample thread names,
    and a compact reason.
  - Use A temperature for active-work assistance; use semantic tokens only.
  - Do not add apply/confirm/create/CV controls in this cycle.
- Docs:
  - Update `docs/codebase-map.md` for the new shared contract, pure service,
    thread detail response field, and UI section.

## Sprint Contract
- Pass criteria:
  - `GET /api/threads/:id` includes required `missingNodeSuggestions`.
  - Threads with empty kind, `done`, or `dropped` status return no suggestions.
  - Only other completed same-kind threads contribute evidence.
  - Only direct historical `done` events/tasks contribute evidence.
  - Current direct node titles suppress matching suggestions.
  - Contains descendants, different-kind threads, active/paused/dropped
    historical threads, cancelled/moved/planned events, and todo/dropped tasks
    do not contribute.
  - Suggestions are deterministic, limited to 5, and sorted by evidence count
    then stable title/kind order.
  - Suggestions carry `firmness="soft"` and `source="inferred"`.
  - No historical order, start/end/due date, dependency edge, score,
    recommendation, or money estimate is copied.
  - Existing thread detail fields (`relations`, `rollup`, `nodeLinks`,
    `unknownBlockers`, `settlement`, progress, events, tasks) remain stable.
  - UI presents suggestions as descriptive evidence only; no apply, create,
    confirm, CV generation, or thread-status mutation.
  - Today, slot, feasibility, decision, watcher, mirror, resources, GCal,
    Telegram, and LLM behavior are not changed.
  - `docs/codebase-map.md` reflects the new boundary.
- Automatic checks:
  - `corepack pnpm db:generate`
  - `corepack pnpm verify`
  - `git diff --check master..HEAD`
  - Static deterministic-boundary scan:
    - `rg -n "ThreadMissingNodeSuggestion|missingNodeSuggestions|computeThreadMissingNodeSuggestions" shared/src server/src web/src`
    - Expected: new shared schemas, pure service, thread detail wiring,
      UI/tests, and docs only.
  - Static service isolation scan:
    - `rg -n "completeChat|gateway|Date\\.now|Math\\.random|db\\.|insert|update|delete" server/src/services/thread-missing-node-suggestions.ts`
    - Expected: no LLM, time, random, DB, or mutation.
  - Static no mutation / no speculative copy scan:
    - `git diff -U0 master..HEAD -- server/src shared/src web/src | rg -n "completeChat|parseThreadDraft|insert|update|delete|PATCH|POST|autoApply|recommendation|advice|score|estimatedMoney|suggestedAction|apply|suggestedStart|suggestedDue|order|sequence"`
    - Expected: no new LLM call, DB mutation, hidden apply flow, scalar score,
      recommendation, date inference, or sequence/order field for suggestions;
      matches should be reject tests or untouched context only.
  - Static scope scan:
    - `git diff -U0 master..HEAD -- server/src shared/src web/src docs/codebase-map.md | rg -n "slot-candidates|movement|procurement|gmail|googleapis|telegram|watcher|mirror|decision|resources/promotion|relations/ego|cv|STAR"`
    - Expected: no new implementation outside thread missing-node suggestions.
- Test cases:
  - Shared schema tests:
    - valid suggestion parses.
    - `ThreadDetailSchema` requires `missingNodeSuggestions`.
    - injected score/recommendation/advice/autoApply/apply/suggestedAction/
      estimatedMoney/suggestedStart/suggestedDue/order/sequence rejects.
  - Backend unit tests:
    - empty/current done/current dropped/no-kind target returns `[]`.
    - same-kind completed thread done nodes produce soft inferred suggestions.
    - current direct title suppresses suggestions across event/task kinds.
    - different-kind, non-done historical threads, contains descendants, and
      non-done historical nodes are excluded.
    - duplicate titles within one historical thread count once.
    - sorting and limit are deterministic.
    - result objects include reason codes in stable order and contain no
      suggested dates, order, score, or mutation fields.
  - Backend integration tests with real temporary SQLite:
    - `GET /api/threads/:id` returns suggestions for an active same-kind thread.
    - `GET /api/threads/:id` returns `[]` when no eligible evidence exists.
    - contains child thread nodes do not enter direct suggestions.
    - existing thread detail response still validates with relations, rollup,
      nodeLinks, unknownBlockers, and settlement.
  - Frontend tests:
    - suggestions section renders title/evidence/reason when suggestions exist.
    - empty suggestions render no noisy section.
    - render does not fire PATCH/POST and shows no apply/create/confirm/CV
      controls.
    - existing thread detail, rollup, node link, unknown blocker, and settlement
      tests remain stable.
- gas limit: N/A
- slither pass: N/A

## Missing Edge Case Candidates
- Current thread already has the same title as a task while the historical
  suggestion is an event. The A-slice suppresses by normalized title across
  both node kinds to avoid duplicate burden.
- Only one completed same-kind thread exists. The A-slice may still suggest
  from it, but displays evidence count so confidence is visible instead of
  pretending broad corpus support.
- Historical completed thread contains a child thread whose nodes match the
  target. This A-slice excludes descendants; contains-level pattern mining is
  future work.

## Simpler Alternative
Skip suggestions and move directly to STAR/CV extraction. That is faster on the
visible roadmap, but it would make CV depend on sparse/incomplete thread
spines. A small deterministic missing-node suggestion surface improves the
thread evidence layer without adding speculative generation or mutation.

## Assumptions
- Exact `threads.kind` equality is sufficient for this A-slice. No taxonomy,
  synonym, or embedding match is introduced.
- Title normalization is sufficient for missing detection. No semantic duplicate
  detection is introduced.
- Historical `done` direct nodes are reliable evidence; non-done historical
  nodes are not used as missing-node candidates.
- Suggestions are not persisted in this cycle. Acceptance/creation can be a
  later explicit cycle.
- The existing `links` dependency graph is not copied. FR-THR-08 says order
  replication is forbidden, so this cycle suggests standalone node titles only.

## Review Guidance
### Enumeration Required
- Locate every new contract and call site:
  - `rg -n "ThreadMissingNodeSuggestion|missingNodeSuggestions|computeThreadMissingNodeSuggestions" shared/src server/src web/src`
- Confirm the service is deterministic and isolated:
  - `rg -n "completeChat|gateway|Date\\.now|Math\\.random|db\\.|insert|update|delete" server/src/services/thread-missing-node-suggestions.ts`
  - Expected: no LLM, time, random, DB, or mutation.
- Confirm thread detail still returns all existing fields plus suggestions:
  - `rg -n "relations|rollup|nodeLinks|unknownBlockers|settlement|missingNodeSuggestions" server/src/services/threads.ts shared/src/threads.ts web/src/Thread.tsx`
- Confirm UI has no hidden mutation from suggestion rendering:
  - `rg -n "missingNodeSuggestions|fetch\\(|apiJson|PATCH|POST|apply|autoApply|confirm|create|STAR|cv" web/src/Thread.tsx web/src/Thread.test.tsx`

### Verification Method Guide
- Shared schema strictness:
  - Unit tests are sufficient.
- Suggestion computation:
  - Pure service unit tests are required and sufficient for title normalization,
    evidence aggregation, exclusion rules, sorting, and limit behavior.
- Route response shape:
  - Integration tests against a real temporary SQLite database are required.
- UI rendering / no mutation:
  - Component tests are sufficient for render/no-render and no extra request
    behavior.
- Full workspace safety:
  - `corepack pnpm verify` is required.
