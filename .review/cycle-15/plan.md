# Cycle 15 — People Tagging A

Branch: `feature/cycle-15-people-tagging-a`
Cycle: `15`
Created: `2026-06-17`
Skills: backend-fastify, frontend-react-pwa

## Summary

People data is already present in the Cycle 1 schema (`people`,
`event_people`), but the product has no usable UI/API for tagging who is
involved in an event. Cycle 15 implements People Tagging A: create/list people,
attach/detach people to events, expose people on event detail surfaces, and let
manual event input select people.

This cycle builds the base for later social cost, notification drafts, people
filters, and preference windows. It does not implement inference or scoring.

Out of scope:
- Automatic people extraction from text/GCal/Gmail
- Relationship statistics beyond simple counts
- People preference windows
- Social cost weighting
- Notification draft generation
- People profile detail page
- Bulk merge/dedup UI
- New DB tables or migrations
- LLM behavior

## 입력/출력 명세

- `GET /api/people`
  - Return `{ ok: true, data: PersonRow[] }`.
  - Sort by `display_name` ascending, then `id` ascending.

- `POST /api/people`
  - Body: `{ "displayName": string, "relation"?: string, "channel": string }`.
  - `displayName` must be non-empty after trim.
  - `channel` must be one of existing DDL values: `none | kakao | sms | email | telegram`.
  - `relation`, if present, trims to nullable string.
  - Return `{ ok: true, data: { person } }`.
  - Failure: `400 VALIDATION_ERROR`.

- `GET /api/events/:id/people`
  - Event id must be positive and exist.
  - Return `{ ok: true, data: { event, people } }`.
  - Failure: `400 VALIDATION_ERROR`, `404 NOT_FOUND`.

- `PUT /api/events/:id/people`
  - Body: `{ "personIds": number[] }`.
  - Event id must be positive and exist.
  - `personIds` must be positive integers.
  - All people must exist.
  - Replace full event people set transactionally.
  - Return `{ ok: true, data: { event, people } }`.
  - Empty list is valid and detaches all people.
  - Duplicate ids are de-duped.
  - Failures:
    - `400 VALIDATION_ERROR`
    - `404 NOT_FOUND`

- Extend event creation APIs:
  - Existing `POST /api/events` may accept optional `personIds?: number[]`.
  - Existing manual event forms may pass selected `personIds`.
  - No person selection for tasks in Cycle 15.

- Frontend:
  - `/input` manual event form loads `GET /api/people`.
  - If people exist, render multi-select/checklist for event people.
  - Event submit includes `personIds`.
  - People fetch failure degrades gracefully: event form remains usable without people.
  - Add lightweight "new person" inline form inside `/input`:
    - fields: display name, channel, relation optional
    - calls `POST /api/people`
    - on success refreshes people list and selects the new person for current event form
  - Today timeline/event cards may show compact people names when already present
    only if API response is extended safely. If too invasive, defer display to
    `/input` event creation only.

## Key Changes

- Shared:
  - Add Zod schemas/types for people row, create person request, event-people
    response, event-people replace request.
  - Extend create event request with optional `personIds`.
- Backend:
  - Add people repository helpers.
  - Add people routes:
    - `GET /api/people`
    - `POST /api/people`
    - `GET /api/events/:id/people`
    - `PUT /api/events/:id/people`
  - Extend `POST /api/events` to attach people transactionally.
  - Use existing `people` and `event_people` tables only.
- Frontend:
  - Extend `/input` manual event form with people checklist and inline person
    creation.
  - Preserve quick capture, task form, unscheduled scheduling, and app nav.
- Docs:
  - Update `docs/codebase-map.md` with people shared contracts,
    repository/routes, and `/input` people selection.

## Sprint Contract

