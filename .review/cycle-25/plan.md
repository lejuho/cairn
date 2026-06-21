# Thread Links A Implementation Plan

Branch: `feature/cycle-25-thread-links-a`
Cycle: `25`
Created: `2026-06-21`
Skills: `backend-fastify, frontend-react-pwa, design-principles`

## Summary

Cycle 25 starts the Thread advanced-feature path with manual thread
relationships. The database already has `thread_links`; current screens expose
threads as isolated spines. This cycle makes the existing table useful without
adding LLM generation, rollups, settlement, or sequencing optimization.

Goal:

- expose thread-to-thread links in shared contracts and API responses;
- let the user add and remove an outgoing relationship from a thread detail
  screen;
- show incoming and outgoing relationships on `/threads/:id`;
- show lightweight relationship counts on `/threads`;
- enforce the minimum graph invariants needed before future contains rollups.

Out of scope:

- natural-language thread generation;
- inferred relationships or missing-node suggestions;
- event/task `links` editing;
- contains progress/energy/cost rollup;
- parent cancellation cascade;
- sequence optimization or context-switch scoring;
- thread settlement/cost accounting;
- new migrations, tables, or columns;
- LLM calls.

This is the A-level delivery of FR-THR-09 and the foundation for FR-THR-10.

## Input/Output Contract

- Existing endpoints remain compatible:
  - `POST /api/threads`
  - `GET /api/threads`
  - `GET /api/threads/:id`

- Extend `GET /api/threads` summary rows:
  ```json
  {
    "thread": {},
    "eventCount": 2,
    "taskCount": 3,
    "doneCount": 1,
    "totalCount": 5,
    "relationCounts": {
      "incoming": 1,
      "outgoing": 2
    }
  }
  ```

- Extend `GET /api/threads/:id` detail:
  ```json
  {
    "thread": {},
    "events": [],
    "tasks": [],
    "progress": { "done": 1, "total": 5 },
    "relations": {
      "incoming": [
        {
          "id": 10,
          "fromThread": { "id": 1, "name": "상위 프로젝트" },
          "toThread": { "id": 2, "name": "현재 스레드" },
          "kind": "contains",
          "firmness": "hard",
          "createdAt": "2026-06-21T00:00:00"
        }
      ],
      "outgoing": []
    }
  }
  ```

- Add manual outgoing link creation:
  - `POST /api/threads/:id/links`
  - Body:
    - `toThreadId`: positive integer, not equal to `:id`;
    - `kind`: `contains | blocks | feeds | competes | shares`;
    - `firmness`: optional `hard | soft`, default `hard`.
  - Success:
    - `201 { ok: true, data: { link: ThreadLinkRow } }` for a new row;
    - `200 { ok: true, data: { link: ThreadLinkRow } }` for an existing
      identical `(fromThread, toThread, kind)` row, preserving idempotency.
  - Errors:
    - `400 VALIDATION_ERROR` for invalid ids, self-link, invalid kind/firmness;
    - `404 NOT_FOUND` when either thread does not exist;
    - `409 CONTAINS_CYCLE` when a `contains` link would create a cycle;
    - `409 CONTAINS_PARENT_CONFLICT` when `toThreadId` already has a different
      hard `contains` parent.

- Add outgoing link deletion:
  - `DELETE /api/threads/:id/links/:linkId`
  - Success: `200 { ok: true }`.
  - Errors:
    - `400 VALIDATION_ERROR` for invalid ids;
    - `404 NOT_FOUND` when the link does not exist or is not outgoing from
      `:id`.

- Thread-link persistence:
  - Use existing `thread_links` table.
  - Persist enum values lowercase exactly as DDL allows.
  - `firmness="hard"` means user-authored/confirmed in this cycle.
  - `firmness="soft"` is accepted so future suggestions can share the contract,
    but this cycle creates only user-confirmed rows from the UI.
  - `contains` is directional: `fromThread` parent contains `toThread` child.
  - Other kinds are stored directionally and displayed as incoming/outgoing; no
    reverse row is auto-created.

## Key Changes

- Shared:
  - Extend `shared/src/threads.ts` with:
    - `ThreadLinkFirmnessSchema` (`hard | soft`);
    - `ThreadLinkRowSchema`;
    - `ThreadLinkPeerSchema`;
    - `ThreadLinkViewSchema`;
    - `ThreadRelationsSchema`;
    - `CreateThreadLinkRequestSchema`;
    - extended `ThreadSummarySchema.relationCounts`;
    - extended `ThreadDetailSchema.relations`.
  - Reuse `ThreadLinkKindSchema` from `shared/src/enums.ts`.
  - Export new types from the shared barrel.

