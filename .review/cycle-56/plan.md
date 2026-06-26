# Thread Resume STAR Save/Edit A Implementation Plan

Branch: feature/cycle-56-thread-resume-star-save-a
Skills: backend-fastify, frontend-react-pwa

## Summary
Remaining implementation specs after cycle 55:

- `FR-CV-01` has an ephemeral LLM-backed STAR draft endpoint and completed-thread
  UI surface, but the draft is not saved or editable.
- `FR-CV-02` export should not come next yet: exporting an unreviewed ephemeral
  LLM draft would violate the "AI draft -> user edit" and "suggestion only"
  boundaries.
- The spec's CV section explicitly places resume data on `threads`, not on
  `annotations`. That makes thread-level resume fields the next prerequisite.

Cycle 56 implements a bounded A-slice of `FR-CV-01/03`: add the spec-listed
resume fields to `threads`, expose them in thread detail, and allow the user to
save/edit them only on completed threads. This is deterministic persistence and
UI editing only. It does not add export, Typst/Markdown generation, scoring,
recommendations, automatic CV claims, or any new LLM call.

## Input/Output Spec
- Migration / storage:
  - Add nullable/spec-listed thread resume columns:
    - `resume_relevant` integer boolean, default `0`, CHECK in `(0,1)`
    - `star_situation` text nullable
    - `star_action` text nullable
    - `star_result` text nullable
    - `skills_tags` text nullable JSON array of strings
  - Do not add `star_task` in this cycle. The current spec does not define a
    `star_task` column; Task remains generated/display-only until a future spec
    amendment defines storage/export semantics.
- `GET /api/threads/:id`:
  - Include `resume: ThreadResumeData` in `ThreadDetail`.
  - `ThreadResumeData`:
    - `resumeRelevant: boolean`
    - `starSituation: string | null`
    - `starAction: string | null`
    - `starResult: string | null`
    - `skillsTags: string[]`
  - Invalid/malformed legacy `skills_tags` JSON is treated as `[]` and never
    fabricates skills.
- `PATCH /api/threads/:id/resume`:
  - Deterministic route in the DB-backed thread route boundary.
  - No LLM gateway registration requirement.
  - `id` must be a positive integer.
  - Body is strict and must contain at least one key:
    - `resumeRelevant?: boolean`
    - `starSituation?: string | null`
    - `starAction?: string | null`
    - `starResult?: string | null`
    - `skillsTags?: string[]`
  - Text fields are trimmed; blank strings are stored as `NULL`.
  - `skillsTags` items are trimmed, must be non-empty after trim, max 8 items,
    and are stored as a JSON array preserving user order.
- Output:
  - Success `200`:
    - `{ ok: true, data: ThreadResumeData }`
  - Failure:
    - invalid id/body: `400 VALIDATION_ERROR`
    - unknown thread: `404 NOT_FOUND`
    - thread not complete (`thread.status !== "done"`): `409 THREAD_NOT_DONE`
    - DB constraint/serialization failure: `400 DB_ERROR`
- Side effects:
  - Only the five resume columns on the target `threads` row may change.
  - No writes to `events`, `tasks`, `annotations`, `links`, `thread_links`,
    `resources`, or `watchers`.

## Key Changes
- Shared:
  - Add strict resume schemas/types, preferably in `shared/src/threads.ts`:
    - `ThreadResumeDataSchema`
    - `PatchThreadResumeRequestSchema`
    - `PatchThreadResumeResponseDataSchema`
  - Extend `ThreadDetailSchema` with `resume`.
  - Reject injected fields such as `task`, `starTask`, `score`,
    `recommendation`, `advice`, `autoApply`, `apply`, `claim`, `exportPath`,
    `persist`, `saved`, or `format`.
