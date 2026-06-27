# Dismissible Schedule Prompts A Implementation Plan

Branch: feature/cycle-61-dismiss-schedule-prompts
Cycle: 61
Created: 2026-06-27
Skills: backend-fastify, frontend-react-pwa

## Summary

Remaining implementation specs after cycle 60:

- `FR-SLOT-06` is partially implemented already: Today surfaces unscheduled
  Cairn events as `schedule_prompt` cards, the UI can fetch slot candidates, and
  selecting a candidate schedules the event through the existing event-only slot
  route. A clean-context Advisor confirmed that repeating an event-only schedule
  prompt cycle would duplicate existing behavior.
- The full spec still has two concrete gaps:
  - due-imminent task prompts, which require a clear task-to-scheduled-event
    write contract before they can be safely implemented;
  - dismissible schedule prompt cards, which do not require inventing task
    persistence semantics.
- Gmail parse fallback remains policy-undecided, movement/GCal mirror/Watcher-B
  automation remain external-heavy or later-phase, and broader Today dismiss
  semantics should stay source-owned rather than becoming a generic Today store.

Recommended next spec: **FR-SLOT-06B / FR-TODAY-05 Dismissible Schedule
Prompts A**.

This cycle adds a source-owned "hide this schedule prompt for the current Today
date" flow for existing event schedule prompts. It stores the dismiss date on
the source event, filters matching cards out of `/api/today`, and adds a small
Today UI action. It does not add task schedule prompts, due gating, task-to-event
conversion, slot scoring changes, new candidate logic, cron, external calls, or
LLM behavior.

## Input/Output Spec

- Input:
  - Existing `GET /api/today?date=<YYYY-MM-DD>&now=<RFC3339-with-offset>`.
  - Existing `schedule_prompt` cards for unscheduled Cairn events.
  - New explicit dismiss action:
    - `PATCH /api/events/:id/schedule-prompt/dismiss`
    - Body:

```json
{
  "dismissedOn": "2026-06-27"
}
```

- Output:
  - Normal dismiss:
    - Validates path id and strict body.
    - Verifies the event is still an eligible schedule prompt source:
      - `source='cairn'`
      - `self_imposed=1`
      - `start IS NULL`
      - `end IS NULL`
      - `status='planned'`
    - Writes `events.schedule_prompt_dismissed_on = dismissedOn`.
    - Updates only `schedule_prompt_dismissed_on` and `updated_at`.
    - Returns `200 { ok: true, data: { eventId, dismissedOn } }`.
    - Repeating the same dismiss is idempotent and returns the same success
      shape.
  - Today after dismiss:
    - `GET /api/today` excludes an otherwise eligible unscheduled event when
      `events.schedule_prompt_dismissed_on === query.date`.
    - The same event can reappear on a later Today date unless it is scheduled,
      cancelled, or dismissed again for that later date.
  - Failure:
    - Invalid id or body -> `400 VALIDATION_ERROR`.
    - Unknown event -> `404 NOT_FOUND`.
    - Known but no longer eligible schedule prompt source -> `409
      SCHEDULE_PROMPT_NOT_ELIGIBLE`.
    - Failed UI dismiss leaves the card visible and shows scoped failure copy.

## Key Changes

- Shared:
  - `shared/src/events.ts`
    - Add `DismissSchedulePromptRequestSchema`.
    - Add `DismissSchedulePromptDataSchema` and response type if local route
      conventions require a typed success payload.
    - If server responses expose the new event column through existing event
      rows, extend `EventRowSchema` with nullable `schedulePromptDismissedOn`;
      otherwise keep the column internal and explicitly map returned event rows.
  - Tests:
    - Validate strict request shape and date format.
    - Reject injected fields such as `score`, `autoApply`, `snoozedUntil`, or
      `taskId`.
- Backend:
  - `server/src/db/schema.ts`
    - Add nullable `schedulePromptDismissedOn` mapped to
      `schedule_prompt_dismissed_on`.
  - `server/drizzle/0006_*.sql`
    - Add the column with `ALTER TABLE events ADD COLUMN
      schedule_prompt_dismissed_on text;`
    - Avoid table rebuilds; legacy rows must remain valid with `NULL`.
  - `server/src/repositories/events.ts`
    - Change `findUnscheduledCairnEvents` to accept the Today date and exclude
      rows dismissed on that date.
    - Add `dismissSchedulePromptForDate(db, eventId, dismissedOn, updatedAt)`.
      It must perform eligibility checks and mutate only
      `schedule_prompt_dismissed_on` and `updated_at`.
  - `server/src/routes/today.ts`
    - Pass the parsed Today date into the unscheduled-event repository read.
  - `server/src/routes/events.ts`
    - Register the dismiss route.
    - Keep handler thin: validate -> repository/service boundary -> stable
      200/400/404/409 response.
  - Tests:
    - Add SQLite integration coverage for migration, filtering, idempotency,
      and stale/ineligible cases.
- Frontend:
  - `web/src/Today.tsx`
    - Add a compact dismiss action to schedule prompt cards.
    - On success, refresh Today or remove the dismissed card from local state
      using the server-confirmed date.
    - On failure, keep the card visible with scoped failure feedback.
    - Keep the existing "date picking" candidate flow unchanged.
  - `web/src/Today.test.tsx`
    - Cover dismiss success, failure, no candidate fetch on dismiss, and the
      existing scheduling flow remaining intact.
- Docs:
  - `docs/codebase-map.md`
    - Record the schedule prompt dismissal column, route, repository filter,
      and Today UI behavior.

## Sprint Contract

