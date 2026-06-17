# Cycle 10 — Thread Intake Linking + Index

Branch: `feature/cycle-10-thread-intake-linking`
Cycle: `10`
Created: `2026-06-17`
Skills: `backend-fastify, frontend-react-pwa`

## Summary

Cycle 9 added deterministic thread APIs and a read-only `/threads/:id` spine,
but the web app still has no practical path to create threads or attach Today
manual intake items to a thread. Cycle 10 makes the thread spine usable with
real local data: a web thread index, a simple manual thread creation route, and
an optional thread picker in Today task/event intake.

This remains deterministic scaffolding. It does not add natural-language thread
generation, graph editing, inferred links, slot suggestions, rollups, or LLM
behavior.

Out of scope:
- LLM thread draft generation
- natural-language planning in `/threads/new`
- link or `thread_links` editing
- firmness promotion
- contains rollup/cascade
- slot suggestion or feasibility scheduling
- migrations unless implementation discovers a real contract gap
- GCal export/mirror
- auth or remote access changes

## 입력/출력 명세

- Web `/threads`
  - Input: none.
  - Output:
    - Loading state while `GET /api/threads` is pending.
    - Quiet state when no thread summaries exist.
    - Live state listing thread summaries with progress/count metadata.
    - Error state when loading fails.
  - Actions:
    - Link each summary to `/threads/:id`.
    - Link to `/threads/new`.
- Web `/threads/new`
  - Input: manual form fields backed by existing `POST /api/threads`:
    `{ name, kind?, goal?, deadline? }`.
  - Validation: `name` must be non-empty after trim.
  - Output:
    - Success: create thread, then navigate to `/threads/:id`.
    - Failure: keep form values and show local error.
  - Constraint: copy must present this as simple manual scaffolding, not an AI
    planner.
- Today manual intake
  - Input: optional thread selection for both task and event creation.
  - Behavior:
    - Load thread summaries from `GET /api/threads`.
    - Include `threadId` in `POST /api/tasks` and `POST /api/events` only when
      the user selected one.
    - If thread list loading fails, unthreaded task/event creation remains
      available.
  - Output:
    - Newly created threaded events appear in Today timeline with existing
      `/threads/:id` link behavior.
    - Newly created threaded tasks appear in the thread detail spine.
- Backend API contract
  - Reuse existing `POST /api/threads`, `GET /api/threads`,
    `GET /api/threads/:id`, `POST /api/events`, and `POST /api/tasks`.
  - If `POST /api/events` or `POST /api/tasks` does not actually persist
    accepted `threadId`, fix that contract inside this cycle.

## Key Changes

- Shared:
  - Prefer existing thread and manual intake schemas.
  - Add or adjust shared exports only if web cannot consume an already existing
    thread summary or create payload type.
- Backend:
  - Keep existing thread route/service/repository boundaries.
  - Add integration coverage that event/task creation with `threadId` is
    persisted and visible through `GET /api/threads/:id`.
  - Do not add new routes unless a missing backend contract is discovered.
  - Keep thread and Today code deterministic; no LLM gateway import.
- Frontend:
  - Extend simple routing so `/threads` and `/threads/new` render web surfaces.
  - Add thread index with loading, quiet, live, and error states.
  - Add manual thread creation form and success navigation to `/threads/:id`.
  - Add optional thread picker to Today task/event intake.
  - Preserve existing Today loading, quiet, live, error, timeline, and
    annotation behaviors.
- Docs:
  - Update `docs/codebase-map.md` after implementation to include `/threads`,
    `/threads/new`, and Today thread picker navigation notes.

## Sprint Contract

- 통과 기준:
  - `/threads` renders thread summaries and all four UI states.
  - `/threads/new` creates a manual thread and navigates to its detail page.
  - Blank thread names are rejected client-side and server-side behavior remains
    covered by existing or new tests.
  - Today event intake can attach an event to a selected thread.
  - Today task intake can attach a task to a selected thread.
  - If the thread list fetch fails in Today, unthreaded creation still works.
  - `GET /api/threads/:id` shows events/tasks created through the public intake
    APIs with `threadId`.
  - No LLM dependency is introduced in thread index, thread creation, or Today
    aggregation.
  - No migration is added unless a schema gap is explicitly documented.
