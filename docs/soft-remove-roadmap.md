# Soft Remove / Archive Roadmap

Status: Cycle 81 (Operational Soft Remove Controls A) promoted and active
Created: 2026-06-29

Cairn intentionally has **no hard delete** for its core domains (events, tasks,
watchers, people, threads). Rows are graph centers with historical evidence —
feasibility rollups, settlement, person history, resources, and mirrors all read
them. The safe remove model is **operational soft remove**: change an object's
status / armed flag so it leaves active surfaces but stays as history.

## Current safe-remove substitutes (canonical states)

- Task → `status='dropped'` (reuse `PATCH /api/tasks/:id/status`).
- Scheduled event → `status='cancelled'` (event detail status button).
- Watcher → `armed=false` (the armed toggle removes it from the active flow).
- Thread relation link → `DELETE /api/threads/:id/links/:linkId` (an edge only,
  no historical evidence — the one existing hard delete).

These never cascade and never drop a row's history. Copy prefers "드롭" /
"비활성화" over "삭제" so users do not expect destructive deletion.

## Cycle 81: Operational Soft Remove Controls A

Implemented 2026-06-29 (`.review/cycle-81/`). Exposes explicit task **드롭** soft-
remove on operational surfaces by reusing `PATCH /api/tasks/:id/status`
`{status:"dropped"}` — no new route, table, migration, or hard delete:

- Today two-minute task cards get a secondary "드롭" action next to "완료".
- Today due-task schedule prompts get a permanent "드롭" distinct from the
  one-day "오늘 숨기기".
- Thread detail active task rows get a "드롭" action; dropped tasks move into the
  existing done/dropped history group (chip "드롭").
- Dropped tasks leave active Today/thread surfaces but remain as dropped
  evidence; dropping never touches a task's scheduled block event.
- Event cancel and watcher disarm are unchanged; no hard-delete route/button is
  added for any core domain.

## Out of scope (future cycles)

- Thread and person archive/merge (graph centers — need separate specs covering
  traversal, rollups, person history, resources, mirrors).
- Scheduled-block cleanup when a task with a block event is dropped.
- Any hard delete of core rows or cascade behavior.
