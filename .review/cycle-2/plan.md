# Local Today API + Deterministic Surface Implementation Plan

Branch: feature/cycle-2-local-today-api
Cycle: 2
Created: 2026-06-16
Skills: backend-fastify, frontend-react-pwa

## Summary

Cycle 1 established the pnpm workspace, Fastify server, shared Zod contracts,
Drizzle SQLite schema, first migration, LLM gateway boundary, and static PWA
shell. Cycle 2 builds the first usable local surface without external
dependencies.

This cycle adds deterministic local API routes for events, tasks,
date-threshold watchers, and `/api/today`, then connects the React PWA
`/today` screen to that API with loading, quiet, live, and error states.

Out of scope: GCal OAuth/sync, Gmail parsing, push delivery, LLM
parsing/generation, auth, remote access, offline writes, watcher B,
feasibility energy math, natural-language input, and frontend create forms.

## 입력/출력 명세

- 입력:
  - endpoint: `GET /api/today?date=YYYY-MM-DD&now=<ISO datetime>`
  - endpoint: `POST /api/events`
  - endpoint: `POST /api/tasks`
  - endpoint: `PATCH /api/tasks/:id/status`
  - endpoint: `POST /api/watchers`
  - endpoint: `PATCH /api/watchers/:id/snooze`
  - content-type: `application/json` for write endpoints
  - auth: none
- 출력:
  - 정상:
    - All endpoints use `{ ok: true, data }`.
    - `GET /api/today` returns deterministic surface data:
      - `date`, `now`, `state: quiet | live`
      - `nextEvent`
      - `conflicts`
      - `twoMinuteTasks`
      - `watcherBubbles`
      - `cards`
    - `cards` are sorted by fixed priority:
      1. conflicts
      2. watcher bubbles
      3. next event
      4. two-minute tasks
  - 실패:
    - All endpoint failures use `{ ok: false, error: { code, message } }`.
    - Validation failures return typed 400 errors.
    - Missing records return typed 404 errors.
    - Database constraint failures return typed 400 errors.

### Endpoint Contracts

- `POST /api/events`
  - Request fields:
    - `title: string`
    - `start: ISO datetime string`
    - `end: ISO datetime string`
    - optional `type`, `location`, `threadId`
  - Behavior:
    - Reject `end <= start`.
    - Insert `source='cairn'`, `self_imposed=1`, `status='planned'`.
    - Return the created event.

- `POST /api/tasks`
  - Request fields:
    - `title: string`
    - optional `estMinutes`, `due`, `context`, `threadId`, `optional`
  - Behavior:
    - Insert `status='todo'`.
    - Return the created task.

- `PATCH /api/tasks/:id/status`
  - Request fields:
    - `status: todo | doing | done | dropped`
  - Behavior:
    - Update the task status.
    - Return the updated task.

- `POST /api/watchers`
  - Request fields:
    - `label: string`
    - `threshold: YYYY-MM-DD`
    - optional `category`
  - Behavior:
    - Support deterministic watcher A only.
    - Insert `kind='A'`, `armed=1`.
    - Store `rule={"type":"date_threshold","fireOn":threshold}`.
    - Return the created watcher.

- `PATCH /api/watchers/:id/snooze`
  - Request fields:
    - `snoozedUntil: ISO datetime string`
  - Behavior:
    - Update `snoozed_until`.
    - Return the updated watcher.

- `GET /api/today`
  - Query fields:
    - `date: YYYY-MM-DD`
    - `now: ISO datetime string`
  - Behavior:
    - Date matching uses the literal `YYYY-MM-DD` prefix of stored ISO
      `events.start`; no timezone normalization in Cycle 2.
    - `nextEvent` is the earliest planned/confirmed event on `date` with
      `start >= now`; if none exists, `null`.
    - `conflicts` are overlapping planned/confirmed event pairs on `date`.
    - `twoMinuteTasks` are `tasks.est_minutes <= 2 AND status='todo'`.
    - `watcherBubbles` are armed A watchers with `threshold <= date` and no
      active `snoozed_until > now`.
    - `state` is `quiet` when all surface arrays are empty and `nextEvent` is
      `null`; otherwise `live`.

## Key Changes

- Shared
  - Add Zod schemas and TypeScript types for event, task, watcher, and Today
    endpoint requests/responses.
  - Reuse existing API success/failure envelope types.
