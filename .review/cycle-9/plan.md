# Cycle 9 — Threads Read-Only Spine

Branch: `feature/cycle-9-threads-readonly-spine`
Cycle: `9`
Created: `2026-06-17`
Skills: `backend-fastify, frontend-react-pwa`

## Summary

Cycle 9 starts the Threads surface without adding LLM generation or graph
editing. The goal is a deterministic read-only `/threads/[id]` spine backed by
local SQLite data, plus minimal API support to create/list threads so the
surface can be exercised with real local data.

This is the first slice of `FR-THR-01`. It intentionally does not implement
natural-language thread creation, inferred links, firmness confirmation,
contains rollup, or cross-thread graph behavior.

Precondition: the current uncommitted `docs/cairn-spec.md` edit is either
committed before implementation starts or deliberately kept outside this cycle.

Out of scope:
- LLM thread draft generation
- `/threads/new` natural-language planner
- link or thread-link editing
- firmness promotion
- unknown propagation
- contains rollup/cascade
- cost settlement
- GCal export/mirror
- migrations unless implementation discovers a real schema gap

## 입력/출력 명세

- `POST /api/threads`
  - Request: `{ name: string, kind?: string, goal?: string, deadline?: string }`
  - Validation: `name` must be non-empty after trim.
  - Behavior: insert `status='active'`; return created thread.
- `GET /api/threads`
  - Response: active/paused/done/dropped threads sorted by newest first.
  - Include lightweight counts: event count, task count, done count, total count.
- `GET /api/threads/:id`
  - Response: `{ thread, events, tasks, progress }`.
  - `events`: rows where `thread_id=<id>`, sorted by `start` ascending with
    null starts last.
  - `tasks`: rows where `thread_id=<id>`, sorted by `created_at` ascending.
  - `progress`: `{ done: number, total: number }`, where done includes
    `events.status='done'` and `tasks.status='done'`; total includes all linked
    events/tasks except dropped/cancelled rows.
  - Missing thread returns typed `404 NOT_FOUND`.
- Web routes:
  - `/threads/[id]` renders read-only thread spine.
  - No frontend `/threads/new` implementation in Cycle 9.

## Key Changes

- Shared:
  - Add thread row, create-thread request, thread summary, thread detail, and
    progress schemas/types.
  - Export new schemas from the shared barrel.
- Backend:
  - Add repository/service/route for thread creation, list, and detail.
  - Keep route handlers thin: validate, call service, map success/error.
  - Use existing `threads`, `events`, and `tasks` tables only.
  - Keep deterministic: no LLM gateway import.
- Frontend:
  - Extend simple app routing so `/threads/:id` renders a new thread page.
  - Render loading, quiet/empty, live, and error states.
  - Header shows thread name, goal/deadline if present, and progress count.
  - Spine shows events and tasks in one vertical list, split by NOW into
    future/upcoming and past/done sections using current time.
  - Nodes display title, type (`event`/`task`), status, time metadata, and
    optional location/context.
  - Add links from Today timeline rows to `/threads/[id]` only when an event has
    `threadId`.
- Docs:
  - Update `docs/codebase-map.md` to mention thread APIs and `/threads/[id]`.

## Sprint Contract

- 통과 기준:
  - `POST /api/threads` creates active thread rows.
  - `GET /api/threads` returns summaries with stable counts.
  - `GET /api/threads/:id` returns thread, linked events/tasks, and progress.
  - Missing thread returns `404 NOT_FOUND`.
  - `/threads/:id` renders read-only spine and all four UI states.
  - Today links to thread detail only for events with `threadId`.
  - No LLM dependency, no graph editing, no natural-language generation.
- 자동 체크:
  - `corepack pnpm db:generate`
  - `corepack pnpm test:integration`
  - `corepack pnpm verify`
  - `git diff --check`
- 테스트 케이스:
  - Backend integration: creates thread with required name and defaults active.
  - Backend integration: rejects blank thread name.
  - Backend integration: list returns thread summaries with event/task counts.
  - Backend integration: detail sorts events/tasks correctly and computes
    progress.
  - Backend integration: missing thread returns typed 404.
  - Frontend test: `/threads/1` loading, live, empty, and error states render.
  - Frontend test: thread header shows name/goal/deadline/progress.
  - Frontend test: spine renders event and task nodes.
  - Frontend test: Today event with `threadId` links to `/threads/[id]`;
    event without `threadId` has no thread link.
- gas 한도: N/A
- slither 통과: N/A

## 누락된 엣지 케이스 후보 3개

- Thread has tasks but no events; page must still be useful.
- Event has null `start`; sort null-start nodes after scheduled events.
- Progress denominator accidentally includes cancelled/dropped rows and makes
  completed work look worse than it is.

## 더 단순한 대안 1개

Implement only backend thread APIs and postpone `/threads/[id]`. This would be
safer but would not validate the main product promise: seeing work by context
instead of by calendar date.

## Assumptions

- Manual thread creation via API is acceptable as scaffolding before natural
  language `/threads/new`.
- No migration is expected because the Cycle 1 schema already contains
  `threads`, `events.thread_id`, and `tasks.thread_id`.
- `GET /api/threads` is allowed as a lightweight index even though the product
  route spec emphasizes `/threads/[id]`.
- Read-only spine is enough for Cycle 9; editing waits for a later cycle.
- Existing semantic tokens and Today visual language can seed the thread page.

## Review Guidance

### Enumeration 필요 항목

- Thread API surface:
  - Search: `rg -n "api/threads|ThreadRow|ThreadDetail|CreateThread" shared/src server/src web/src`
  - Expected: create/list/detail contracts, backend route/service/repository,
    frontend route/tests.
- Route inventory:
  - Search: `rg -n "app\\.(get|post|patch|put|delete)\\(" server/src/routes`
  - Expected: only `POST /api/threads`, `GET /api/threads`, and
    `GET /api/threads/:id` are new.
- LLM boundary:
  - Search: `rg -n "LLM_PROXY_BASE_URL|completeChat|createLlmGateway|/v1/chat/completions" server/src web/src`
  - Expected: no new thread code imports or calls LLM gateway.
- Migration boundary:
  - Search: `find server/drizzle -maxdepth 2 -type f -print | sort`
  - Expected: no new migration unless explicitly justified.
- Codebase map:
  - Search: `rg -n "threads|/threads|Thread" docs/codebase-map.md`
  - Expected: map documents thread routes/API entry points.

### 검증 방식 가이드

- API and progress behavior require real temporary SQLite integration tests.
- UI states can be tested with Vitest component tests and mocked fetch.
- Thread detail sorting/progress should not rely on mock DB tests.
- Reviewer should confirm `docs/cairn-spec.md` user edits were not overwritten
  by this cycle unless intentionally included.
