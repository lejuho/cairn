# Due Task Slot Preview A Implementation Plan

Branch: feature/cycle-62-due-task-slot-preview
Cycle: 62
Created: 2026-06-27
Skills: backend-fastify, frontend-react-pwa

## Summary

Remaining implementation specs after cycle 61:

- Event schedule prompts are implemented: Today surfaces unscheduled Cairn
  events, shows slot candidates, schedules a selected candidate, and supports a
  source-owned one-date dismiss marker.
- `FR-SLOT-08` and the actionable part of `FR-SLOT-09` are already substantially
  present for event slot candidates: the backend returns lens-level
  contributions and the Today UI renders evidence with adjustment links for
  feasibility, friction, and people.
- The major remaining `FR-SLOT-06` gap is due-imminent tasks. Tasks have `due`
  and `est_minutes`, but there is still no explicit task-to-event write
  contract for "select candidate -> create/schedule block". Implementing that
  mutation now would invent persistence semantics.
- Gmail parse fallback is still policy-undecided. Movement, GCal mirror,
  watcher-B automation, and Typst/pcli export are external-heavy or later-phase
  compared with the core slot workflow.

Recommended next spec: **FR-SLOT-06C Due Task Slot Preview A**.

This cycle adds due-task schedule prompts to Today and a read-only task slot
candidate preview. It uses only tasks that have a real due date and known
positive `est_minutes`, so the candidate duration is explicit rather than
guessed. It also adds a task-owned one-date dismiss marker. It does **not**
create events, link tasks to events, mutate task status, schedule tasks,
auto-apply a candidate, call LLM/external services, or change event slot
scheduling behavior.

## Input/Output Spec

- Input:
  - Existing `GET /api/today?date=<YYYY-MM-DD>&now=<RFC3339-with-offset>`.
  - Existing task rows.
  - New read-only candidate endpoint:
    - `GET /api/tasks/:id/slot-candidates?date=<YYYY-MM-DD>&now=<RFC3339-with-offset>&days=<1..14>`
  - New explicit dismiss action:
    - `PATCH /api/tasks/:id/schedule-prompt/dismiss`
    - Body:

```json
{
  "dismissedOn": "2026-06-27"
}
```

- Due-task prompt eligibility:
  - `tasks.status IN ('todo', 'doing')`
  - `tasks.due` is a real `YYYY-MM-DD` calendar date
  - `tasks.due <= todayDate + 7 days`
  - `tasks.est_minutes` is positive and non-null
  - `tasks.schedule_prompt_dismissed_on IS NULL OR != todayDate`
  - Sort by overdue first, then due date ascending, optional flag, id ascending.
  - Limit to three task prompts for Today.
- Output:
  - `GET /api/today` success extends the existing `TodaySurface` with:
    - `dueTaskSchedulePrompts: TaskRow[]`
    - `cards[]` entries of `{ kind: "task_schedule_prompt", task: TaskRow }`
  - Existing card priority is preserved; task schedule prompts are appended
    after event `schedule_prompt` cards.
  - `GET /api/tasks/:id/slot-candidates`:
    - Reuses the existing `SlotCandidate` shape.
    - Constructs a virtual Cairn event input from the task:
      - title = task title
      - threadId = task threadId
      - duration = task.estMinutes
      - type/location/mode = null unless existing candidate code requires a
        harmless default
    - Returns `200 { ok: true, data: { task, candidates } }`.
    - Does not write to SQLite.
  - `PATCH /api/tasks/:id/schedule-prompt/dismiss`:
    - Validates strict body.
    - Verifies the task is still prompt-eligible except for the current dismiss
      value.
    - Writes only `tasks.schedule_prompt_dismissed_on` and returns
      `200 { ok: true, data: { taskId, dismissedOn } }`.
    - Repeating the same dismiss is idempotent.
  - Failure:
    - Invalid id/query/body -> `400 VALIDATION_ERROR`.
    - Unknown task -> `404 NOT_FOUND`.
    - Known but ineligible task -> `409 TASK_SCHEDULE_PROMPT_NOT_ELIGIBLE`.
    - Failed UI dismiss/candidate fetch keeps the card visible with scoped
      failure copy.

## Key Changes

- Shared:
  - `shared/src/tasks.ts`
    - Add nullable optional `schedulePromptDismissedOn` to `TaskRowSchema` if
      task rows expose the new column.
    - Add strict `DismissTaskSchedulePromptRequestSchema`.
    - Add `DismissTaskSchedulePromptDataSchema`.
  - `shared/src/slots.ts`
    - Add `TaskSlotCandidatesResponseDataSchema` reusing
      `SlotCandidateSchema`.
  - `shared/src/today.ts`
    - Add `dueTaskSchedulePrompts` and `task_schedule_prompt` card variant.
  - Tests:
    - Schema tests for due task prompt cards, task slot candidate response, and
      strict dismiss request rejection of injected fields.
