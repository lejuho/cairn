# Thread Domain Filter A Implementation Plan

Branch: feature/cycle-67-thread-domain-filter
Cycle: 67
Created: 2026-06-27
Skills: backend-fastify, frontend-react-pwa

## Summary

Remaining implementation specs after cycle 66:

- `FR-DOM-01` is still absent: threads have no `personal` / `work` domain tag,
  so Today and thread views cannot separate private and work contexts.
- `FR-DOM-02/03`, movement, procurement, contacts generalization, GCal mirror
  export/recovery, watcher-B automation, and richer reflection prompts either
  require product decisions, external APIs, or a broader data model.
- `FR-FEAS-07` overrun correction still lacks a stable observed-estimate
  contract, so implementing it now would invent a model instead of preserving
  deterministic evidence.

Recommended next spec: **FR-DOM-01 Thread Domain Filter A**.

This cycle adds a small deterministic domain boundary to threads. Existing and
new threads default to `personal`; users can create `work` threads; list/detail
payloads expose the domain; `/threads` and `/today` can be viewed as all,
personal, or work. This cycle does not implement cross-domain reuse
suggestions, procurement/contact expansion, movement APIs, LLM calls, external
feeds, or automatic `feeds` link recommendations.

## Input/Output Spec

- Input:
  - Existing thread creation payload gains optional `domain: "personal" | "work"`.
  - Existing `GET /api/threads` gains optional
    `?domain=all|personal|work`; default is `all`.
  - Existing `GET /api/threads/:id` returns the thread's domain as part of the
    existing `ThreadRow`.
  - Existing `GET /api/today` gains optional `?domain=all|personal|work`;
    default is `all`.
- Normal output:
  - `ThreadRow.domain` is always lowercase `personal` or `work`.
  - Legacy rows and create requests without `domain` become `personal`.
  - `GET /api/threads` returns domain-tagged thread rows. When a domain filter
    is used, only matching thread rows are returned; `all` preserves current
    behavior.
  - `GET /api/threads/:id` includes the domain on the existing `thread` object.
  - `GET /api/today?domain=all` preserves current behavior.
  - `GET /api/today?domain=personal|work` includes only thread-linked Today
    items whose thread domain matches the selected domain.
  - Threadless Today items have no domain in this A-slice and therefore appear
    only in `all`, not in `personal` or `work`.
  - Today card priority and deterministic ordering remain unchanged after the
    filtered input set is selected.
  - `/threads` renders a 3-option domain segmented control: 전체 / 개인 / 업무.
  - `/today` renders the same 3-option domain segmented control and refetches
    Today with the selected domain.
  - `/threads/new` lets the user choose 개인 or 업무 with 개인 as the default.
  - `/threads/:id` displays a compact domain chip in the header.
- Failure behavior:
  - Invalid `domain` values in create/list/today inputs return `400
    VALIDATION_ERROR` and write nothing.
  - Applying a filter never mutates events, tasks, threads, links, watchers,
    annotations, resources, or params.
  - No new route, LLM, Gmail/GCal, Mirror write, movement, watcher automation,
    procurement, notification, push, CV/export, or cross-domain recommendation
    behavior is introduced.

## Key Changes

- Shared:
  - `shared/src/enums.ts`
    - Add `ThreadDomainSchema` / `ThreadDomain` for `personal | work`.
  - `shared/src/threads.ts`
    - Add required `domain` to `ThreadRowSchema`.
    - Add optional/defaulted `domain` to `CreateThreadRequestSchema`.
    - Add a thread-list domain query schema for `all | personal | work`.
  - `shared/src/today.ts`
    - Add a Today domain query schema or shared domain-filter type for
      `all | personal | work`.
  - Shared tests for valid/default/invalid domain values and strict lowercase
    persistence.
- Backend:
  - `server/src/db/schema.ts`
    - Add `threads.domain` with lowercase enum values, default `personal`.
  - `server/drizzle/0009_*.sql`
    - Add an additive SQLite migration:
      `ALTER TABLE threads ADD COLUMN domain TEXT NOT NULL DEFAULT 'personal'
      CHECK (domain in ('personal','work'));`
      Existing rows must pass without table rebuild.
  - `server/src/repositories/threads.ts`
    - Include domain in the stable `THREAD_ROW_COLUMNS` projection.
    - Persist create-thread domain, defaulting to `personal`.
    - Add filtered list helper or a filter parameter while preserving default
      all-thread ordering.
  - Today data path:
    - Load the thread domain needed to filter Today events/tasks/prompts.
    - Apply the domain filter before building the Today surface and feasibility
      panel inputs.
    - Treat threadless Today items as `all` only.
  - Route tests:
    - Cover migration/default/check behavior against a real temp SQLite DB.
    - Cover create/list/detail domain contracts.
    - Cover Today domain filtering and no-write behavior.
