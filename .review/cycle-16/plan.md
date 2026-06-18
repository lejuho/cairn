# Event Action Sheet A 구현 계획

Branch: `feature/cycle-16-event-action-sheet-a`
Cycle: `16`
Created: `2026-06-18`
Skills: `backend-fastify, frontend-react-pwa`

## Summary

Current Cairn can create events, show Today timeline/review cards, attach people
from `/input`, and accept annotation replies through web or Telegram. What is
still weak is direct manipulation of an existing event from Today: the user can
mostly view a timeline item, but cannot open one compact surface to inspect
status, people, annotations, and take a small action.

Cycle 16 implements Event Action Sheet A. Tapping an event in Today opens a
mobile-first bottom sheet. The sheet shows event detail, attached people, recent
annotations, and deterministic status actions. It can also submit a one-line
annotation through the existing annotation intake endpoint.

Out of scope:
- Full title/time/location editor.
- Hard delete.
- GCal export/mirror mutation.
- Conflict resolution option scoring.
- People editing inside the sheet.
- Notification draft generation.
- Thread/node inline editing.
- New DB tables or migrations.
- New LLM use outside existing annotation intake.

Preparation pass creates only `.review/cycle-16/*` artifacts and stops before
implementation.

## 입력/출력 명세

- `GET /api/events/:id`
  - Input: positive integer event id.
  - Output:
    - Success: `{ ok: true, data: { event, people, annotations, thread } }`
    - `people`: current `PersonRow[]`, sorted by name/id.
    - `annotations`: recent annotation rows for the event, newest first.
    - `thread`: nullable compact `{ id, name }`.
  - Failure:
    - `400 VALIDATION_ERROR`
    - `404 NOT_FOUND`

- `PATCH /api/events/:id/status`
  - Input: `{ "status": EventStatus }`, lowercase only.
  - Allowed stored values: `planned | confirmed | done | cancelled | moved | late`.
  - Output:
    - Success: `{ ok: true, data: { event } }`
  - Failure:
    - `400 VALIDATION_ERROR`
    - `404 NOT_FOUND`
  - Deterministic route. No LLM import.

- Existing `POST /api/events/:id/annotations`
  - Used by the sheet note/review form.
  - Raw-first behavior remains unchanged.
  - LLM failure still returns `parseStatus="raw_stored"` and should be treated
    as a successful saved note by the UI.

- Frontend `/today`
  - Event cards/timeline rows become actionable buttons/links.
  - Opening an event fetches `GET /api/events/:id`.
  - Status action calls `PATCH /api/events/:id/status`, then refetches event
    detail and Today.
  - Note submit calls `POST /api/events/:id/annotations`, then refetches event
    detail and Today.
  - Empty note is rejected client-side.

## Key Changes

- Shared:
  - Add event detail response schema/type.
  - Add event status patch request/response schemas.
  - Reuse existing lowercase event status enum contract.

- Backend:
  - Add event detail repository/service helpers.
  - Add `GET /api/events/:id`.
  - Add `PATCH /api/events/:id/status`.
  - Reuse existing people and annotation repositories where possible.
  - Keep status patch deterministic and independent from the LLM gateway.

- Frontend:
  - Extend `Today.tsx` with an event action bottom sheet.
  - Make Today event surfaces open the sheet:
    - daily timeline `dayEvents`
    - next-event card, if present
    - needs-review card event title/summary area
    - schedule-prompt event title/summary area
  - Sheet content:
    - title, status, source, time window, location/type when present
    - linked thread shortcut when `threadId` is present
    - people names when attached
    - recent annotations
    - quick status buttons: done, cancelled, moved, late
    - one-line note form
  - Preserve existing Today loading, quiet, live, and error states.

- Docs:
  - Update `docs/codebase-map.md` with new event detail/status routes and Today
    sheet location after implementation.

## Sprint Contract