- Backend:
  - `server/src/db/schema.ts`
    - Add nullable `tasks.schedulePromptDismissedOn` mapped to
      `schedule_prompt_dismissed_on`.
  - `server/drizzle/0007_*.sql`
    - Add one nullable column with `ALTER TABLE tasks ADD COLUMN
      schedule_prompt_dismissed_on text;`
    - No table rebuild.
  - `server/src/repositories/tasks.ts`
    - Add `findDueTaskSchedulePrompts(db, todayDate, lookaheadDays)`.
    - Add `dismissTaskSchedulePromptForDate(db, taskId, dismissedOn)`.
    - Ensure eligibility checks do not mutate status, due, estimate, thread, or
      optional flag.
  - `server/src/routes/today.ts`
    - Load due task prompts and pass them into `buildTodaySurface`.
  - `server/src/services/today.ts`
    - Include `task_schedule_prompt` cards after event schedule prompts.
  - `server/src/routes/tasks.ts`
    - Add the task dismiss route.
    - Add the read-only task slot candidate route.
  - `server/src/services/slotCandidates.ts`
    - Refactor minimally so candidate duration can be supplied by task
      `estMinutes` while preserving existing event behavior.
    - Keep all scoring deterministic and read-only.
  - Tests:
    - SQLite integration for Today prompt eligibility/filtering/dismissal.
    - Route integration for read-only task candidates, idempotent dismiss, and
      ineligible task cases.
    - Unit coverage for candidate duration if the service is refactored.
- Frontend:
  - `web/src/Today.tsx`
    - Render due task schedule prompt cards with due date and estimate.
    - Add "후보 보기" to fetch task candidates and render them as preview-only
      evidence, not selectable schedule buttons.
    - Add dismiss action mirroring event prompt behavior.
    - Keep existing event schedule prompt candidate selection unchanged.
  - `web/src/Today.test.tsx`
    - Cover task prompt rendering, candidate preview, no schedule mutation on
      candidate tap, dismiss success/failure, and existing event prompt behavior.
- Docs:
  - `docs/codebase-map.md`
    - Record the task prompt column, Today task prompt aggregation, task slot
      preview route, and no-write boundary.

## Sprint Contract

- Passing criteria:
  - Today surfaces up to three due-imminent task schedule prompts that have a
    real due date and known positive estimate.
  - Done/dropped tasks, invalid due dates, missing estimates, and tasks dismissed
    for the current Today date are excluded.
  - Overdue tasks are included and sort before future due tasks.
  - Task prompt dismiss is source-owned, one-date, idempotent, and writes only
    `tasks.schedule_prompt_dismissed_on`.
  - Task slot candidates use the task's `est_minutes` as duration; no 60-minute
    fallback is used for tasks without estimates.
  - Task slot candidate route is read-only and returns existing decomposed
    `SlotCandidate` evidence.
  - Today renders task candidates as preview-only; there is no selectable
    schedule/apply button for task candidates.
  - Existing event schedule prompt flow still fetches event candidates, lets the
    user schedule an event, and keeps event dismiss behavior.
  - No event creation, task-event link creation, task status update, task due
    mutation, generic Today dismissal store, LLM call, Gmail/GCal mirror,
    external API, cron, or notification draft behavior is introduced.
  - UI remains mobile-first, semantic-token based, keyboard focusable, and
    touch targets are at least 44px.
  - `docs/codebase-map.md` reflects the boundary.
- Automatic checks:
  - `corepack pnpm db:generate`
  - `corepack pnpm lint`
  - `corepack pnpm typecheck`
  - `corepack pnpm test`
  - `corepack pnpm test:integration`
  - `corepack pnpm build`
  - `corepack pnpm verify`
  - `git diff --check master...HEAD`