- Frontend:
  - `web/src/ThreadIndex.tsx`
    - Add a domain segmented control and pass the selected domain query to the
      API.
    - Render a compact domain chip on cards.
  - `web/src/ThreadNew.tsx`
    - Add a personal/work segmented control, default personal, included in
      create payload.
  - `web/src/Thread.tsx`
    - Render the thread domain chip in the header.
  - `web/src/Today.tsx`
    - Add the all/personal/work segmented control and include the selected
      domain in Today fetches.
    - Preserve loading, quiet, live, error, and access-session states.
  - `web/src/styles.css`
    - Add semantic-token styles for domain segmented controls/chips with 44px
      targets and reduced-motion safety.
- Docs:
  - `docs/codebase-map.md`
    - Record the `threads.domain` column, shared contract, route query, and UI
      filter boundaries.

## Sprint Contract

- Passing criteria:
  - `threads.domain` exists in Drizzle schema and migration, defaults to
    lowercase `personal`, and accepts only `personal` or `work`.
  - Existing rows migrated through `0009` receive `domain='personal'`.
  - `ThreadRowSchema` requires domain and rejects invalid values.
  - Creating a thread with no domain stores/returns `personal`.
  - Creating a thread with `domain='work'` stores/returns `work`.
  - Creating/listing/filtering with an invalid domain returns `400
    VALIDATION_ERROR` and writes nothing.
  - `GET /api/threads` default behavior remains all threads in existing order.
  - Domain-filtered thread listing includes only matching domains.
  - `GET /api/threads/:id` includes the thread domain and otherwise preserves
    the existing detail payload.
  - `GET /api/today` default behavior remains all current Today items.
  - `GET /api/today?domain=personal|work` includes only thread-linked
    events/tasks/prompts/cards whose thread domain matches.
  - Threadless Today items appear only in `all`, not in domain-specific views.
  - Today filtering preserves the existing card priority and deterministic
    ordering within the filtered set.
  - Domain filters are read-only and do not mutate any table.
  - `/threads`, `/threads/new`, `/threads/:id`, and `/today` render domain UI
    with semantic tokens, keyboard-focusable controls, and 44px targets.
  - Domain filter changes do not fetch mutation endpoints and do not create,
    edit, schedule, confirm, or recommend cross-domain links.
  - No `FR-DOM-02/03`, movement, procurement, contacts generalization, external
    API, LLM, Gmail/GCal, watcher automation, notification, push, Mirror write,
    or CV/export behavior is introduced.
  - `docs/codebase-map.md` reflects the new schema/contract/filter boundary.
- Automatic checks:
  - `corepack pnpm lint`
  - `corepack pnpm typecheck`
  - `corepack pnpm test`
  - `corepack pnpm test:integration`
  - `corepack pnpm build`
  - `corepack pnpm verify`
  - `git diff --check master...HEAD`
  - `corepack pnpm db:generate` only if the implementation relies on
    drizzle-kit to create migration metadata; generated SQL must be inspected
    and kept additive for SQLite legacy rows.
- Test cases:
  - Shared:
    - `ThreadDomainSchema` accepts `personal` and `work`, rejects uppercase or
      unknown values.
    - `CreateThreadRequestSchema` defaults missing domain to `personal` and
      rejects invalid domain.
    - `ThreadRowSchema` requires valid domain.
    - Today domain query accepts `all|personal|work`, defaults to `all`, and
      rejects invalid values.
  - Backend integration:
    - Migration applies to a temp DB with pre-existing threads and gives them
      `personal`.
    - DB constraint rejects invalid inserted domain.
    - `POST /api/threads` with omitted domain returns/stores `personal`.
    - `POST /api/threads` with `work` returns/stores `work`.
    - Invalid create domain returns 400 and no thread row is inserted.
    - `GET /api/threads` all/personal/work list filters are correct and ordered.
    - `GET /api/threads/:id` includes domain and all existing detail fields.
    - `GET /api/today?domain=personal|work` filters thread-linked events,
      tasks, needs-review, unscheduled event prompts, due-task prompts, and
      feasibility inputs to the selected domain.
    - Threadless events/tasks/watchers are present in `all` and absent from
      domain-specific Today views.
    - Domain-filtered Today GET preserves row counts for threads, events, tasks,
      watchers, annotations, params, resources, links, and thread_links.
  - Frontend:
    - Thread index renders all/personal/work segmented controls and filters
      cards without mutation requests.
    - Thread create defaults to personal and sends work when selected.
    - Thread detail displays the domain chip.
    - Today segmented control refetches with the selected domain, renders the
      filtered response, and keeps quiet/error/access states intact.
    - Domain controls are buttons/segments with `aria-pressed` or equivalent
      selected state and 44px touch targets.
  - Static negative checks:
    - No cross-domain suggestion/auto-link scope:
      `git diff -U0 master...HEAD -- server/src shared/src web/src | rg -n 'FR-DOM-02|FR-DOM-03|cross-domain|reuse suggestion|auto.*feeds|recommend.*feeds'`
      should have no implementation matches.
    - No external/LLM/GCal/Gmail/Mirror write/movement/watcher/procurement/CV
      behavior:
      `git diff -U0 master...HEAD -- server/src shared/src web/src docs | rg -n 'completeChat|LLM_PROXY_BASE_URL|gmail|Gmail|googleapis|/api/mirror|movement|scheduler|cron|procurement|Typst|pcli|resume-export|notificationDraft'`
      should have no implementation matches outside docs explaining exclusions.
    - New backend writes are limited to thread creation and migration:
      inspect changed backend code for added `.insert(`, `.update(`,
      `.delete(`, `POST`, `PATCH`, or `DELETE`; domain filters must be read-only.