- 통과 기준:
  - `GET /api/events/:id` returns event detail with people, annotations, and nullable thread.
  - `GET /api/events/:id` rejects invalid id and missing event with typed errors.
  - `PATCH /api/events/:id/status` accepts lowercase event statuses only.
  - `PATCH /api/events/:id/status` updates the event status and returns the updated row.
  - Status patch rejects uppercase/unknown statuses.
  - Status patch rejects missing event.
  - Event detail/status routes have no LLM gateway dependency.
  - `/today` opens an event action sheet from timeline events.
  - Sheet status action patches status and refetches Today.
  - Sheet note action posts to annotation intake and refetches detail/Today.
  - `raw_stored` annotation result is displayed as saved, not as fatal failure.
  - Existing needs-review inline reply remains working.
  - Existing schedule prompt remains working.
  - No DB migration is added.
  - `docs/codebase-map.md` is updated.

- 자동 체크:
  - `corepack pnpm db:generate`
  - `corepack pnpm test:integration`
  - `corepack pnpm verify`
  - `git diff --check`

- 테스트 케이스:
  - Backend integration: event detail success includes people and annotations.
  - Backend integration: event detail includes nullable compact thread.
  - Backend integration: event detail 400/404 paths.
  - Backend integration: status patch success for representative outcome status.
  - Backend integration: status patch rejects uppercase and unknown values.
  - Backend integration: status patch works without LLM gateway.
  - Frontend: clicking a timeline event opens the sheet.
  - Frontend: sheet renders event detail, people, annotations.
  - Frontend: status button calls `PATCH /api/events/:id/status` and refetches.
  - Frontend: note submit calls `POST /api/events/:id/annotations` and refetches.
  - Frontend: empty note does not call fetch.
  - Frontend: raw-stored note result is treated as saved.
  - Frontend regression: needs-review reply and schedule prompt interactions still work.

- gas 한도: N/A
- slither 통과: N/A

## 누락된 엣지 케이스 후보 3개

- User opens a sheet, then the event becomes cancelled/annotated elsewhere
  before action. The UI should refetch after action and tolerate changed Today
  membership.
- Annotation save succeeds but parse is `raw_stored`; the event may disappear
  from needs-review because any annotation suppresses it. UI must not promise a
  status change unless `outcome` actually updates status.
- GCal-sourced event is locally status-patched. Cycle 16 does not mirror this
  back to Google Calendar; UI copy should avoid implying external calendar mutation.

## 더 단순한 대안 1개

Only add status buttons directly on Today cards without an event detail sheet.
This is faster, but it keeps event context, people, annotations, and future
actions scattered across cards. The bottom sheet is the better local pattern
because the design system already names bottom sheets as the main mobile action
surface.

## Assumptions

- Event detail can be assembled from existing `events`, `people`,
  `event_people`, `annotations`, and `threads` tables.
- Existing `annotations` table is sufficient.
- Existing `event_people` table is sufficient.
- No migration is expected.
- Status patch is local SQLite state only.
- LLM parsing remains limited to existing annotation intake.
- Full event edit and hard delete are later cycles.

## Review Guidance

### Enumeration 필요 항목

- Event routes/contracts:
  - Search: `rg -n "EventDetail|PatchEventStatus|/api/events/:id|event detail|status" shared/src server/src`
  - Expected: shared schema/type, backend route, repository/service helpers,
    integration tests.

- Today event sheet:
  - Search: `rg -n "event sheet|EventAction|selectedEvent|annotations|PATCH /api/events" web/src/Today.tsx web/src/Today.test.tsx`
  - Expected: open/close state, detail fetch, status patch, note submit,
    refetch behavior.

- LLM boundary:
  - Search: `rg -n "createLlmGateway|completeChat|LLM_PROXY_BASE_URL|/v1/chat/completions" server/src web/src`
  - Expected: no new LLM use in event detail/status routes; annotation intake
    remains the only sheet-triggered LLM path.

- Migration boundary:
  - Search: `find server/drizzle -maxdepth 2 -type f -print | sort`
  - Expected: no new migration files.

- Codebase map:
  - Search: `rg -n "GET /api/events/:id|PATCH /api/events/:id/status|event action|bottom sheet" docs/codebase-map.md`
  - Expected: new route and Today sheet locations documented.

### 검증 방식 가이드

- Backend detail/status behavior requires real temporary SQLite integration
  tests because people/annotations/thread joins must be proven against actual FK
  data.
- Frontend sheet behavior can use mocked fetch, but must verify request URLs,
  methods, payloads, and refetches.
- Mock-only backend tests are insufficient for detail joins.
- Reviewer should treat full edit/delete, GCal mirror mutation, and people
  editing inside the sheet as scope creep.
