# Thread STAR Draft A Implementation Plan

Branch: feature/cycle-55-thread-star-draft-a
Skills: backend-fastify, frontend-react-pwa

## Summary
Remaining implementation specs after cycle 54:

- `FR-THR-08` missing-node suggestions is implemented as a deterministic
  read-only evidence surface.
- `FR-CV-01` is now the next best prerequisite in the spec chain: completed
  threads have goal, direct nodes, annotations, settlement, and missing-node
  evidence. The next step is a bounded STAR draft extraction surface.
- `FR-CV-02` export should wait until STAR draft generation/editing semantics
  exist. Persisted resume fields from the spec can also wait; this cycle first
  proves the safe LLM boundary and schema.

Cycle 55 implements a non-persistent A-slice of `FR-CV-01`: add an LLM-backed
`POST /api/threads/:id/star-draft` endpoint and a small `/threads/:id` UI
surface that generates a strict STAR card draft for a completed thread. The
draft is evidence-grounded and user-editing/export are explicitly out of scope.
No thread columns, migrations, saved resume data, export, or auto-apply are
introduced in this cycle.

## Input/Output Spec
- Input:
  - `POST /api/threads/:id/star-draft`
  - No request body in this A-slice.
  - Route is registered only when `buildServer` has an `LlmGateway`, matching
    existing LLM-backed generation routes.
  - `id` must be a positive integer.
- Output:
  - Success `200`:
    - `{ ok: true, data: ThreadStarDraftResponseData }`
  - `ThreadStarDraftResponseData`:
    - `draft: ThreadStarDraft`
    - `evidence: ThreadStarDraftEvidence`
  - `ThreadStarDraft` strict object:
    - `situation`: non-empty string
    - `task`: non-empty string
    - `action`: non-empty string
    - `result`: non-empty string
    - `skills`: string array, max 8, items non-empty
    - `confidence`: `"draft"`
    - `reasonCodes`: deterministic enum array
      - `star_from_completed_thread`
      - `star_user_must_edit`
      - `star_result_uses_settlement`
  - `ThreadStarDraftEvidence` strict object:
    - `thread`: `{ id, name, kind, goal, deadline }`
    - `nodeTitles`: direct event/task titles used as source evidence
    - `annotationCount`: count of direct event annotations included
    - `settlement`: existing `ThreadSettlement`
    - `warnings`: string array for missing optional evidence such as no goal or
      no annotations
- Failure:
  - invalid id: `400 VALIDATION_ERROR`
  - unknown thread: `404 NOT_FOUND`
  - thread not complete (`thread.status !== "done"`): `409 THREAD_NOT_DONE`
  - LLM gateway unavailable/rate-limited/queue-full/invalid proxy response:
    `503 LLM_UNAVAILABLE`
  - LLM returns invalid JSON or schema-invalid STAR draft:
    `502 LLM_INVALID_DRAFT`
- Side effects:
  - None. This endpoint does not insert/update/delete any DB row.

### STAR Rules
- Eligible thread:
  - `thread.status === "done"` only.
  - Direct thread events/tasks are used; contains descendants are excluded from
    this A-slice.
- Evidence:
  - Thread `name`, `kind`, `goal`, `deadline`.
  - Direct events/tasks titles and statuses.
  - Direct event annotations joined by event id.
  - Existing deterministic `settlement` from `computeThreadSettlement`.
  - Missing-node suggestions are not sent to the model as facts; they are future
    improvement hints, not completed evidence.
- LLM boundary:
  - Add a dedicated parser module under `server/src/llm/`.
  - Use only the existing `LlmGateway.completeChat`.
  - Request strict JSON only; parse with `JSON.parse`; validate with shared
    `ThreadStarDraftSchema`.
  - On any gateway or validation failure, return explicit unavailable/invalid
    status. Never fabricate draft text.
- No persistence:
  - Do not add `resume_relevant`, `star_situation`, `star_action`,
    `star_result`, or `skills_tags` columns yet.
  - Do not mutate `threads`, `events`, `tasks`, or `annotations`.
  - Do not implement edit/save/export in this cycle.