- Backend:
  - Add thread-link repository helpers in `server/src/repositories/threads.ts`
    or a focused `thread-links.ts` repository:
    - find thread existence for two ids;
    - find duplicate `(fromThread, toThread, kind)`;
    - list incoming/outgoing links with peer thread names;
    - count incoming/outgoing links for summaries;
    - insert outgoing link;
    - delete outgoing link by id/fromThread.
  - Add a pure graph service for thread-link invariants:
    - no self-link;
    - `contains` cycle check by traversing existing `contains` edges;
    - hard-parent conflict check for `contains`.
  - Extend `server/src/services/threads.ts` to include relation data in detail
    and counts in summaries.
  - Extend `server/src/routes/threads.ts` with POST/DELETE link endpoints.
    Route handlers stay thin: validate params/body, call service, map stable
    error codes.
  - Keep deterministic behavior with no LLM gateway dependency.
  - No migration expected; if `db:generate` finds a schema change, stop and
    reassess scope before adding a migration.

- Frontend:
  - Migrate Thread/ThreadIndex/ThreadNew fetch paths to `apiJson` while touching
    these screens, preserving existing behavior and access-session handling.
  - `/threads`:
    - show relation count chips only when count > 0;
    - keep loading/empty/live/error states.
  - `/threads/:id`:
    - render a `관계` section in live state;
    - list outgoing and incoming relationships with kind, firmness, and peer
      thread links;
    - empty relationship state says `아직 연결된 스레드가 없어`;
    - add a compact bottom sheet or inline form to create an outgoing link:
      select target thread, kind, and save;
    - exclude the current thread from target options;
    - delete only outgoing links with explicit button;
    - show local 409 messages for `CONTAINS_CYCLE` and
      `CONTAINS_PARENT_CONFLICT`.
  - Preserve semantic tokens, 44px targets, focus-visible styles, reduced
    motion, and mobile-first layout.

- Docs:
  - Update `docs/codebase-map.md` with new shared schemas, thread-link
    repository/service/routes, and Thread UI relation ownership.
  - Note that Thread/ThreadIndex/ThreadNew have been migrated to `apiJson` if
    completed in this cycle.

## Sprint Contract

- Passing criteria:
  - Existing thread create/list/detail responses remain backward-compatible for
    existing consumers.
  - Summary rows include correct incoming/outgoing relation counts.
  - Detail response includes all incoming and outgoing relationships with peer
    thread id/name and exact kind/firmness.
  - Creating a valid outgoing relation writes exactly one `thread_links` row.
  - Repeating the same create request is idempotent and does not duplicate rows.
  - Self-link, invalid kind/firmness, invalid ids, and missing threads return
    stable 400/404 errors without writes.
  - `contains` cycle creation returns 409 without writes.
  - A child cannot have two different hard `contains` parents.
  - Deleting an outgoing link removes only that row and does not delete threads
    or events/tasks.
  - Incoming links are visible but not deleted from the target thread detail.
  - Thread UI shows relation section, empty state, create success, duplicate
    idempotency, delete success, and 409 messages.
  - Thread screens preserve loading, quiet, live, error, and access-session
    behavior after `apiJson` migration.
  - No automatic rollup, cascade, inferred links, sequence optimization, LLM
    call, or migration is added.
  - `docs/codebase-map.md` is accurate and updated.

- Automatic checks:
  - `corepack pnpm db:generate`
  - `corepack pnpm test:integration`
  - `corepack pnpm verify`
  - `git diff --check`

- Test cases:
  - Shared unit:
    - valid thread link row/view/relation contracts;
    - invalid kind/firmness/id payloads;
    - extended summary/detail schemas accept relation fields.
  - Pure backend unit:
    - `contains` cycle detection on chain A→B→C rejects C→A;
    - unrelated branch accepts A→D;
    - hard-parent conflict rejects second parent;
    - duplicate detection preserves idempotency.
  - Backend integration with temporary SQLite:
    - create/list/detail includes relation counts and peers;
    - duplicate create does not insert a second row;
    - self-link/invalid/missing-thread cases produce no writes;
    - contains cycle and parent conflict return 409 and preserve rows;
    - delete outgoing link succeeds and incoming-only delete from target 404s;
    - deterministic endpoints pass without LLM gateway.
  - Frontend:
    - Thread detail renders incoming/outgoing relation lists and empty state;
    - create form excludes current thread and posts expected payload;
    - create success refreshes relation section;
    - duplicate success does not render duplicate relation cards;
    - delete button exists only for outgoing links and refreshes on success;
    - 409 errors show specific local copy and keep form open;
    - ThreadIndex renders relation count chips;
    - loading/quiet/live/error/access-session states remain covered.
  - Manual checks:
    - mobile and wide Thread relation section/form;
    - light and dark themes;
    - keyboard focus through create form/delete controls;
    - 44px targets and reduced motion.