- Backend:
  - Update `server/src/db/schema.ts` and generate a Drizzle migration adding
    the five resume columns to `threads`.
  - Add repository helpers in `server/src/repositories/threads.ts`:
    - parse `skills_tags` safely into `string[]`
    - build `ThreadResumeData` from a thread row
    - update only the specified resume columns
  - Extend `getThreadDetail` to include `resume`.
  - Add `PATCH /api/threads/:id/resume` to `server/src/routes/threads.ts` or a
    small dedicated route registered in the existing `if (db)` block.
  - Keep route thin: validate id/body, check thread existence/status, call one
    update helper/service, map result codes.
- Frontend:
  - Update `web/src/Thread.tsx`.
  - On completed threads, keep the existing STAR draft generation surface and
    add a B-temperature saved resume editor/display nearby:
    - show saved Situation/Action/Result/Skills from `detail.resume`
    - allow user editing with explicit Save
    - allow marking/unmarking `resumeRelevant`
    - after generating an ephemeral STAR draft, offer an explicit "save to
      resume fields" action that maps situation/action/result/skills only
  - Hide save/edit controls for non-done threads.
  - Do not add export, download, Typst/Markdown, auto-apply, scoring, or
    recommendation controls.
- Docs:
  - Update `docs/codebase-map.md` for the new thread resume columns, shared
    contract, route, repository helper, and UI surface.

## Sprint Contract
- Pass criteria:
  - `threads` has exactly the five spec-listed resume columns.
  - Migration is generated and applies cleanly to a temporary SQLite database.
  - `ThreadDetail` includes `resume` with stable defaults:
    - `resumeRelevant=false`
    - text fields `null`
    - `skillsTags=[]`
  - `PATCH /api/threads/:id/resume` succeeds only for completed threads.
  - Unknown/invalid thread ids return the existing stable error shape.
  - Invalid body and injected fields return `400 VALIDATION_ERROR`.
  - Updating one resume field does not clear unspecified resume fields.
  - Blank text clears to `NULL`; `skillsTags=[]` clears skills.
  - `skillsTags` is stored as JSON and parsed back as an array.
  - The route mutates only the target `threads` row resume columns.
  - The existing `POST /api/threads/:id/star-draft` remains ephemeral and does
    not write to DB.
  - The UI exposes completed-thread-only save/edit controls and presents saved
    resume fields as user-owned editable data, not as automatic truth.
  - The UI does not expose export/download/apply/recommend/score controls.
  - No new LLM calls, parser prompts, gateway wiring, Gmail, GCal, Telegram,
    watcher, mirror, slot, decision, resource, relation, or movement behavior.
  - `docs/codebase-map.md` reflects the new boundary.
- Automatic checks:
  - `corepack pnpm db:generate`
  - `corepack pnpm verify`
  - `git diff --check master..HEAD`
  - Static resume boundary scan:
    - `rg -n "ThreadResume|resumeRelevant|starSituation|starAction|starResult|skillsTags|resume_relevant|star_situation|star_action|star_result|skills_tags" shared/src server/src web/src server/drizzle docs/codebase-map.md`
    - Expected: shared schemas, DB schema/migration, thread repository/service
      reads/writes, route, UI/tests, and docs only.
  - Static no-export / no-new-LLM scan:
    - `git diff -U0 master..HEAD -- shared/src server/src web/src server/drizzle docs/codebase-map.md | rg -n "star_task|Typst|markdown|download|exportPath|format|completeChat|parseThreadStarDraft|llm/gateway|Gmail|googleapis|telegram|watcher|slot-candidates|movement|relations/ego|resources/promotion"`
    - Expected: no implementation matches except reject-field tests or existing
      docs/codebase-map context explicitly explaining out-of-scope export.
  - Static write-scope scan:
    - `git diff -U0 master..HEAD -- server/src | rg -n "insert\\(|delete\\(|update\\((events|tasks|annotations|links|threadLinks|resources|watchers)|\\.set\\("`
    - Expected: only the thread resume update helper mutates, and only resume
      columns are set.
  - Migration enumeration:
    - Inspect the generated SQL migration. Expected additions only:
      `resume_relevant`, `star_situation`, `star_action`, `star_result`,
      `skills_tags`; no `star_task`, export, or unrelated table changes.
