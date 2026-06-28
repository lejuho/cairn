# Operational Soft Remove Controls A Implementation Plan

Branch: feature/cycle-81-soft-remove-controls-a
Cycle: 81
Created: 2026-06-29
Skills: backend-fastify, frontend-react-pwa

## Summary

Cycle 81 responds to the missing visible delete affordances across Cairn's core
objects. The safest A-slice is **operational soft remove**, not hard delete.

Today already has domain-safe remove-like semantics:

- events can be `cancelled`;
- tasks can be `dropped`;
- watchers can be `disarmed`;
- thread relation links can be hard-deleted because they are only edges.

The gap is that those semantics are unevenly exposed in the UI. This cycle
implements explicit **task drop** controls on operational task surfaces and
documents/labels existing event cancel + watcher disarm as the current safe
delete substitutes. It deliberately does not add hard delete for threads,
people, events, tasks, or watchers.

Threads and people need separate archive/merge semantics because they are graph
centers with historical evidence. They stay out of this cycle.

## Input/Output Spec

- Input:
  - Existing `PATCH /api/tasks/:id/status` with `status:"dropped"`.
  - Existing `PATCH /api/events/:id/status` with `status:"cancelled"`.
  - Existing `PATCH /api/watchers/:id/armed` with `armed:false`.
  - Existing thread-link `DELETE /api/threads/:id/links/:linkId`.
- Normal output:
  - Today two-minute task cards expose an explicit low-friction `드롭` or
    equivalent soft-remove action.
  - Today due-task schedule-prompt cards expose a permanent soft-remove action
    distinct from one-day `오늘 숨기기`.
  - Thread detail active task rows expose the same task drop action, using the
    existing task status endpoint.
  - Dropping a task sets only `tasks.status='dropped'`, refreshes the relevant
    view, and removes it from active Today/thread task surfaces.
  - Dropped tasks remain visible as historical/completed evidence where the
    existing UI already groups done/dropped tasks.
  - Event detail keeps status-based cancel semantics; no hard-delete event
    route/button is introduced.
  - Watcher list keeps disarm semantics; copy/tests should make clear this is
    the current remove-from-active-flow action, not a delete.
  - All actions are explicit taps. Nothing is auto-dropped or auto-cancelled.
- Failure behavior:
  - Failed task drop shows a scoped row/card error and preserves the existing
    surface.
  - Invalid task id or failed status response does not mutate local state.
  - Dropping a task with a scheduled block does not silently mutate or delete the
    scheduled event in this A-slice; any later block cleanup must be a planned
    cycle.
  - No hard delete of core rows, no cascade delete, no DB schema migration, no
    LLM, no cron, and no background cleanup.

## Key Changes

- Shared:
  - Reuse existing `TaskStatusSchema` and `PatchTaskStatusRequestSchema`.
  - Add/adjust tests only if needed to prove `dropped` is accepted and invalid
    delete-like injected fields remain rejected.
- Backend:
  - Prefer no new production route. Reuse `PATCH /api/tasks/:id/status`.
  - Add focused integration coverage if current tests do not prove
    `status:"dropped"` removes tasks from Today active surfaces.
  - Do not add `DELETE /api/tasks`, `DELETE /api/events`, `DELETE /api/watchers`,
    `DELETE /api/people`, or `DELETE /api/threads`.
- Frontend:
  - `web/src/Today.tsx`
    - Add page-level task drop handler using existing `apiJson`.
    - Add a secondary soft-remove action to two-minute task cards.
    - Add a permanent soft-remove action to due-task schedule prompts, distinct
      from `오늘 숨기기`.
    - Preserve existing `완료`, slot apply, and prompt dismiss flows.
  - `web/src/Thread.tsx`
    - Add task drop action for active task rows.
    - Refresh thread detail after success; show scoped error on failure.
    - Keep done/dropped grouping intact.
  - `web/src/Watchers.tsx`
    - No new delete route. Preserve armed toggle; optionally clarify visible
      copy/aria that disabling removes the watcher from active flow.
  - `web/src/styles.css`
    - Add semantic-token-only secondary/destructive-soft button styles if the
      existing button classes are insufficient.
- Docs:
  - Add a short roadmap for soft-remove/archive semantics.
  - Update `docs/codebase-map.md` after implementation to record task drop UI
    and the no-hard-delete boundary.

## Sprint Contract

- Passing criteria:
  - Two-minute task card can drop a task via `PATCH /api/tasks/:id/status`
    `{status:"dropped"}`.
  - Due-task schedule prompt can permanently drop a task, separate from
    one-day prompt dismiss.
  - Thread detail active task row can drop a task and moves it out of active
    grouping after refresh.
  - Dropped tasks are not hard-deleted and remain available as historical
    dropped evidence where the app already displays done/dropped tasks.
  - Event deletion is not added; event detail cancellation remains the
    soft-remove behavior.
  - Watcher deletion is not added; watcher disarm remains the remove-from-active
    behavior.
  - No hard delete route/table cascade/schema migration is introduced for core
    domains.
  - Existing thread relation link delete behavior remains unchanged.