- Test cases:
  - Shared/unit:
    - `TodaySurface` accepts `task_schedule_prompt` cards and rejects malformed
      variants.
    - task candidate response reuses strict `SlotCandidate` schemas.
    - dismiss request rejects missing/bad date and injected fields.
  - Migration/integration:
    - migrations create `tasks.schedule_prompt_dismissed_on`.
    - legacy task rows read with `NULL` dismissal.
  - Backend route/repository:
    - due today, overdue, and due within seven days tasks surface.
    - due after seven days, done/dropped, invalid due, and no-estimate tasks do
      not surface.
    - dismiss removes only the matching Today date and is idempotent.
    - task candidate route returns candidates using the task estimate duration.
    - task candidate route does not change row counts or mutate any task/event
      fields.
    - existing event slot routes still pass unchanged.
  - Frontend:
    - task schedule prompt renders due/estimate and preview CTA.
    - successful task candidate fetch renders preview-only candidates.
    - task candidate preview does not call event schedule endpoints.
    - task dismiss success removes/refetches away the card.
    - task dismiss/fetch failure keeps card visible with scoped copy.
    - existing event schedule prompt tests remain passing.
  - Static negative checks:
    - No task-to-event write:
      `git diff -U0 master...HEAD -- server/src shared/src web/src | rg -n 'insert\\(events\\)|insert\\(links\\)|task.*schedule|autoApply|apply'`
      must be inspected; expected matches are schema/test/UI copy only, not
      event/link creation.
    - No external/LLM/Gmail/GCal mirror:
      `git diff -U0 master...HEAD -- server/src shared/src web/src | rg -n 'completeChat|LLM_PROXY_BASE_URL|gmail|Gmail|googleapis|mirror|scheduler|cron'`
      should have no implementation matches.
    - Existing event scheduling preserved:
      inspect changes around event slot candidate and schedule handlers; no
      behavior change unless required by extracting shared candidate helpers.
- gas limit: N/A
- slither pass: N/A

## Missing Edge Case Candidates

- A task is overdue but has no estimate. It should not get guessed-duration
  candidates in this cycle; future work can surface an estimate-needed prompt.
- A task is dismissed just before midnight. The stored dismissal key is the
  explicit Today query date, not server wall-clock time.
- A task gains an estimate after previously being hidden for missing estimate.
  It should surface on the next Today fetch unless dismissed for that date.

## Simpler Alternative

Surface due tasks as plain Today cards with no candidate preview. That is
smaller, but it does not advance the Slot Suggestion promise: the user wants
candidate times with reasons. A read-only preview uses the existing slot scoring
surface while avoiding the unresolved task-to-event mutation contract.

## Assumptions

- `est_minutes` is the only reliable task duration source for this cycle.
- A task without an estimate should remain unknown rather than receive a default
  60-minute candidate.
- Due-imminent means overdue or due within seven days from the Today query
  `date`; this can become a parameter in a later cycle if needed.
- Task candidate preview may reuse the existing event slot candidate engine via
  a virtual event input, provided no DB write or fabricated event row is exposed
  as durable state.
- Selection/apply is future work and must explicitly define event creation,
  task-event link semantics, and conflict handling before implementation.

## Review Guidance

### Enumeration Needed

- Task prompt contract:
  - Search:
    `rg -n 'task_schedule_prompt|dueTaskSchedulePrompts|findDueTaskSchedulePrompts|schedulePromptDismissedOn|schedule_prompt_dismissed_on' shared/src server/src web/src server/drizzle docs/codebase-map.md`
  - Expected: shared Today/task schemas, tasks migration, repository filter,
    Today service/route wiring, task route, UI/tests, and docs agree.
- Candidate preview boundary:
  - Search:
    `rg -n 'TaskSlotCandidates|task slot|slot-candidates|estMinutes|DURATION_MINUTES|duration' shared/src server/src web/src`
  - Expected: task candidate route uses task estimate as duration; existing
    event candidate behavior remains compatible.
- Negative mutation scope:
  - Search:
    `git diff -U0 master...HEAD -- server/src shared/src web/src | rg -n 'insert\\(events\\)|insert\\(links\\)|update\\(tasks\\)|update\\(events\\)|PATCH|POST|apply|autoApply'`
  - Expected: the only task write is prompt dismissal; there is no event/link
    creation or task status/due mutation.
- Existing event flow:
  - Search:
    `rg -n 'schedule_prompt|events/.*/slot-candidates|events/.*/schedule|handleSchedule\\(' web/src/Today.tsx server/src`
  - Expected: event prompt flow still loads candidates and schedules selected
    events.

### Verification Guidance

- DB migration and due-task filtering:
  - Requires SQLite integration tests against a real temporary database.
- Candidate duration and read-only behavior:
  - Pure service/unit tests should cover duration math if extracted.
  - Route integration tests must assert no row count or field changes after
    candidate preview.
- Frontend behavior:
  - Component tests are sufficient for preview-only/no-wrong-network-call.
  - Manual/code-level UI verification should check mobile/wide layout,
    light/dark, reduced motion, keyboard focus, and 44px touch targets.
- Scope creep:
  - Reviewer should block if the cycle creates scheduled task events, adds link
    semantics, marks tasks done/doing, changes event slot scheduling behavior,
    or introduces external/LLM calls.