- Test cases:
  - Shared schema tests:
    - default/valid `ThreadResumeData` parses.
    - `PatchThreadResumeRequest` trims text, converts blanks to null, accepts
      `skillsTags` max 8, and rejects blank skill entries.
    - injected task/score/recommendation/export/apply fields reject.
  - Backend integration tests with a real temporary SQLite database:
    - migration-backed `GET /api/threads/:id` returns default resume data.
    - completed thread `PATCH /resume` saves all fields and `GET` returns them.
    - partial patch preserves unspecified fields.
    - null/blank text clears fields; empty skills array clears skills.
    - active/paused/dropped thread returns `409 THREAD_NOT_DONE` and writes
      nothing.
    - unknown/invalid id and invalid body return expected errors.
    - row-count or before/after checks prove no events/tasks/annotations/links
      mutation.
  - Frontend tests:
    - completed thread shows saved resume section and save/edit controls.
    - non-done thread hides save/edit controls.
    - editing fields sends `PATCH /api/threads/:id/resume` and updates the
      displayed saved values.
    - generated STAR draft can be explicitly saved to resume fields.
    - failed save shows scoped error and preserves local/deterministic view.
    - no export/download/apply/recommend/score controls are present.
- gas limit: N/A
- slither pass: N/A

## Missing Edge Case Candidates
- Legacy or manually corrupted `skills_tags` contains invalid JSON. The detail
  view must fail open to `[]`, not crash or fabricate skills.
- User patches only `resumeRelevant=false` after saving STAR fields. The toggle
  should unmark the candidate without silently deleting saved fields.
- User generates a STAR draft with a Task field from cycle 55. This cycle must
  not invent a `star_task` storage field; save only spec-listed fields and make
  that mapping explicit in UI/tests.

## Simpler Alternative
Implement FR-CV-02 export directly from the ephemeral cycle-55 draft. That is
faster, but it exports unapproved LLM text and leaves no thread-level source of
truth. Persisting and editing the spec-listed thread fields first is the safer
step and keeps export as a later pure read/formatting cycle.

## Assumptions
- The CV spec intentionally stores resume data on `threads`, not annotations.
- `star_task` is omitted from persistence because the current spec does not
  define it. Future export can derive Task from thread goal/name or add a
  separate spec amendment before implementing Task persistence.
- Resume editing is allowed typing because this is a user-owned post-hoc CV
  artifact; it is not part of ordinary daily capture.

## Review Guidance
### Enumeration 필요 항목
- Confirm exact new thread columns:
  - Search: `rg -n "resume_relevant|star_situation|star_action|star_result|skills_tags|star_task" server/src/db/schema.ts server/drizzle`
  - Expected: the five spec-listed columns only; `star_task` absent.
- Confirm all resume API/shared/UI touchpoints:
  - Search: `rg -n "ThreadResume|resumeRelevant|starSituation|starAction|starResult|skillsTags|/resume" shared/src server/src web/src`
  - Expected: shared schema/tests, repository/service/route/integration tests,
    Thread UI/tests.
- Confirm no export or new LLM path:
  - Search: `git diff -U0 master..HEAD -- shared/src server/src web/src docs/codebase-map.md | rg -n "Typst|markdown|download|exportPath|completeChat|llm/gateway|recommendation|score|autoApply"`
  - Expected: no implementation matches except strict reject tests.

### 검증 방식 가이드
- Migration and SQLite behavior:
  - Mock tests are insufficient. Use Drizzle-generated migration plus real
    temporary SQLite integration tests.
- Write-scope guarantee:
  - Unit tests are insufficient. Integration tests should compare row counts or
    before/after snapshots for events/tasks/annotations/links around
    `PATCH /api/threads/:id/resume`.
- UI save/edit behavior:
  - Use Vitest/Testing Library to assert completed-only controls, PATCH body,
    scoped error, and absence of export/apply/recommendation controls.
- LLM boundary:
  - This cycle should need no LLM tests beyond ensuring cycle-55 draft remains
    ephemeral. Any new `completeChat` usage is scope creep.