## Key Changes
- Shared:
  - Add strict schemas/types, preferably in `shared/src/threads.ts` unless a
    dedicated `shared/src/starDraft.ts` fits existing export style better:
    - `ThreadStarDraftSchema`
    - `ThreadStarDraftEvidenceSchema`
    - `ThreadStarDraftResponseDataSchema`
  - Reject injected fields such as `score`, `recommendation`, `advice`,
    `autoApply`, `apply`, `suggestedAction`, `estimatedMoney`, `exaggerated`,
    `claim`, `exportPath`, `persist`, or `saved`.
- Backend:
  - Add `server/src/llm/threadStarDraftParser.ts`.
  - Add `server/src/services/threadStarDraft.ts`.
    - Loads thread detail evidence.
    - Enforces `status === "done"`.
    - Calls the parser via the gateway.
    - Returns no DB write.
  - Add `server/src/routes/threadStarDraft.ts`.
    - Thin Fastify route: validate id, call service, map result codes.
  - Register the route in `server/src/app.ts` only inside the existing
    `if (gateway)` block.
  - Add repository helper only if needed for direct event annotations by event
    ids. Keep it read-only.
- Frontend:
  - Update `web/src/Thread.tsx`.
  - On completed threads, show a small read-only B-temperature STAR draft
    surface near the settlement section:
    - button: `STAR 초안 만들기`
    - loading state while POST is in flight
    - generated draft cards for Situation/Task/Action/Result/Skills
    - scoped error for LLM unavailable/invalid draft
  - Hide the action for non-done threads.
  - Do not add editing, save, export, auto-apply, or recommendation controls.
- Docs:
  - Update `docs/codebase-map.md` for the new shared contract, LLM parser,
    service, route, and UI surface.

## Sprint Contract
- Pass criteria:
  - `POST /api/threads/:id/star-draft` exists when the app has an LLM gateway.
  - The route is not registered without a gateway; deterministic routes still
    work without a gateway.
  - Only completed threads can generate STAR drafts.
  - Unknown/invalid thread ids return the existing stable error shape.
  - LLM gateway failure returns `503 LLM_UNAVAILABLE` with no DB writes.
  - Invalid LLM JSON/schema returns `502 LLM_INVALID_DRAFT` with no DB writes.
  - Successful drafts validate against the strict shared schema.
  - Prompt/evidence includes completed thread goal/context, direct nodes,
    direct annotations, and settlement; contains descendants are excluded.
  - The draft explicitly remains `confidence: "draft"` and carries
    `star_user_must_edit`.
  - The model cannot inject score/recommendation/auto-apply/export/persist
    fields through the shared schema.
  - The UI exposes a completed-thread-only generation action and displays the
    generated draft as editable-later evidence, not as saved truth.
  - No migrations, no thread resume columns, no STAR persistence, no export,
    and no automatic CV claim storage in this cycle.
  - Today, slot, feasibility, decision, watcher, mirror, resources, GCal,
    Telegram, and deterministic thread detail behavior are not changed.
  - `docs/codebase-map.md` reflects the new boundary.
- Automatic checks:
  - `corepack pnpm db:generate`
  - `corepack pnpm verify`
  - `git diff --check master..HEAD`
  - Static boundary scan:
    - `rg -n "ThreadStarDraft|star-draft|threadStarDraft|parseThreadStarDraft" shared/src server/src web/src`
    - Expected: shared schemas, LLM parser, service, route/app registration,
      UI/tests, and docs only.
  - Static no persistence / no hidden mutation scan:
    - `git diff -U0 master..HEAD -- server/src shared/src web/src | rg -n "resume_relevant|star_situation|star_action|star_result|skills_tags|insert|update|delete|PATCH|PUT|DELETE|autoApply|recommendation|advice|score|estimatedMoney|exportPath|persist|saved"`
    - Expected: no DB mutation or persistence for STAR draft; matches are
      reject tests, route method declarations, or untouched context only.
  - Static LLM isolation scan:
    - `rg -n "completeChat|llm/gateway|parseThreadStarDraft|threadStarDraft" server/src`
    - Expected: only parser/service/route/app/tests for this feature, plus
      existing LLM-backed modules.
  - Static scope scan:
    - `git diff -U0 master..HEAD -- server/src shared/src web/src docs/codebase-map.md | rg -n "slot-candidates|movement|procurement|gmail|googleapis|telegram|watcher|mirror|decision|resources/promotion|relations/ego"`
    - Expected: no new implementation outside STAR draft A.