- Backend
  - Add repository/service layer for local event, task, watcher writes and
    Today aggregation.
  - Add Fastify routes under `/api/*`; handlers validate input, call a service,
    and map typed results.
  - Keep Today aggregation deterministic SQL/TypeScript only; do not import or
    call the LLM gateway.
  - Use migrated temporary SQLite databases in integration route tests.
- Frontend
  - Replace static `/today` shell with an API-backed page.
  - Implement loading skeleton, quiet state, live stack, and error state.
  - Render live cards for conflicts, watcher bubbles, next event, and
    two-minute tasks.
  - Add a task done action for two-minute tasks that calls
    `PATCH /api/tasks/:id/status` with `status='done'`, then refetches Today.
  - Do not add event/task/watcher creation forms in Cycle 2.
- Tooling
  - Preserve existing root commands.
  - No DB migration is expected unless implementation discovers a missing
    required field.

## Sprint Contract

- 통과 기준:
  - `GET /api/today` is deterministic and does not depend on LLM, GCal, Gmail,
    push, auth, or remote access.
  - Local create/update APIs work against SQLite and return typed envelopes.
  - `/today` uses the API and implements loading, quiet, live, and error states.
  - Two-minute task done action patches the task and refetches Today.
  - No frontend create forms are introduced.
- 자동 체크:
  - Root: `corepack pnpm verify`
  - Migration generation check: `corepack pnpm db:generate`
  - Integration: `corepack pnpm test:integration`
  - Whitespace: `git diff --check`
- 테스트 케이스:
  - Server integration:
    - Create event, then `GET /api/today` returns it as `nextEvent`.
    - Create overlapping planned/confirmed events, then Today returns conflict
      cards.
    - Create tasks with `estMinutes <= 2` and `> 2`; only todo two-minute
      tasks surface.
    - Patch task to `done`; it disappears from Today.
    - Create watcher with `threshold <= date`; it surfaces, then snooze hides
      it.
    - Invalid event time, invalid params, missing records, and invalid status
      return typed errors.
  - Web unit:
    - `/today` renders loading, quiet, live, and error states with mocked
      fetch.
    - Two-minute task done action calls PATCH and refetches.
    - Touch actions are at least 44px and reduced-motion-safe markup remains
      present.
- gas 한도: N/A
- slither 통과: N/A

## 누락된 엣지 케이스 후보 3개

- Today date filtering accidentally performs timezone conversion and shifts
  events across days.
- Today route imports LLM gateway indirectly through a shared helper.
- Snoozed watcher remains visible because `snoozed_until` comparison uses
  `date` instead of `now`.

## 더 단순한 대안 1개

Only implement `GET /api/today` over manually seeded database rows — 채택하지
않은 이유: without local create/update APIs, integration tests and manual
verification would require ad hoc DB writes and would not establish the API
surface needed by the PWA.

## Assumptions

- User selected Local Today API as Cycle 2 priority.
- Fixed Today card priority is accepted for Cycle 2: conflicts > watchers >
  next event > two-minute tasks.
- Watcher support is limited to deterministic date-threshold A watchers.
- Local data creation is API/test-only; frontend forms wait for a later cycle.
- Timezone behavior is intentionally simple: stored ISO prefix decides the
  Today date.
- No auth is implemented in Cycle 2; external exposure remains blocked until a
  later access-boundary cycle.

## Review Guidance

### Enumeration 필요 항목

- Today/API routes
  - 검색: `rg -n "api/today|/api/events|/api/tasks|/api/watchers" server shared web`
  - 예상 결과: route definitions in server, schemas/types in shared, API
    client usage in web only.
- LLM isolation
  - 검색: `rg -n "createLlmGateway|completeChat|LLM_PROXY_BASE_URL" server/src`
  - 예상 결과: no Today service or route imports the LLM gateway.
- Frontend state coverage
  - 검색: `rg -n "loading|quiet|live|error|today" web/src`
  - 예상 결과: `/today` component and tests cover all four states.

### 검증 방식 가이드

- "Today aggregation is deterministic":
  - Requires source inspection proving no LLM gateway import plus integration
    tests over a real temporary SQLite DB.
- "Local API writes work":
  - Requires Fastify route integration tests after applying migrations; service
    mocks are insufficient.
- "Watcher snooze hides bubbles":
  - Requires test cases comparing `snoozed_until` to `now`, not only `date`.
- "UI four states":
  - Mocked fetch tests are sufficient for frontend state rendering; real
    backend is covered separately by server integration tests.