- gas limit: N/A
- slither pass: N/A

## Three Missing Edge-Case Candidates

- `contains` cycle through a long chain is easy to miss if only direct children
  are checked. Use graph traversal, not one-hop SQL.
- Two clients can attempt to create the same link concurrently. Single-user Pi
  lowers risk, but service should read-before-write and tests should prove no
  duplicate under sequential repeat; DB uniqueness can be a later migration if
  needed.
- Deleting a parent `contains` link after future rollups exist could leave
  cached rollup state stale. Cycle 25 has no rollup cache, so deletion is only
  row removal.

## One Simpler Alternative

Only display existing `thread_links` rows and skip create/delete UI. This would
be safer but not useful: no user-facing path would create relationships, so it
would not advance FR-THR-09. Manual hard links are the smallest useful step and
still avoid rollup/LLM complexity.

## Assumptions

- `thread_links` already exists in the current schema and migration history.
- Manual UI-created relationships are confirmed user intent and therefore
  default to `firmness="hard"`.
- `firmness="soft"` remains available in the API for future suggested links,
  but Cycle 25 does not infer or auto-create soft links.
- `contains` is the only tree-constrained relation kind in this cycle.
- `blocks`, `feeds`, `competes`, and `shares` do not affect scheduling,
  feasibility, or Today ordering yet.
- Thread relation deletion is explicit and never cascades to threads, events,
  tasks, or annotations.
- Existing Thread screens use direct `fetch`; migrating them to `apiJson` is
  in-scope only because relation endpoints need the same access-session
  behavior.

## Review Guidance

### Enumeration Required

- Thread response consumers:
  - Search: `rg -n "ThreadSummary|ThreadDetail|/api/threads|loadThread|loadThreads" shared/src server/src web/src`
  - Expected: shared schemas/types, backend service/route producers,
    ThreadIndex/Thread/ThreadNew consumers, and tests updated for relation
    fields.

- Thread-link persistence:
  - Search: `rg -n "threadLinks|thread_links|ThreadLink|contains" server/src shared/src`
  - Expected: schema already exists; new repository/service/route code uses the
    existing table and no migration files are added.

- Graph invariant code:
  - Search: `rg -n "CONTAINS_CYCLE|CONTAINS_PARENT_CONFLICT|wouldCreate|ancestor|descendant" server/src`
  - Expected: cycle and parent-conflict checks live in a pure service or focused
    domain function, not embedded as ad hoc route logic.

- Frontend relation UI:
  - Search: `rg -n "관계|thread relation|relationCounts|incoming|outgoing|CONTAINS_CYCLE|CONTAINS_PARENT_CONFLICT" web/src`
  - Expected: Thread detail relation section, ThreadIndex chips, local error
    handling, and tests.

- Scope creep boundaries:
  - Search: `rg -n "rollup|cascade|sequence|switch|completeChat|LLM_PROXY_BASE_URL|inferred" server/src web/src shared/src`
  - Expected: no LLM call, no context-switch scoring, no contains rollup/cascade,
    and no inferred relationship generation in Cycle 25.

- Migration boundary:
  - Search: `find server/drizzle -maxdepth 2 -type f -print | sort`
  - Expected: no new migration files unless `db:generate` proves a necessary
    schema change and the plan is amended before implementation.

### Verification Guide

- Thread-link creation, delete, duplicate idempotency, FK existence, contains
  parent conflict, and cycle rejection require SQLite integration tests against
  a real temporary database. Mock-only tests are insufficient.
- The graph invariant function may have pure unit tests for traversal shapes,
  but integration tests must prove no-write behavior on 400/404/409 paths.
- Frontend may mock `apiJson`, but must verify visible relation state, exact
  payloads, refresh timing after mutations, and specific 409 copy.
- `apiJson` migration must preserve access-session surfaces; direct `fetch`
  regression is a review target for Thread screens.
- Manual mobile/wide, light/dark, keyboard, 44px, and reduced-motion checks
  remain required.