- gas limit: N/A
- slither pass: N/A

## Missing Edge Case Candidates

- Threadless Today data has no thread domain. This cycle treats it as visible
  only in `all`; otherwise a work view could leak personal-ish unsorted items or
  a personal view could silently claim ownership of unclassified data.
- Legacy SQLite rows must remain valid after migration. A table rebuild or
  missing default would be high risk for existing Raspberry Pi data.
- Domain filtering can accidentally preserve unfiltered feasibility or card
  arrays while filtering only visible lists. The filter must apply before Today
  surface construction, not as a partial UI-only hide.

## Simpler Alternative

Frontend-only filter on `/threads` labels, with no DB column and no Today query.

Rejected because it would not tag persisted threads, would not let Today filter
deterministically on the server, and would fail the spec's "thread에
`personal`/`work`" requirement.

## Assumptions

- The unresolved product question "domain 기본값" is resolved for this A-slice
  as `personal` for both legacy rows and omitted create requests.
- Domain is a property of `threads`, not of events/tasks/watchers/resources in
  this cycle.
- Threadless Today items are intentionally unclassified and visible only in
  `all`.
- Cross-domain `feeds` links already exist as a link kind, but this cycle does
  not add any automatic cross-domain suggestion or approval flow.

## Review Guidance

### Enumeration Required

- Thread domain contract and all `ThreadRow` consumers:
  - Search: `rg -n "ThreadDomain|ThreadRowSchema|ThreadRow|CreateThreadRequestSchema|ThreadSummarySchema|domain" shared/src server/src web/src`
  - Expected: shared schemas/types, thread repository projection/create/list,
    thread routes, ThreadIndex, ThreadNew, Thread detail, Today filter code, and
    tests are updated. No procurement/contact/movement modules should appear.
- Today filtering path:
  - Search: `rg -n "domain|buildTodaySurface|find.*Today|watcherBubbles|unscheduledEvents|dueTaskSchedulePrompts" server/src/routes/today.ts server/src/services/today.ts server/src/repositories`
  - Expected: domain query validation at route boundary, filtering before
    `buildTodaySurface`, and explicit handling for threadless rows.
- Migration/schema consistency:
  - Search: `rg -n "domain|threads_domain" server/src/db/schema.ts server/drizzle`
  - Expected: `threads.domain` in Drizzle schema and exactly one cycle-67
    migration adding a defaulted checked column.
- Frontend controls:
  - Search: `rg -n "domain|aria-pressed|ThreadDomain|today.*domain|thread.*domain" web/src/ThreadIndex.tsx web/src/ThreadNew.tsx web/src/Thread.tsx web/src/Today.tsx web/src/styles.css web/src/*.test.tsx`
  - Expected: segmented controls/chips are keyboard-accessible and tests cover
    filtering/refetching/no mutation.

### Verification Method Guide

- "DB default/check behavior":
  - Mock tests are insufficient. Must use a real temp SQLite database and
    migration/schema integration coverage.
- "Create/list/detail API contract":
  - Backend integration tests through Fastify `app.inject` are required because
    route validation/defaulting and repository persistence both matter.
- "Today domain filtering":
  - Backend integration tests are required; UI-only tests are insufficient
    because filtering must happen before Today surface construction.
- "Frontend segmented controls":
  - Component tests are sufficient for rendering, selected state, fetch query,
    and no-mutation assertions. Manual mobile/light/dark/reduced-motion
    inspection remains a final implementation check.
- "No scope creep":
  - Static diff checks plus file enumeration are sufficient. Any match in
    movement/procurement/LLM/external/suggestion paths must be justified or
    removed before review can pass.