- Test cases:
  - Shared schema tests:
    - valid STAR draft response parses.
    - invalid confidence/reasonCode rejects.
    - injected score/recommendation/advice/autoApply/apply/suggestedAction/
      estimatedMoney/exportPath/persist/saved rejects.
  - LLM parser tests:
    - parses valid JSON content.
    - rejects non-JSON content.
    - rejects schema-invalid STAR draft.
    - propagates gateway unavailable/rate-limited/queue-full/invalid_response.
  - Backend integration tests with real temporary SQLite:
    - completed thread with direct nodes, annotations, and settlement returns a
      STAR draft using a mock gateway.
    - active/paused/dropped thread returns `409 THREAD_NOT_DONE`.
    - gateway unavailable returns `503 LLM_UNAVAILABLE`.
    - invalid LLM draft returns `502 LLM_INVALID_DRAFT`.
    - route is not registered without a gateway while existing deterministic
      `GET /api/threads/:id` still works.
    - DB row counts for threads/events/tasks/annotations remain unchanged after
      success and failure.
  - Frontend tests:
    - completed thread shows `STAR 초안 만들기`.
    - non-done thread hides the action.
    - clicking the action POSTs to `/api/threads/:id/star-draft` and renders
      Situation/Task/Action/Result/Skills.
    - LLM unavailable/invalid draft shows scoped error copy.
    - no save/export/apply controls are present.
- gas limit: N/A
- slither pass: N/A

## Missing Edge Case Candidates
- Completed thread has no goal or annotations. The route should still allow a
  draft but include warnings in evidence; the model must not invent missing
  facts as certainty.
- Settlement exists but avoided money is unavailable. The prompt must pass that
  status through so Result cannot claim a fabricated monetary impact.
- Gateway returns polished but schema-invalid output. The route must reject it
  instead of showing a partial draft.

## Simpler Alternative
Add persisted STAR columns first and defer generation. That matches the later
spec shape, but it creates storage/editing semantics before proving the LLM
boundary. A non-persistent strict draft endpoint is smaller, validates prompt
shape and failure behavior, and keeps user-edit/save/export for later cycles.

## Assumptions
- `ThreadSettlement` from cycle 53 is sufficient evidence for Result in this
  A-slice, even though avoided money remains unavailable.
- Direct event annotations are enough for the first STAR Action/Result draft;
  contains descendants and cross-thread evidence can be added later.
- STAR drafts are ephemeral until a future cycle defines persistence/editing.
- The existing Grok OAuth proxy gateway is the only LLM boundary.

## Review Guidance
### Enumeration Required
- Locate every new contract and call site:
  - `rg -n "ThreadStarDraft|star-draft|threadStarDraft|parseThreadStarDraft" shared/src server/src web/src`
- Confirm no STAR persistence or migration was added:
  - `git diff --name-only master..HEAD`
  - `git diff -U0 master..HEAD -- server/src shared/src web/src server/drizzle docs/codebase-map.md | rg -n "resume_relevant|star_situation|star_action|star_result|skills_tags|insert|update|delete|migration|drizzle"`
- Confirm route registration is gateway-scoped:
  - Inspect `server/src/app.ts` and `server/src/routes/threadStarDraft.ts`.
- Confirm deterministic thread detail remains gateway-independent:
  - Integration test must build `buildServer(db)` without gateway and still pass
    deterministic thread routes.

### Verification Method Guide
- Shared schema strictness:
  - Unit tests are sufficient.
- LLM parser behavior:
  - Unit tests with fake `LlmGateway` are required.
- Route response and no-write behavior:
  - Integration tests against a real temporary SQLite database are required.
- UI render / action behavior:
  - Component tests are sufficient for completed/non-completed visibility,
    POST call, result render, and scoped error states.
- Full workspace safety:
  - `corepack pnpm verify` is required.