- Passing criteria:
  - Unscheduled Cairn event schedule prompts still appear on Today when not
    dismissed for the requested date.
  - A dismissed prompt is excluded only for the matching `date` query.
  - The same event can reappear on a later date without a background job.
  - The dismiss route is explicit, validates shared schemas, and is idempotent.
  - The dismiss write touches only `events.schedule_prompt_dismissed_on` and
    `events.updated_at`.
  - Unknown, scheduled, externally imported, cancelled, non-self-imposed, or
    already-started events cannot be dismissed through this route as schedule
    prompts.
  - Selecting a slot candidate still schedules the event exactly as before.
  - No due-task schedule prompt, task-to-event conversion, candidate scoring
    change, slot-generation change, generic Today dismissal store, cron,
    external API call, Gmail/GCal mirror, LLM gateway call, or recommendation
    output is introduced.
  - Today UI remains mobile-first, semantic-token based, keyboard focusable, and
    uses at least 44px touch targets.
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
    - valid dismiss request parses.
    - bad date, missing field, and injected fields reject.
  - Migration/integration:
    - migrations create `events.schedule_prompt_dismissed_on`.
    - legacy event rows read with `NULL` dismissal.
  - Backend route/repository:
    - an eligible unscheduled Cairn event appears before dismiss and disappears
      from Today after dismiss for the same date.
    - the event reappears for the next date.
    - dismiss is idempotent for the same event/date.
    - scheduled/external/cancelled/non-self-imposed events return the correct
      409/404 behavior and do not write.
    - row counts for `events`, `tasks`, `threads`, `watchers`, `annotations`,
      and `params` do not change; only the target event fields change.
    - existing slot candidate and event scheduling integration tests remain
      passing.
  - Frontend:
    - schedule prompt card renders both date-pick and dismiss actions.
    - dismiss success removes or refreshes away the card.
    - dismiss failure leaves the card visible with scoped error feedback.
    - dismiss does not call slot-candidate fetch or schedule PATCH.
    - existing candidate selection still schedules and refreshes Today.
  - Static negative checks:
    - No task conversion or task prompt implementation:
      `git diff --name-only master...HEAD | rg 'server/src/routes/tasks|server/src/repositories/tasks|shared/src/tasks'`
      should have no matches unless the executor documents a fixture-only reason.
    - No external/LLM/Gmail/GCal mirror boundary:
      `git diff -U0 master...HEAD -- server/src shared/src web/src | rg -n 'completeChat|LLM_PROXY_BASE_URL|gmail|Gmail|googleapis|mirror|scheduler|cron|taskId|due'`
      should show no implementation of those boundaries.
    - Dismiss write scope:
      inspect the event dismiss helper and verify no `start`, `end`, `status`,
      `thread_id`, `source`, `self_imposed`, or slot score fields are updated.
- gas limit: N/A
- slither pass: N/A

## Missing Edge Case Candidates

- User opens Today, then schedules the event elsewhere before tapping dismiss.
  The dismiss route must reject the stale card rather than hiding a scheduled
  event.
- User dismisses the same prompt twice from two tabs. The second request must be
  idempotent and safe.
- User dismisses near midnight. The stored value is the explicit Today query
  date, not server-local wall clock time, so behavior stays deterministic.

## Simpler Alternative

Remove the card locally without persistence. That would be smaller, but it
would reappear on refresh and fail `FR-TODAY-05`'s shared surface-state
requirement. Persisting one source-owned date on the event is the smallest
durable behavior without inventing task scheduling semantics.

## Assumptions

- "Dismiss" means hide for one Today date, not permanently suppress the event.
- The existing event-only schedule prompt surface is correct and should not be
  rebuilt in this cycle.
- Due-imminent task prompts remain future work until the task-to-event write
  contract is explicit.
- A nullable date text column is sufficient; the route schema owns validation.
- Updating `updated_at` for this explicit user action is acceptable because no
  existing prompt ordering depends on it.

## Review Guidance

### Enumeration Needed

- Existing schedule prompt surface:
  - Search:
    `rg -n 'schedule_prompt|findUnscheduledCairnEvents|slot-candidates|events/.*/schedule' server/src shared/src web/src`
  - Expected: existing candidate/schedule behavior remains present; new changes
    add only dismissal filtering/action.
- Dismiss route and schema:
  - Search:
    `rg -n 'DismissSchedulePrompt|schedule-prompt/dismiss|schedulePromptDismissedOn|schedule_prompt_dismissed_on' shared/src server/src web/src server/drizzle docs/codebase-map.md`
  - Expected: shared schema, DB column/migration, repository helper, route,
    Today UI/tests, and docs agree.
- Migration boundary:
  - Search:
    `ls server/drizzle && rg -n 'schedule_prompt_dismissed_on|CREATE TABLE|ALTER TABLE events' server/drizzle server/src/db/schema.ts`
  - Expected: exactly one new migration adds one nullable column with no table
    rebuild.
- Negative scope:
  - Search:
    `git diff --name-only master...HEAD`
  - Expected: no task route/repository implementation, no slot scoring service
    changes beyond tests needed for existing behavior, no Gmail/GCal mirror/LLM
    files, and no broad Today store.

### Verification Guidance

- DB migration and repository filtering:
  - Requires SQLite integration tests against a real temporary database.
- Route validation and idempotency:
  - Integration tests are required because stale eligibility and persisted date
    filtering cross route/repository/DB boundaries.
- Frontend behavior:
  - Component tests are sufficient for success/failure/no-wrong-network-call.
  - Manual/code-level UI verification should check mobile/wide layout,
    light/dark, keyboard focus, reduced motion, and 44px touch targets.
- Static scope:
  - Grep checks are advisory; reviewer should inspect false positives rather
    than treating fixture strings as implementation.
