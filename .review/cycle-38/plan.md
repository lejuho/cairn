# Cross-cutting Relations A Implementation Plan

Branch: feature/cycle-38-cross-cutting-relations-a
Skills: backend-fastify, frontend-react-pwa

## Summary

Cycle 38 implements the first bounded slice of the newly approved FR-XREL spec.

Current state:

- `events`, `tasks`, `threads`, `people`, `event_people`, and `thread_links`
  already exist.
- Thread detail already renders a spine of events/tasks plus relation/rollup
  sections.
- There is no resource entity for cross-cutting items/knowledge, no
  resource-to-node links, and no focus/highlight view.

This cycle adds:

- `resources` and `resource_links` tables;
- strict shared schemas for resources and resource links;
- deterministic Fastify routes for creating/listing resources and linking a
  resource to a thread/event/task;
- a read-only thread resource-focus payload for `/threads/:id`;
- `/threads/:id` UI chips that let the user choose one resource and highlight
  only the linked thread-spine nodes, dimming the rest.

Out of scope:

- automatic resource promotion suggestions from repeated names;
- LLM extraction or resource inference;
- ego-graph rendering;
- global resource directory route/page;
- full graph visualization;
- cross-domain personal/work reuse suggestions;
- editing/deleting resources or links.

## Input/Output Spec

- Input:
  - `POST /api/resources`
    - Body:

```json
{
  "name": "노트북",
  "kind": "item",
  "sourcePersonId": 3,
  "note": "발표 때 챙김"
}
```

    - Validation:
      - `name`: non-empty trimmed string, max 120;
      - `kind`: `item | knowledge`;
      - `sourcePersonId`: optional positive integer, nullable;
      - `note`: optional string, max 500, nullable;
      - strict schema rejects injected `score`, `recommendation`, `advice`,
        `certainty`, or auto-action fields.

  - `GET /api/resources`
    - Returns all resources sorted by name asc/id asc.

  - `POST /api/resources/:id/links`
    - Body:

```json
{
  "targetType": "event",
  "targetId": 12,
  "firmness": "hard",
  "reason": "발표라 필요"
}
```

    - Validation:
      - `id`: positive integer resource id;
      - `targetType`: `event | task | thread`;
      - `targetId`: positive integer;
      - `firmness`: `hard | soft | tentative`, default `soft`;
      - `reason`: optional string, max 300, nullable.
      - Target must exist.
      - Duplicate `(resource_id,target_type,target_id)` returns the existing
        link idempotently.

  - `GET /api/threads/:id/resource-focus`
    - Returns resources linked to:
      - the thread itself;
      - events in that thread;
      - tasks in that thread.
    - No write. No LLM.

- Storage:
  - Add SQLite table `resources`:
    - `id`;
    - `name`;
    - `kind`;
    - `source_person_id` FK to `people.id`, nullable;
    - `note`;
    - `created_at`.
  - Add SQLite table `resource_links`:
    - `id`;
    - `resource_id` FK to `resources.id`;
    - `target_type`;
    - `target_id`;
    - `firmness`;
    - `reason`;
    - `created_at`;
    - unique `(resource_id, target_type, target_id)`.
  - `target_type='event'` validates against `events.id`, `task` against
    `tasks.id`, and `thread` against `threads.id` in service/repository logic.
    SQLite cannot express this polymorphic FK directly.

- Output:
  - `ResourceRow` includes `{ id, name, kind, sourcePersonId, note, createdAt }`.
  - `ResourceLinkRow` includes link id, resource id, target type/id, firmness,
    reason, createdAt.
  - `ThreadResourceFocusData` includes:
    - `threadId`;
    - `resources: ThreadResourceFocusItem[]`;
    - each item includes the resource, optional source person, and `links`;
    - each link includes `targetType`, `targetId`, `firmness`, `reason`.
  - UI:
    - Thread page shows a compact "관련 리소스" section when focus data exists.
    - Selecting one chip highlights linked events/tasks/thread header and dims
      unrelated nodes.
    - Firmness stays visible: hard solid, soft dashed, tentative faint.
    - No full graph is drawn.

- Failure:
  - Invalid input returns stable `VALIDATION_ERROR`.
  - Missing resource returns `NOT_FOUND`.
  - Missing target returns `TARGET_NOT_FOUND`.
  - Missing `sourcePersonId` returns `SOURCE_PERSON_NOT_FOUND`.
  - DB unique conflict on duplicate link returns existing link, not 500.

## Key Changes

- Shared:
  - Add `shared/src/resources.ts` with strict schemas/types:
    - `ResourceKindSchema`;
    - `ResourceTargetTypeSchema`;
    - `ResourceFirmnessSchema`;
    - `ResourceRowSchema`;
    - `ResourceLinkRowSchema`;
    - `CreateResourceRequestSchema`;
    - `CreateResourceLinkRequestSchema`;
    - `ThreadResourceFocusDataSchema`.
  - Export from `shared/src/index.ts`.
  - Add tests proving strict rejection of injected recommendation/scoring/action
    fields and invalid enum values.

- Backend:
  - Add Drizzle schema and migration for `resources` and `resource_links`.
  - Add `server/src/repositories/resources.ts`:
    - create/list resources;
    - find source person existence;
    - create or return duplicate resource link;
    - find resource-focus links for a thread's events/tasks/thread id.
  - Add `server/src/routes/resources.ts`:
    - `POST /api/resources`;
    - `GET /api/resources`;
    - `POST /api/resources/:id/links`.
  - Extend thread routes or add a small route module:
    - `GET /api/threads/:id/resource-focus`.
  - Keep route handlers thin and validation-first.
  - No LLM, no external network, no graph rendering service.