- 통과 기준:
  - `GET /api/people` returns people sorted by display name.
  - `POST /api/people` trims display name and relation.
  - Invalid empty display name rejected with `400 VALIDATION_ERROR`.
  - Invalid channel rejected with `400 VALIDATION_ERROR`.
  - `GET /api/events/:id/people` returns event plus attached people.
  - `PUT /api/events/:id/people` replaces event people transactionally.
  - `PUT` accepts empty array and detaches all.
  - `PUT` de-dupes duplicate ids.
  - `PUT` rejects missing event or missing person with typed errors.
  - `POST /api/events` accepts `personIds` and writes `event_people`.
  - Existing event creation without `personIds` still works.
  - `/input` loads people and event form can submit selected people.
  - `/input` people fetch failure does not block event/task/quick capture use.
  - `/input` inline person creation works and selects the created person.
  - No DB migration is added.
  - No LLM imports are added.
  - `docs/codebase-map.md` is updated.
- 자동 체크:
  - `corepack pnpm db:generate`
  - `corepack pnpm test:integration`
  - `corepack pnpm verify`
  - `git diff --check`
- 테스트 케이스:
  - Backend integration: people create/list validation and sorting.
  - Backend integration: event people get/replace/detach/dedup/missing refs.
  - Backend integration: event creation with `personIds` writes composite
    join rows.
  - Backend integration: duplicate event-person rows rejected by composite PK
    remains covered or newly asserted.
  - Frontend: `/input` renders people selector when people exist.
  - Frontend: event submit includes selected `personIds`.
  - Frontend: people fetch failure keeps event form usable.
  - Frontend: inline person creation posts to `/api/people`, refreshes list,
    and selects created person.
  - Frontend regression: quick capture, task form, unscheduled scheduling
    still work.
- gas 한도: N/A
- slither 통과: N/A

## 누락된 엣지 케이스 후보 3개

- Person created twice with same display name; Cycle 15 should allow it unless
  existing DDL has uniqueness, because merge/dedup is out of scope.
- Event creation succeeds but people attachment fails; backend should use a
  transaction so no partial event-without-people surprise is returned.
- User creates a person while people list refresh fails; the inline form should
  show an error or keep the new person selected from response, not silently
  drop it.

## 더 단순한 대안 1개

Only add backend people APIs and skip `/input` integration. This is easier, but
the product problem is user-accessible tagging. Without the `/input` selector,
people remain an invisible table and later social-cost cycles lack usable data.

## Assumptions

- Existing `people` and `event_people` tables are sufficient.
- Channel enum follows current DDL values.
- People tagging is manual in Cycle 15.
- Event people selection belongs to event input, not task input.
- No person detail page is needed yet.
- No migration is expected.

## Review Guidance

### Enumeration 필요 항목

- People schema/routes/repository:
  - Search: `rg -n "Person|people|event_people|eventPeople|personIds" shared/src server/src`
  - Expected: shared schemas, repository helpers, routes, event creation attach
    path.
- Input hub people UI:
  - Search: `rg -n "personIds|people|displayName|/api/people" web/src/InputHub.tsx web/src/InputHub.test.tsx`
  - Expected: people load, checklist, inline create, selected ids in event
    submit.
- Migration boundary:
  - Search: `find server/drizzle -maxdepth 2 -type f -print | sort`
  - Expected: no new migration files.
- LLM boundary:
  - Search: `rg -n "createLlmGateway|completeChat|LLM_PROXY_BASE_URL|/v1/chat/completions" server/src web/src`
  - Expected: no new LLM use for people tagging.
- Codebase map:
  - Search: `rg -n "people|event_people|personIds|/api/people" docs/codebase-map.md`
  - Expected: route/repository/shared/UI locations documented.

### 검증 방식 가이드

- People/event_people persistence and replace behavior require real temporary
  SQLite integration tests.
- Frontend people selector and inline create can use mocked fetch.
- Mock-only backend tests are insufficient because composite PK and FK behavior
  must be proven.
- Reviewer should treat automatic extraction, social-cost scoring, preference
  windows, notification drafts, and migrations as scope creep.
