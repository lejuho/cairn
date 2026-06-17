# Cycle 14 — Navigation + Input Hub

Branch: `feature/cycle-14-navigation-input-hub`
Cycle: `14`
Created: `2026-06-17`
Skills: frontend-react-pwa, backend-fastify

## Summary

Current user-input surfaces exist, but most are reachable only through
`/today` state:

- quick flat capture on Today
- manual event/task bottom sheet on Today
- needs-review reply cards on Today
- unscheduled event slot selection cards on Today
- thread creation at `/threads/new`, reachable from `/threads`

Cycle 14 adds an app-level navigation shell and a dedicated `/input` hub so
user-initiated input is reachable even when Today has no relevant card. Today
remains the push/interrupt surface. `/input` becomes the pull surface for
explicit user entry.

Out of scope:
- New DB tables or migrations
- Auth/remote boundary changes
- New LLM parser behavior
- Natural-language thread generation
- Task slot suggestion
- People preference editing
- GCal export/mirror
- Telegram/Web Push behavior
- Full design-system redesign

## 입력/출력 명세

- App navigation
  - Add shared app shell navigation visible on primary routes.
  - Navigation targets:
    - `/today` — Today
    - `/input` — Input hub
    - `/threads` — Threads
  - Current route has `aria-current="page"`.
  - Touch targets at least 44px.
  - Reduced-motion preference honored.
  - Unknown routes still render not-found state with navigation available.

- Add `/input`
  - Purpose: explicit user input hub.
  - UI sections:
    - Quick capture:
      - One-line text input.
      - Calls existing `POST /api/capture/flat-event`.
      - Empty submit rejected client-side.
      - Scheduled result shows "저장됐어".
      - Raw/unscheduled result shows "날짜 없이 저장됐어".
    - Manual add:
      - Event form using existing `POST /api/events`.
      - Task form using existing `POST /api/tasks`.
      - Reuse current validation rules from Today bottom sheet.
      - Optional thread picker via existing `GET /api/threads`.
    - Unscheduled events:
      - List unscheduled Cairn planned events.
      - Load from existing `GET /api/today?date=<today>&now=<now>` using
        `unscheduledEvents`.
      - Each item can load existing
        `GET /api/events/:id/slot-candidates?date&now&days=7`.
      - Candidate selection calls existing `PATCH /api/events/:id/schedule`
        then refetches hub data.
      - Empty candidate, loading, and local error states shown.
  - Four UI states:
    - loading
    - quiet
    - live
    - error

- Today interaction
  - Keep Today quick capture and existing cards working.
  - Add a visible link/CTA from Today to `/input`.
  - Do not remove existing Today input surfaces in Cycle 14.

- Backend
  - Prefer no new backend endpoints.
  - If implementation proves a lightweight read endpoint is required, it must
    be explicitly limited to reading unscheduled events and covered by tests.
  - Existing deterministic and LLM boundaries remain unchanged.

## Key Changes

- Frontend:
  - Add app navigation component used by all top-level route surfaces.
  - Add `/input` route in `web/src/App.tsx`.
  - Add `web/src/InputHub.tsx` for quick capture, manual add, and unscheduled
    event scheduling.
  - Extract small shared client helpers only if needed to avoid duplicating
    fetch/serialization code from Today.
  - Keep Today behavior stable.
- Backend:
  - No backend change expected.
  - If unavoidable, add only a narrow deterministic read route and shared
    schema.
- Docs:
  - Update `docs/codebase-map.md` with app nav and `/input` hub.

## Sprint Contract

- 통과 기준:
  - `/today`, `/input`, `/threads`, `/threads/new`, and `/threads/:id` render
    app navigation.
  - Navigation has links to `/today`, `/input`, `/threads`.
  - Current route sets `aria-current="page"`.
  - `/input` quick capture posts to `POST /api/capture/flat-event`.
  - `/input` quick capture empty submit does not call fetch.
  - `/input` manual event form posts to `POST /api/events`.
  - `/input` manual task form posts to `POST /api/tasks`.
  - `/input` thread picker uses `GET /api/threads` and degrades gracefully.
  - `/input` lists unscheduled events from Today `unscheduledEvents`.
  - `/input` can load slot candidates and schedule an unscheduled event.
  - Failed quick capture/manual add/candidate load/schedule actions keep the
    relevant input visible and show local error.
  - Today still renders quick capture and existing schedule prompt cards.
  - No LLM imports are added to deterministic Today or slot code.
  - No DB migration is added.
  - `docs/codebase-map.md` is updated.
