# Task Slot Apply A Implementation Plan

Branch: feature/cycle-63-due-task-slot-apply
Cycle: 63
Created: 2026-06-27
Skills: backend-fastify, frontend-react-pwa

## Summary

Remaining implementation specs after cycle 62:

- `FR-SLOT-06C` now surfaces due-imminent task schedule prompts and shows
  read-only task slot candidates. The sharp remaining core-slot gap is
  `FR-SLOT-07`: selecting one of those task candidates should create a scheduled
  block.
- The useful `FR-SLOT-08/09` evidence surface is already present for slot
  candidates: lens-level contributions render in Today, and event candidates
  already link feasibility/friction/people evidence to relevant views.
- Gmail parse fallback remains policy-undecided. Movement, GCal mirror,
  watcher-B automation, and Typst/pcli export are external-heavy or later-phase.

Recommended next spec: **FR-SLOT-07A Task Slot Apply A**.

This cycle turns due-task candidate preview into an explicit apply flow. The
apply action creates one scheduled Cairn event from the selected task candidate
and records that event on the task through a nullable source-owned marker:
`tasks.scheduled_event_id`. This avoids overloading dependency `links` with a
"scheduled by" meaning they do not currently have. The task remains a task:
status, due, estimate, optional flag, and thread assignment are not changed.

## Input/Output Spec

- Input:
  - Existing Today due-task prompt and task candidate preview.
  - New apply endpoint:
    - `POST /api/tasks/:id/schedule-block`
    - Strict body:

```json
{
  "date": "2026-06-27",
  "now": "2026-06-27T09:00:00+09:00",
  "days": 7,
  "start": "2026-06-28T14:00:00+09:00",
  "end": "2026-06-28T15:30:00+09:00"
}
```

- Normal apply:
  - Validates task id and body.
  - Loads the task.
  - Verifies it is still eligible for due-task slot scheduling:
    - `status IN ('todo', 'doing')`
    - real `due`
    - positive `est_minutes`
    - due within the configured lookahead from `date`
    - no active scheduled block already recorded.
  - Recomputes task candidates from the supplied `date`, `now`, and `days`.
  - Requires an exact `start` + `end` match in the recomputed candidate list.
  - In one transaction:
    - inserts one scheduled Cairn event:
      - `title = task.title`
      - `thread_id = task.thread_id`
      - `start/end = selected candidate`
      - `type = 'task'`
      - `mode = 'async'`
      - `source = 'cairn'`
      - `self_imposed = 1`
      - `status = 'planned'`
    - updates only `tasks.scheduled_event_id` to the inserted event id.
  - Returns `201 { ok: true, data: { task, event } }`.
  - A subsequent Today fetch excludes the task prompt because it now has an
    active scheduled block.
- Failure:
  - Invalid id/body -> `400 VALIDATION_ERROR`.
  - Unknown task -> `404 NOT_FOUND`.
  - Known but no longer eligible -> `409 TASK_SCHEDULE_PROMPT_NOT_ELIGIBLE`.
  - Task already has an active scheduled block -> `409 TASK_ALREADY_SCHEDULED`.
  - Selected candidate is no longer in the recomputed candidate list -> `409
    TASK_SLOT_STALE`.
  - All failure paths write nothing.

## Key Changes

- Shared:
  - `shared/src/tasks.ts`
    - Add optional nullable `scheduledEventId` to `TaskRowSchema`.
  - `shared/src/slots.ts`
    - Add strict `ScheduleTaskBlockRequestSchema`.
    - Add `ScheduleTaskBlockResponseDataSchema` with `{ task, event }`.
    - Export types.
  - Tests:
    - Schedule body validates start/end/date/now/days.
    - End-before-start, malformed date/now, missing fields, and injected fields
      reject.
    - Response schema requires task + event and rejects injected apply/score
      fields.
