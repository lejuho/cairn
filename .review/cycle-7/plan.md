# Cycle 7 — Manual Intake UI

Branch: `feature/cycle-7-manual-intake-ui`
Cycle: `7`
Created: `2026-06-17`
Skills: `frontend-react-pwa`

## Summary

Cycle 7 makes the current web app usable with an empty local SQLite database.
`/today` already renders deterministic data from existing backend APIs, but the
web UI has no way to create local tasks or events. This cycle adds a small
manual intake bottom sheet to `/today` and reuses the existing
`POST /api/tasks`, `POST /api/events`, and `GET /api/today` contracts.

Out of scope:
- backend route changes
- migrations
- LLM or natural-language parsing
- threads/timeline pages
- watcher creation UI
- GCal mirror/export
- recurring events
- offline write queue
- auth or remote access boundary changes

Precondition: the current root `README.md` docs change is either committed on
`master` before implementation starts or deliberately kept outside this cycle.

## 입력/출력 명세

- 입력:
  - `/today` user action: open manual intake sheet.
  - Task form:
    - `title: string` required.
    - `estMinutes: positive integer`, default `2`.
  - Event form:
    - `title: string` required.
    - `start: datetime-local` required.
    - `end: datetime-local` required.
- 출력:
  - Task success:
    - Call `POST /api/tasks` with `{ title, estMinutes }`.
    - Close sheet, clear form, refetch `GET /api/today`.
  - Event success:
    - Call `POST /api/events` with `{ title, start, end }`.
    - Serialize `datetime-local` values as RFC3339 strings with local offset.
    - Close sheet, clear form, refetch `GET /api/today`.
  - 실패:
    - Blank title is rejected client-side.
    - Event `end <= start` is rejected client-side.
    - Network/server errors keep the sheet open and show local error text.
    - Backend validation remains the source of truth.

## Key Changes

- Frontend:
  - Add a header-level `추가` action to `/today` in quiet and live states.
  - Add a quiet-state primary CTA so an empty DB has an obvious next action.
  - Add a mobile-first bottom sheet with two modes: `작업 추가` and `일정 추가`.
  - Add pending submit state and duplicate-submit prevention.
  - Preserve existing loading, quiet, live, and error states.
  - Preserve current task done and annotation reply behavior.
  - Keep touch targets at least 44px and respect reduced-motion styling.
- Backend:
  - No backend implementation expected.
  - Existing APIs must remain unchanged:
    - `POST /api/tasks`
    - `POST /api/events`
    - `GET /api/today`
- Shared:
  - No shared schema change expected.
  - Use existing `CreateTaskRequest` and `CreateEventRequest` shapes.
- Docs:
  - Update `docs/codebase-map.md` to mention the Today manual intake bottom
    sheet after implementation.

## Sprint Contract

- 통과 기준:
  - Empty `/today` shows a clear path to create the first task or event.
  - A default task submit creates a two-minute task and it appears after refetch.
  - A valid event submit creates an event and it appears in Today when it matches
    the selected date/now rules.
  - Failed submits do not lose user-entered text.
  - No backend routes, migrations, or LLM boundaries are added.
- 자동 체크:
  - `corepack pnpm db:generate`
  - `corepack pnpm test:integration`
  - `corepack pnpm verify`
  - `git diff --check`
- 테스트 케이스:
  - Quiet state renders add CTA.
  - Live state renders add action without hiding existing cards.
  - Bottom sheet opens and switches between task/event modes.
  - Empty task title does not call `fetch`.
  - Valid task submit calls `POST /api/tasks`, then refetches `/api/today`.
  - Empty event title does not call `fetch`.
  - Event `end <= start` does not call `fetch`.
  - Valid event submit calls `POST /api/events` with RFC3339 offset strings,
    then refetches `/api/today`.
  - Submit failure keeps the sheet open and shows an error.
  - Existing task done and annotation reply tests continue to pass.
- gas 한도: N/A
- slither 통과: N/A

## 누락된 엣지 케이스 후보 3개

- Browser timezone offset serialization shifts the `YYYY-MM-DD` prefix and makes
  Today filtering miss the event.
- Duplicate submit creates duplicate local tasks/events if pending state is not
  enforced.
- Server validation error is shown as a generic failure, leaving the user unable
  to understand what to fix.

## 더 단순한 대안 1개

Add only a task form and postpone event creation. This would solve the two-minute
task empty state faster, but it would not let the user create actual schedule
data, so `/today` would still be weak for next-event and needs-review flows.

## Assumptions

- Existing backend create APIs are sufficient for Cycle 7.
- New tasks default to `estMinutes=2` because Today only surfaces two-minute
  tasks.
- Browser local timezone offset is acceptable for Cycle 7 event serialization.
- Watcher creation waits for a later cycle.
- Timeline/thread UI waits for a later cycle after manual local data entry is
  usable.

## Review Guidance

### Enumeration 필요 항목

- Frontend intake surface:
  - Search: `rg -n "POST /api/tasks|POST /api/events|datetime-local|추가|작업 추가|일정 추가" web/src`
  - Expected: only Today/manual intake UI owns these create calls.
- Backend route creep:
  - Search: `rg -n "app\\.(post|patch|put|delete)\\(" server/src/routes`
  - Expected: no new route is required for this cycle.
- LLM boundary:
  - Search: `rg -n "LLM_PROXY_BASE_URL|completeChat|createLlmGateway|/v1/chat/completions" web/src server/src/routes server/src/services`
  - Expected: no LLM dependency is added for manual intake.
- Migration boundary:
  - Search: `find server/drizzle -maxdepth 2 -type f -print | sort`
  - Expected: no new migration file.
- Codebase map:
  - Search: `rg -n "manual intake|bottom sheet|Today" docs/codebase-map.md`
  - Expected: map mentions the new Today manual intake surface.

### 검증 방식 가이드

- UI behavior:
  - Vitest component tests are sufficient for opening the sheet, validation,
    fetch calls, pending/error states, and refetch behavior.
- Backend persistence:
  - Existing integration tests are sufficient unless implementation changes
    backend behavior. No new DB integration test is expected.
- RFC3339 event serialization:
  - Unit/component tests should assert the request payload shape.
- PWA build:
  - `corepack pnpm verify` must still pass and emit PWA assets through existing
    build checks.