- 자동 체크:
  - `corepack pnpm db:generate`
  - `corepack pnpm test:integration`
  - `corepack pnpm verify`
  - `git diff --check`
- 테스트 케이스:
  - Frontend: app nav renders on `/today`, `/input`, `/threads`, `/threads/new`,
    `/threads/:id`, and not-found route.
  - Frontend: nav current state matches route.
  - Frontend: `/input` loading, quiet, live, and error states.
  - Frontend: `/input` empty quick capture does not call capture endpoint.
  - Frontend: `/input` valid quick capture posts and shows saved message.
  - Frontend: `/input` event form posts RFC3339 offset strings.
  - Frontend: `/input` task form posts expected payload.
  - Frontend: `/input` thread picker includes `threadId` when selected.
  - Frontend: `/input` unscheduled event card loads candidates.
  - Frontend: `/input` candidate selection patches schedule and refetches hub.
  - Frontend: action failure keeps form/card visible and shows error.
  - Frontend regression: Today quick capture still works.
  - Backend integration: only needed if a new backend route is added.
- gas 한도: N/A
- slither 통과: N/A

## 누락된 엣지 케이스 후보 3개

- `/input` loads Today data using current local date while user crosses
  midnight during the session; refresh should recompute `now` and `date`.
- User schedules an unscheduled event from `/input` while Today still has stale
  schedule prompt state; scheduling PATCH must already be conflict-safe, and
  both pages refetch on next interaction.
- Thread list fetch fails but manual event/task creation should remain usable
  without thread assignment.

## 더 단순한 대안 1개

Add only a nav link to existing Today inputs and `/threads/new`. This is
simpler, but it leaves user-initiated capture and unscheduled scheduling
dependent on Today state. A dedicated `/input` hub better matches the product
split: Today is push surface, Input is pull surface.

## Assumptions

- Cycle 14 priority is reachability, not new scheduling intelligence.
- Existing APIs are enough for the hub.
- Today keeps its current input controls for now to avoid a disruptive UX
  migration.
- `/input` may duplicate small UI patterns from Today in this cycle; extraction
  can happen only if it reduces real complexity.
- No schema or migration change is expected.

## Review Guidance

### Enumeration 필요 항목

- Routes and nav:
  - Search: `rg -n "/input|AppNav|aria-current|href=\\\"/(today|input|threads)" web/src`
  - Expected: `/input` route registered, nav rendered on primary pages,
    current route indicated.
- Input hub API calls:
  - Search: `rg -n "flat-event|POST /api/events|/api/events\\\"|/api/tasks|slot-candidates|/schedule|/api/threads" web/src/InputHub.tsx web/src`
  - Expected: `/input` uses existing endpoints; no new backend calls unless
    planned and tested.
- Backend boundary:
  - Search: `git diff --name-only master...HEAD server shared server/drizzle`
  - Expected: ideally no backend/shared/migration changes. Any backend/shared
    change must be narrow and justified.
- LLM boundary:
  - Search: `rg -n "createLlmGateway|completeChat|LLM_PROXY_BASE_URL|/v1/chat/completions" web/src server/src/routes server/src/services`
  - Expected: no new LLM dependency for navigation or input hub.
- Codebase map:
  - Search: `rg -n "/input|InputHub|AppNav|navigation" docs/codebase-map.md`
  - Expected: navigation and `/input` hub documented.

### 검증 방식 가이드

- This cycle is mostly frontend. Vitest component tests with mocked fetch are
  sufficient for UI state and endpoint-call contracts.
- Existing backend integration tests remain enough if no backend route changes.
- If a backend route is added, real temporary SQLite integration tests are
  required.
- Reviewer should treat new LLM parsing, migrations, task slot suggestion,
  people preference editing, and Telegram/Web Push changes as scope creep.