- Automatic checks:
  - `corepack pnpm lint`
  - `corepack pnpm typecheck`
  - `corepack pnpm test`
  - `corepack pnpm test:integration`
  - `corepack pnpm build`
  - `corepack pnpm verify`
  - `git diff --check master...HEAD`
  - Static negative checks:
    - No core hard-delete routes:
      `git diff -U0 master...HEAD -- server/src/routes shared/src web/src | rg -n 'app\\.delete\\(\"/api/(tasks|events|watchers|people|threads)|DELETE /api/(tasks|events|watchers|people|threads)|deleteTask|deleteEvent|deleteWatcher|deletePerson|deleteThread'`
      should have no implementation matches.
    - No DB schema/migration/cascade scope:
      `git diff --name-only master...HEAD | rg 'server/drizzle|server/src/db/schema.ts|migration'`
      should have no matches.
    - No hidden automation:
      `git diff -U0 master...HEAD -- server shared web | rg -n 'auto.?drop|auto.?delete|cron|cleanup|cascade|scheduled block.*delete'`
      should have no implementation matches.
    - No LLM path:
      `git diff -U0 master...HEAD -- server/src shared/src web/src | rg -n 'llm|chat/completions|Grok|prompt'`
      should have no implementation matches.
- Test cases:
  - Today two-minute task drop sends exactly `{status:"dropped"}` and refreshes.
  - Today due-task prompt drop sends exactly `{status:"dropped"}` and refreshes.
  - Today one-day dismiss still sends only `dismissedOn` and does not drop.
  - Thread detail task drop sends exactly `{status:"dropped"}` and refreshes.
  - Drop failure shows scoped error and leaves the row/card visible.
  - Done task behavior remains unchanged.
  - Event cancel status button remains available and no event delete button is
    introduced.
  - Watcher disarm still uses `PATCH /api/watchers/:id/armed`; no watcher delete
    button/API is introduced.
- gas limit: N/A
- slither pass: N/A

## Missing Edge Case Candidates

- A task may already have a scheduled block event. This cycle must not silently
  cancel/delete that event. If cleanup is desired, plan a later explicit cycle.
- A dropped task should disappear from active surfaces but remain present in
  completed/dropped history groups where those already exist.
- Users may expect "삭제" to mean hard deletion. Copy should prefer "드롭" or
  "비활성화" where data is retained.

## Simpler Alternative

Only document that deletion is unavailable. That is too passive: tasks already
have a safe `dropped` status and users need an explicit way to remove task noise
from Today/thread views. The chosen A-slice implements the highest-value safe
remove action without inventing hard delete semantics.

## Assumptions

- Task `dropped` is the canonical soft-remove state for tasks.
- Event `cancelled` is the canonical soft-remove state for scheduled events.
- Watcher `armed=false` is the canonical remove-from-active-flow state for
  watchers.
- Thread and person archive/delete require separate specs because they affect
  graph traversal, rollups, person history, resources, and mirrors.

## Review Guidance

### Enumeration Needed

- Task status write paths:
  - Search:
    `rg -n 'PATCH /api/tasks|/api/tasks/.*/status|PatchTaskStatus|status: "dropped"|드롭|완료' shared/src server/src web/src`
  - Expected: task drop uses only the existing status patch endpoint and sends
    only `status:"dropped"`.
- Core hard-delete scope:
  - Search:
    `rg -n 'app\\.delete|DELETE /api|deleteTask|deleteEvent|deleteWatcher|deletePerson|deleteThread|cascade' server/src shared/src web/src`
  - Expected: only the pre-existing thread relation link delete remains.
- UI surfaces:
  - Search:
    `rg -n 'two_minute_task|task_schedule_prompt|doneTasks|activeTasks|드롭|오늘 숨기기|비활성' web/src/Today.tsx web/src/Thread.tsx web/src/Watchers.tsx`
  - Expected: two Today task surfaces and Thread active task rows expose task
    drop; watcher stays disarm; event stays cancel.

### Verification Method Guide

- Backend task status behavior:
  - Existing route tests may be sufficient for `dropped` acceptance, but Today
    integration is required if the claim is "dropped tasks leave active Today
    surfaces."
- Frontend interactions:
  - Vitest coverage is required for click → request body → refresh/error state
    on each changed UI surface.
- Hard-delete boundary:
  - Static negative checks are required. Unit tests alone do not prove core
    hard-delete routes were not introduced.
