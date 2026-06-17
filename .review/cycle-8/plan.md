# Cycle 8 — Today Daily Timeline

Branch: `feature/cycle-8-today-daily-timeline`
Cycle: `8`
Created: `2026-06-17`
Skills: `backend-fastify, frontend-react-pwa`

## Summary

Cycle 7 made it possible to create local tasks and events from `/today`.
Cycle 8 makes those created events visible as a simple day timeline on the same
surface. The goal is not full thread/timeline depth yet; it is a small, stable
daily schedule view that proves local event creation is useful immediately.

Out of scope:
- `/threads/[id]` or `/threads/new`
- thread creation/editing
- natural-language parsing
- LLM generation
- new migrations
- GCal mirror/export
- recurring events
- drag/drop rescheduling
- offline write queue
- auth or remote access changes

Precondition: the current root `README.md` docs change remains separate from
this cycle unless intentionally committed before implementation.

## 입력/출력 명세

- 입력:
  - `GET /api/today?date=YYYY-MM-DD&now=<ISO datetime>` remains the only read
    API used by `/today`.
  - Existing manual event creation from Cycle 7 remains unchanged.
- 출력:
  - Extend Today response with:
    - `dayEvents: EventRow[]`
  - `dayEvents` includes planned/confirmed events whose stored `start` begins
    with the literal query `YYYY-MM-DD`.
  - Sort `dayEvents` by ascending `start`.
  - Exclude cancelled/done/moved/late events from `dayEvents`.
  - Existing fields remain:
    - `nextEvent`
    - `conflicts`
    - `twoMinuteTasks`
    - `watcherBubbles`
    - `needsReviewEvents`
    - `cards`
  - `/today` renders a daily timeline section when `dayEvents.length > 0`.

## Key Changes

- Shared:
  - Add `dayEvents: EventRow[]` to `TodaySurfaceSchema` and type.
  - Keep existing card union unchanged; timeline is a separate surface section,
    not a new interrupt card kind.
- Backend:
  - Return `dayEvents` from Today aggregation.
  - Reuse existing planned/confirmed day-event selection logic.
  - Keep date matching literal-prefix based, no timezone normalization.
  - Keep Today deterministic; no LLM gateway import.
- Frontend:
  - Render a compact `오늘 일정` timeline section on `/today`.
  - Show event title, start/end time, and optional location.
  - Mark currently active event visually when `start <= now < end`.
  - Keep existing interrupt card priority unchanged above/beside the timeline:
    conflicts > watchers > next event > two-minute tasks > needs-review.
  - Keep quiet state when there are no cards and no `dayEvents`.
  - After Cycle 7 event creation, refetch should show the new event in the
    timeline if it matches Today date rules.
- Docs:
  - Update `docs/codebase-map.md` to mention Today daily timeline and
    `dayEvents`.

## Sprint Contract

- 통과 기준:
  - `GET /api/today` returns `dayEvents` sorted by start.
  - `dayEvents` includes planned/confirmed events for the requested date.
  - `dayEvents` excludes cancelled/done/moved/late events.
  - Existing `nextEvent`, conflicts, and cards behavior remains unchanged.
  - `/today` renders a timeline when `dayEvents` exists.
  - Empty DB still renders quiet state.
  - No backend route additions and no migrations.
- 자동 체크:
  - `corepack pnpm db:generate`
  - `corepack pnpm test:integration`
  - `corepack pnpm verify`
  - `git diff --check`
- 테스트 케이스:
  - Backend integration: multiple planned/confirmed day events return sorted in
    `dayEvents`.
  - Backend integration: non-matching date and terminal-status events are
    excluded.
  - Backend integration: `nextEvent` still chooses the earliest future event.
  - Backend integration: conflict detection still works from the same event set.
  - Frontend test: live `/today` renders `오늘 일정` timeline rows.
  - Frontend test: active event is marked when `now` is inside its range.
  - Frontend test: quiet state remains quiet when `dayEvents` and cards are
    empty.
  - Frontend test: manual event submit still posts, refetches, and can surface
    the returned event through timeline rendering.
- gas 한도: N/A
- slither 통과: N/A

## 누락된 엣지 케이스 후보 3개

- An all-day GCal event has midnight RFC3339 start/end and should still render
  without misleading time copy.
- Events with malformed or missing `end` should not crash timeline rendering.
- A created event for local date may not appear if RFC3339 offset serialization
  changes the literal date prefix.

## 더 단순한 대안 1개

Render only `nextEvent` more prominently and avoid adding `dayEvents` to the API.
This is smaller, but it does not solve the core usability gap: multiple manually
created events remain invisible except for the single next event.

## Assumptions

- Full thread spine waits until after the daily surface proves local data flow.
- Timeline is read-only in Cycle 8.
- Existing event creation/editing APIs are not expanded in this cycle.
- Today timeline uses stored ISO strings directly; no calendar library added.
- Existing semantic tokens and Today card visual language are sufficient.

## Review Guidance

### Enumeration 필요 항목

- Today contract:
  - Search: `rg -n "dayEvents|TodaySurface" shared/src server/src web/src`
  - Expected: `dayEvents` appears in shared schema/type, Today aggregation, Today
    route tests, and Today UI/tests.
- Backend route creep:
  - Search: `rg -n "app\\.(post|patch|put|delete|get)\\(" server/src/routes`
  - Expected: no new route is required; existing `GET /api/today` changes only.
- LLM boundary:
  - Search: `rg -n "LLM_PROXY_BASE_URL|completeChat|createLlmGateway|/v1/chat/completions" server/src web/src`
  - Expected: no new LLM dependency in Today timeline work.
- Migration boundary:
  - Search: `find server/drizzle -maxdepth 2 -type f -print | sort`
  - Expected: no new migration file.
- Codebase map:
  - Search: `rg -n "daily timeline|dayEvents|Today" docs/codebase-map.md`
  - Expected: map mentions the Today daily timeline surface.

### 검증 방식 가이드

- API contract changes require shared schema/type updates plus backend
  integration tests using real temporary SQLite DBs.
- UI timeline rendering can be verified with Vitest component tests and mocked
  `/api/today` responses.
- No manual browser smoke is required for merge, but reviewer may optionally run
  `corepack pnpm dev` and create an event through Cycle 7 manual intake.