- Frontend:
  - Extend `web/src/Thread.tsx`:
    - fetch thread detail and resource focus;
    - degrade focus fetch failure without failing thread detail;
    - render "관련 리소스" chips;
    - selecting a resource sets `activeResourceId`;
    - apply highlight/dim classes to matching event/task cards and header.
  - Do not add a new primary nav page.
  - Add semantic-token CSS for:
    - resource chips;
    - active chip;
    - hard/soft/tentative firmness;
    - dimmed non-matches.

- Docs:
  - Update `docs/codebase-map.md` with:
    - new tables;
    - shared resource schemas;
    - resource routes/repository;
    - thread resource-focus UI.

## Sprint Contract

- Pass criteria:
  - `resources` and `resource_links` migrate with check constraints and unique
    duplicate guard.
  - Resource creation validates strict shape and source person existence.
  - Resource link creation validates resource and target existence for all three
    target types.
  - Duplicate resource link is idempotent and returns the existing link.
  - Thread resource-focus returns only resources linked to that thread, its
    events, or its tasks.
  - Thread UI can select one resource and highlights only matching spine nodes;
    no full graph is drawn.
  - Firmness/reason are preserved in API payload and visible in UI.
  - No LLM, Gmail/GCal, Telegram, fetch crawler, or external network dependency
    is introduced.
  - Existing thread detail, relations, rollup, event/task rendering, and People
    flows remain compatible.
  - `docs/codebase-map.md` is updated.

- Automatic checks:
  - `corepack pnpm db:generate`
  - `corepack pnpm verify`
  - `git diff --check master..HEAD`
  - Static boundary check for no LLM/GCal/Gmail/Telegram/fetch imports in new
    resource repository/routes/shared paths.

- Test cases:
  - Unit:
    - shared schemas reject injected `score`, `recommendation`, `advice`,
      `action`;
    - firmness enum accepts hard/soft/tentative;
    - target type enum accepts event/task/thread only;
    - focus helper maps event/task/thread links to highlight ids without graph
      expansion.
  - SQLite integration:
    - migration creates both tables with check constraints;
    - create resource success;
    - create resource rejects missing source person;
    - create resource link success for event, task, and thread;
    - missing resource => 404;
    - missing target => 404/409 stable code;
    - duplicate link returns existing link idempotently;
    - `GET /api/threads/:id/resource-focus` excludes links outside the thread.
  - Web:
    - Thread page fetches resource-focus endpoint;
    - focus fetch failure leaves normal thread detail usable;
    - chips render for linked resources;
    - selecting chip highlights linked event/task and dims unrelated nodes;
    - firmness/reason are visible;
    - no graph canvas/SVG/global graph appears.
  - Manual/source:
    - Mobile/light/dark/reduced-motion source or headless evidence recorded if
      browser execution is unavailable.

- gas limit: N/A
- slither pass: N/A

## 누락된 엣지 케이스 후보 3개

- A resource links to the thread itself and one task inside it. Expected:
  header and task highlight, no duplicate chip.
- A resource links to an event in a different thread. Expected: not returned by
  this thread's resource-focus endpoint.
- Source person is later absent or deleted in future schema. Expected:
  sourcePerson nullable/fail-open in focus output, no fabricated person.

## 더 단순한 대안 1개

Use only `reason_tags` or annotation text to infer resource names at render time.
Rejected because FR-XREL needs durable firmness, reason, and source-person
provenance; inference-only highlighting would present weak guesses as structure.

## Assumptions

- In this codebase, spec "node" maps to `event` and `task`; `thread` remains a
  separate target type.
- First slice may use API-created resources/links and thread-side read UI only;
  automatic promotion proposals are deferred.
- `source_person_id` points to existing `people.id` for now. Future contacts
  generalization can widen this when FR-CON lands.
- Browser manual checks may be replaced by explicit source/headless evidence if
  browser access is unavailable.

## Review Guidance

### Enumeration needed

- New resource schema/routes:
  - Search: `rg -n "Resource|resource_links|resources|resource-focus" shared/src server/src web/src`
  - Verify shared/server/web payload shape agreement.

- Target existence enumeration:
  - Search: `rg -n "targetType|target_type|event|task|thread" server/src/repositories/resources.ts server/src/routes/resources.ts`
  - Verify all three target types have existence checks.

- Thread UI highlight boundary:
  - Search: `rg -n "resource-focus|activeResource|resource-chip|resource-highlight|dimmed" web/src/Thread.tsx web/src/Thread.test.tsx web/src/styles.css`
  - Verify selecting one resource does not hide content or draw a full graph.

- External dependency boundary:
  - Search: `rg -n "completeChat|LLM_PROXY_BASE_URL|googleapis|gcal|gmail|telegram|fetch\\(" shared/src/resources.ts server/src/repositories/resources.ts server/src/routes/resources.ts`
  - Expected: no hits.

### Verification guidance

- DB schema/migration:
  - Mock tests are insufficient.
  - Use SQLite integration tests with real temporary DB and migrated schema.

- Polymorphic target checks:
  - Mock tests are insufficient.
  - Integration tests must cover event, task, thread, and missing-target cases.

- Highlight behavior:
  - JSDOM tests should assert class/state changes after chip selection.
  - Source/headless evidence acceptable for mobile/light/dark/reduced-motion.

- Scope creep:
  - Any automatic promotion, LLM inference, ego-graph, global graph page, or new
    graph visualization is outside this plan and should block review.