- Backend:
  - `server/src/db/schema.ts`
    - Add nullable `tasks.scheduledEventId` mapped to `scheduled_event_id`,
      referencing `events.id` if SQLite/Drizzle permits the nullable FK via
      `ALTER TABLE`.
  - `server/drizzle/0008_*.sql`
    - Add one nullable column. No table rebuild.
  - `server/src/repositories/tasks.ts`
    - Extend task rows with `scheduled_event_id`.
    - Exclude tasks with an active scheduled block from
      `findDueTaskSchedulePrompts`.
    - Add helpers to detect an active scheduled block:
      - active means the referenced event exists, has non-null start/end,
        `source='cairn'`, `self_imposed=1`, and status in
        `planned|confirmed|done`.
      - cancelled/moved/missing referenced events are not active, so the task
        can surface again.
    - Add a transactional helper that creates the scheduled event and sets
      `scheduled_event_id`.
  - `server/src/routes/tasks.ts`
    - Add `POST /api/tasks/:id/schedule-block`.
    - Keep handler thin: validate -> load/revalidate -> recompute candidates ->
      transactional repository write -> typed response.
  - `server/src/services/slotCandidates.ts`
    - Reuse the cycle-62 task candidate generator for revalidation.
    - Do not change existing event candidate semantics.
  - Tests:
    - SQLite integration for apply success, stale candidate rejection,
      already-scheduled rejection, prompt exclusion after apply, and no writes
      on failure.
    - Existing event slot route tests remain passing.
- Frontend:
  - `web/src/Today.tsx`
    - Turn task candidate preview rows into explicit apply controls.
    - The action copy must indicate this creates a schedule block, not that the
      task is done.
    - On success, refresh Today and clear local task slot state.
    - On failure, keep the task prompt visible with scoped error feedback.
    - Preserve event schedule prompt behavior unchanged.
  - `web/src/Today.test.tsx`
    - Task candidate apply calls only the task schedule-block endpoint.
    - Success refreshes Today/removes the card.
    - Stale/failure response leaves the card visible with scoped copy.
    - Task apply does not call event schedule endpoints and does not patch task
      status.
    - Existing event schedule prompt tests remain passing.
- Docs:
  - `docs/codebase-map.md`
    - Record `tasks.scheduled_event_id`, task schedule-block route, prompt
      exclusion behavior, and no task-status mutation boundary.

## Sprint Contract

- Passing criteria:
  - A due-task candidate can be explicitly applied from Today.
  - Applying creates exactly one scheduled Cairn event with the task title,
    task thread, selected start/end, `type='task'`, `mode='async'`,
    `source='cairn'`, `self_imposed=1`, and `status='planned'`.
  - Applying updates only `tasks.scheduled_event_id` on the task.
  - Task status, due, estimate, optional flag, context, and thread id are not
    mutated.
  - The apply route recomputes candidates and rejects stale start/end pairs.
  - A task with an active scheduled block is excluded from due-task Today
    prompts and cannot receive a second active block through this route.
  - Cancelled/moved/missing scheduled block events do not permanently suppress
    the task prompt.
  - All failure paths are all-or-none: no event without task marker, no marker
    without event.
  - Existing event slot scheduling remains unchanged.
  - No dependency `links` rows are created in this A-slice.
  - No task completion/status automation, notification drafts, GCal mirror,
    Gmail, movement API, cron, or LLM call is introduced.
  - UI remains mobile-first, semantic-token based, keyboard focusable, and has
    at least 44px touch targets.
  - `docs/codebase-map.md` reflects the new boundary.
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
    - valid task schedule-block request parses.
    - end-before-start, invalid date/now, missing fields, and injected fields
      reject.
    - response schema validates task+event and rejects injected score/apply
      fields.
  - Migration/integration:
    - migrations create nullable `tasks.scheduled_event_id`.
    - legacy task rows read with null marker.
  - Backend route/repository:
    - success creates one event and sets the task marker in one transaction.
    - created event has the exact planned/cairn/self-imposed/task/async shape.
    - stale candidate selection returns 409 and writes nothing.
    - already-active scheduled block returns 409 and writes nothing.
    - scheduled block cancellation/moved status lets the task surface again.
    - row counts prove only `events` and the target task marker change on
      success; no `links` row is inserted.
    - existing event slot candidate/schedule routes still pass.
  - Frontend:
    - task candidate rows expose an explicit schedule-block action.
    - apply success refreshes Today and removes the prompt.
    - apply failure keeps the prompt with scoped copy.
    - task apply does not call `/api/events/:id/schedule` or task status patch.
    - event schedule prompt behavior remains unchanged.
  - Static negative checks:
    - No dependency link creation:
      `git diff -U0 master...HEAD -- server/src shared/src web/src | rg -n 'insert\\(links\\)|links\\)'`
      should have no implementation matches for task apply.
    - No task status/due mutation:
      inspect task repository update sets and route handlers; only
      `scheduled_event_id` may be written by apply.
    - No external/LLM/GCal/Gmail/movement/cron:
      `git diff -U0 master...HEAD -- server/src shared/src web/src | rg -n 'completeChat|LLM_PROXY_BASE_URL|gmail|Gmail|googleapis|mirror|movement|scheduler|cron'`
      should have no implementation matches.