- 자동 체크:
  - `corepack pnpm db:generate`
  - `corepack pnpm test:integration`
  - `corepack pnpm verify`
  - `git diff --check`
- 테스트 케이스:
  - Backend integration: `POST /api/events` with `threadId` persists the link.
  - Backend integration: `POST /api/tasks` with `threadId` persists the link.
  - Backend integration: linked public-intake event/task appear in
    `GET /api/threads/:id`.
  - Frontend test: `/threads` loading, quiet, live, and error states render.
  - Frontend test: `/threads` summary links point to `/threads/:id`.
  - Frontend test: `/threads/new` rejects blank names.
  - Frontend test: `/threads/new` posts valid payload and navigates to the
    created thread detail.
  - Frontend test: Today thread picker includes available threads.
  - Frontend test: Today event submit includes selected `threadId`.
  - Frontend test: Today task submit includes selected `threadId`.
  - Frontend test: Today creation still works when thread-list fetch fails.
  - Frontend regression: existing `/today` four UI states remain covered.
- gas 한도: N/A
- slither 통과: N/A

## 누락된 엣지 케이스 후보 3개

- Thread list fetch in Today fails while Today data fetch succeeds; intake must
  stay usable instead of blocking the whole screen.
- User creates a thread and immediately navigates before the thread index cache
  updates; detail route should fetch by id rather than depend on stale list
  state.
- A selected thread is deleted or hidden in a later cycle before submit; Cycle
  10 should surface the backend failure cleanly instead of silently creating an
  unthreaded item.

## 더 단순한 대안 1개

Only add `/threads` and `/threads/new`, leaving Today intake unthreaded. This is
less risky, but it keeps the read-only spine hard to populate from the main user
flow. The selected plan adds the smallest useful link between capture and
context.

## Assumptions

- Cycle 9 thread APIs are present and merged.
- Existing tables already include `events.thread_id` and `tasks.thread_id`; no
  migration is expected.
- Existing create-event and create-task shared schemas are intended to support
  optional `threadId`.
- Manual thread creation is acceptable scaffolding before the later
  natural-language `/threads/new` planner.
- `/threads` as an index route is acceptable even though the product spec's
  primary routes emphasize `/threads/[id]` and `/threads/new`.
- Today remains the primary capture surface; thread forms should not become a
  second full task/event editor in this cycle.

## Review Guidance

### Enumeration 필요 항목

- Thread route and web surfaces:
  - Search: `rg -n "threads/new|/threads|Thread" web/src shared/src server/src`
  - Expected: `/threads`, `/threads/new`, and `/threads/:id` are routed
    intentionally; no accidental duplicate thread surfaces.
- Public intake thread linkage:
  - Search: `rg -n "threadId|thread_id" shared/src server/src/routes server/src/repositories server/src/services web/src`
  - Expected: create event/task payloads preserve selected thread ids and thread
    detail reads those rows.
- LLM boundary:
  - Search: `rg -n "createLlmGateway|completeChat|LLM_PROXY_BASE_URL|/v1/chat/completions" server/src web/src`
  - Expected: no new thread index/create or Today aggregation code imports the
    LLM gateway.
- Migration boundary:
  - Search: `find server/drizzle -maxdepth 2 -type f -print | sort`
  - Expected: no new migration unless clearly justified in review.
- Codebase map:
  - Search: `rg -n "threads/new|thread picker|/threads" docs/codebase-map.md`
  - Expected: map documents the new web routes and Today thread picker.

### 검증 방식 가이드

- Event/task `threadId` persistence must be verified with real temporary SQLite
  integration tests, not mocks.
- Web route and form behavior can be verified with Vitest component tests and
  mocked fetch.
- LLM exclusion is a boundary enumeration check, not a unit-test-only claim.
- If implementation changes simple routing mechanics, reviewer should verify
  `/`, `/today`, `/threads`, `/threads/new`, and `/threads/:id` still resolve
  predictably.