- gas limit: N/A
- slither pass: N/A

## Missing Edge Case Candidates

- Candidate was valid when loaded but another event now occupies the slot.
  Recompute and reject the stale candidate before any write.
- User double-clicks apply or two tabs apply the same task. The second request
  must see the active scheduled marker and return an already-scheduled conflict
  without creating another event.
- The referenced scheduled block is later cancelled or moved. The task should
  be eligible to surface again rather than staying hidden forever.

## Simpler Alternative

Create a scheduled event but do not record it on the task. That is smaller but
incorrect: Today would keep surfacing the same task, and the system could create
duplicate blocks. A nullable `scheduled_event_id` is the smallest explicit
source-owned marker for the apply contract.

## Assumptions

- A scheduled task block is a Cairn-created event, not a GCal mirror export.
- `mode='async'` is the safest A-slice default for a task work block because no
  person/location/movement evidence exists.
- `type='task'` is a descriptive string only; there is no event type enum.
- Linking the task to the event through dependency `links` would overload
  sequencing semantics, so this cycle uses an explicit task marker instead.
- Completion remains manual. Scheduling a task block does not mark the task
  doing or done.

## Review Guidance

### Enumeration Needed

- Task schedule marker and prompt exclusion:
  - Search:
    `rg -n 'scheduledEventId|scheduled_event_id|active scheduled|findDueTaskSchedulePrompts|TASK_ALREADY_SCHEDULED' shared/src server/src docs/codebase-map.md`
  - Expected: task schema, migration, repository helper, task route, tests, and
    docs agree on the marker semantics.
- Task apply route and candidate revalidation:
  - Search:
    `rg -n 'ScheduleTaskBlock|schedule-block|generateTaskSlotCandidates|TASK_SLOT_STALE|scheduled block' shared/src server/src web/src`
  - Expected: strict shared request, route revalidates against generated
    candidates, and UI calls only the task apply endpoint.
- Write scope:
  - Search:
    `git diff -U0 master...HEAD -- server/src | rg -n 'insert\\(|update\\(|delete\\('`
  - Expected: task apply inserts one event and updates one task marker only;
    no link insert, no task status/due update, no event update.
- Existing event flow:
  - Search:
    `rg -n 'events/.*/slot-candidates|events/.*/schedule|handleSchedule\\(' web/src/Today.tsx server/src`
  - Expected: existing event scheduling path is unchanged except for fixture
    updates caused by shared schema additions.

### Verification Guidance

- Migration and transaction:
  - SQLite integration tests are required because FK/nullability and all-or-none
    behavior matter.
- Candidate stale handling:
  - Route integration must create a candidate, alter the DB to occupy or
    invalidate it, then assert no event/task marker is written.
- UI behavior:
  - Component tests are sufficient for endpoint calls and scoped errors.
  - Manual/code-level UI verification should check mobile/wide layout,
    light/dark, reduced motion, keyboard focus, and touch target size.
- Scope creep:
  - Reviewer should block if the implementation creates dependency links,
    changes task status/due/estimate, exports to GCal, adds notifications,
    calls LLM/external services, or changes event slot scheduling semantics.
