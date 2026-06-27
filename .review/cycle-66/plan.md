# Person Thread Focus A Implementation Plan

Branch: feature/cycle-66-person-thread-focus
Cycle: 66
Created: 2026-06-27
Skills: backend-fastify, frontend-react-pwa

## Summary

Remaining implementation specs after cycle 65:

- The core `FR-SLOT` A-chain is now useful end-to-end for unscheduled events and
  due-imminent tasks: identify, preview, dismiss, explicitly schedule/apply, and
  inspect contribution evidence.
- `FR-SYNC-05` has a backend-only Gmail cancellation-cost A-slice, but the
  remaining parse-failure fallback is still policy-undecided.
- `FR-MOV`, GCal mirror export/recovery, watcher-B automation, procurement, and
  Typst/pcli export are external-heavy, later-phase, or still need product
  decisions.
- `FR-FEAS-07` overrun correction is attractive, but the current schema has no
  stable "estimated vs actual overrun amount" field. Adding a coefficient now
  would invent a model instead of preserving deterministic evidence.
- `FR-PPL-07` / `FR-XREL-03` has a bounded local gap: `/threads/:id` already
  has resource-focus highlighting, person detail already has an ego-graph, and
  `event_people` already records which people are involved in thread events.
  The thread spine still cannot focus a person and see related event nodes.

Recommended next spec: **FR-PPL-07 / FR-XREL-03 Person Thread Focus A**.

This cycle adds a read-only person focus layer to the thread spine. The backend
extends existing thread detail data with the people attached to in-thread events
and their event ids. The frontend renders compact person chips; tapping one
highlights matching event nodes and dims unrelated nodes. It does not create,
merge, infer, or edit people; it does not add a graph canvas, new route, schema
migration, LLM call, external API, or automatic relationship.

## Input/Output Spec

- Input:
  - Existing `GET /api/threads/:id`.
  - Existing `events` in that thread.
  - Existing `event_people` rows for those event ids.
  - Existing `people` rows.
- Normal output:
  - `ThreadDetail` gains a strict read-only person focus payload, for example:
    - `personFocus.people[]`
    - each row: `{ person: { id, name, relation }, eventIds: number[] }`
  - `personFocus.people` includes only people linked to events that belong to
    the requested thread.
  - Each person appears once.
  - `eventIds` are unique and sorted ascending.
  - People are sorted deterministically by `name` ascending, then `id`
    ascending.
  - `/threads/:id` renders a "관련 사람" chip row only when the payload is
    non-empty.
  - Tapping a person chip:
    - sets that person as the active focus;
    - highlights event nodes whose id is in that person's `eventIds`;
    - dims unrelated event nodes and task nodes;
    - tapping the same chip clears the focus.
  - Selecting a person focus clears any active resource focus; selecting a
    resource focus clears any active person focus. This avoids compound filter
    semantics in this A-slice.
  - The focus chips are buttons, keyboard-focusable, and at least 44px.
  - Existing resource focus behavior remains available and unchanged when no
    person focus is active.
- No-op / failure behavior:
  - Threads with no event people get an empty payload and no person-focus UI.
  - Missing/deleted event or person joins are omitted, not inferred.
  - The feature never writes to SQLite.
  - Clicking focus chips never calls an API, mutates nodes, confirms links,
    edits people, schedules tasks/events, or opens the ego graph.
  - No new route, migration, LLM, Gmail/GCal, Mirror, movement, watcher,
    procurement, notification, or CV/export behavior is introduced.

## Key Changes

- Shared:
  - `shared/src/threads.ts`
    - Add strict person-focus schemas and types to `ThreadDetailSchema`.
    - Reject injected score/recommendation/action fields.
  - `shared/src/threads.test.ts`
    - Add schema tests for valid person focus and strict rejection of injected
      fields.
- Backend:
  - `server/src/repositories/people.ts`
    - Add a read-only helper that receives in-thread event ids and returns a
      deterministic person→eventIds focus payload.
    - Query only needed columns from `event_people` and `people`.
  - `server/src/routes/threads.ts`
    - Populate `personFocus` in existing `GET /api/threads/:id`.
    - Keep the route thin: load thread events, call repository helper, compose
      response.
  - `server/src/routes/threads.integration.test.ts`
    - Cover unique/sorted people, unique/sorted event ids, exclusion of
      out-of-thread event_people, no-people empty payload, and row-count
      preservation.
- Frontend:
  - `web/src/Thread.tsx`
    - Add `PersonFocusSection` near the existing resource focus section.
    - Add `activePersonId` state and a node-class helper that supports exactly
      one focus mode: none, resource, or person.
    - Reuse the existing event/task node list; do not create a graph or new tab.
    - Clear resource focus when a person is selected and clear person focus when
      a resource is selected.
  - `web/src/Thread.test.tsx`
    - Cover rendering/hiding the person focus section.
    - Cover highlight/dim behavior for matching event nodes, unrelated event
      nodes, and task nodes.
    - Cover same-chip toggle clear.
    - Cover resource/person mutual exclusion.
    - Assert focus chip clicks do not call fetch or mutation endpoints.
  - `web/src/styles.css`
    - Add semantic-token styles for person focus chips and selected state.
    - Keep controls 44px+ and mobile wrapping safe.
- Docs:
  - `docs/codebase-map.md`
    - Record the new `ThreadDetail.personFocus` payload and `/threads/:id`
      person focus UI boundary.

## Sprint Contract

- Passing criteria:
  - `GET /api/threads/:id` returns `personFocus.people` for people attached to
    events in the requested thread.
  - Person focus rows are unique and sorted by person name/id.
  - Each focus row's `eventIds` are unique and sorted ascending.
  - Out-of-thread `event_people` rows never appear.
  - Threads with no attached people return `personFocus.people: []`.
  - The new backend path is read-only; it does not write people, events, tasks,
    links, resources, annotations, or thread rows.
  - `/threads/:id` hides the person focus section when there are no people.
  - `/threads/:id` renders keyboard-focusable 44px person chips when people
    exist.
  - Selecting a person highlights only matching event nodes and dims unrelated
    event/task nodes.
  - Tapping the active person chip clears person focus and removes highlight/dim
    classes.
  - Resource focus behavior remains unchanged when no person focus is active.
  - Resource focus and person focus are mutually exclusive in this A-slice.
  - Focus chip clicks do not fetch, patch, post, delete, schedule, edit,
    confirm, or open graph UI.
  - No schema migration, new table/column, new API route, LLM, external API,
    Gmail/GCal, Mirror fetch, movement, watcher automation, procurement, push,
    notification draft, CV/export, or status mutation is introduced.
  - UI remains mobile-first, semantic-token based, keyboard focusable, and all
    new controls are at least 44px touch targets.
  - `docs/codebase-map.md` reflects the new thread detail/person focus boundary.
- Automatic checks:
  - `corepack pnpm lint`
  - `corepack pnpm typecheck`
  - `corepack pnpm test`
  - `corepack pnpm test:integration`
  - `corepack pnpm build`
  - `corepack pnpm verify`
  - `git diff --check master...HEAD`
- Test cases:
  - Shared:
    - `ThreadDetailSchema` accepts an empty person focus and a multi-person
      focus payload.
    - `ThreadDetailSchema` rejects injected fields such as `score`,
      `recommendation`, `action`, or `autoApply` inside person focus rows.
  - Backend integration:
    - A thread with two events and overlapping people returns each person once
      with all matching in-thread event ids.
    - Person rows sort by name asc/id asc; event ids sort asc.
    - An `event_people` row for another thread is excluded.
    - A thread with no people returns an empty array.
    - GET detail preserves counts for `people`, `event_people`, `events`,
      `tasks`, `threads`, `links`, `thread_links`, `resources`,
      `resource_links`, and `annotations`.
  - Frontend:
    - Person focus section is hidden for an empty payload.
    - Person chips render from the payload and are 44px buttons.
    - Clicking a person chip highlights matching event node(s), dims unrelated
      event nodes, and dims task nodes.
    - Clicking the active chip clears all person-focus classes.
    - Selecting a resource chip clears person focus; selecting a person chip
      clears resource focus.
    - Person chip clicks do not add network calls beyond initial thread/resource
      focus/promotion loads and do not call mutation endpoints.
  - Static negative checks:
    - No migrations or DB schema edits:
      `git diff --name-only master...HEAD | rg 'server/drizzle|server/src/db/schema.ts'`
      should have no matches.
    - No new route files:
      `git diff --name-only master...HEAD | rg '^server/src/routes/[^/]+\\.ts$'`
      should only include existing `server/src/routes/threads.ts` if route code
      changes.
    - No external/LLM/GCal/Gmail/Mirror/movement/watcher/procurement/CV behavior:
      `git diff -U0 master...HEAD -- server/src shared/src web/src docs | rg -n 'completeChat|LLM_PROXY_BASE_URL|gmail|Gmail|googleapis|/api/mirror|movement|scheduler|cron|procurement|Typst|pcli|resume-export|notificationDraft'`
      should have no implementation matches.
    - No writes from the person focus helper:
      inspect changed backend files for added `.insert(`, `.update(`,
      `.delete(`, `POST`, `PATCH`, or `DELETE` in the person-focus path.
- gas limit: N/A
- slither pass: N/A

## Missing Edge Case Candidates

- A person can be attached to multiple events in the same thread; the UI should
  highlight all matching event nodes and the backend must not emit duplicates.
- A thread can have tasks but no person-linked events. The payload should be
  empty and the UI hidden, not a disabled or misleading filter.
- Resource focus already dims/highlights nodes. Person focus must not stack with
  resource focus in a way that leaves stale classes or creates confusing
  intersection semantics.

## Simpler Alternative

Frontend-only scan of event titles for person names.

Rejected because it would infer relationships from text and can easily invent
false links. The existing `event_people` table is the source of truth for this
A-slice; the UI should only reflect explicit event-person links.

## Assumptions

- `event_people` is the hard source of truth for "this person is involved in
  this event"; this cycle does not infer or promote people from text.
- Thread tasks do not have direct people links today, so person focus only
  highlights event nodes. Tasks are dimmed when a person focus is active.
- A single active focus mode is enough for this cycle. Compound person+resource
  filters can be a future interaction if the need appears.

## Review Guidance

### Enumeration Required

- Enumerate `ThreadDetailSchema` and all `ThreadDetail` consumers:
  - Search: `rg -n "ThreadDetailSchema|ThreadDetail|personFocus" shared/src web/src server/src`
  - Expected: shared schema/type, server detail composition, and `web/src/Thread.tsx` are updated; unrelated screens do not need changes.
- Enumerate thread node class logic:
  - Search: `rg -n "nodeClass|resource-highlight|resource-dimmed|person-focus|activePerson" web/src/Thread.tsx web/src/Thread.test.tsx web/src/styles.css`
  - Expected: one helper owns focus classes; resource/person focus clearing is tested.
- Enumerate backend writes in changed files:
  - Search: `git diff -U0 master...HEAD -- server/src | rg -n '\\.(insert|update|delete)\\(|method: \"(POST|PATCH|DELETE)\"|app\\.(post|patch|delete)'`
  - Expected: no new write path for person focus. Existing unchanged context may appear only if not part of added lines.

### Verification Method Guide

- Shared schema:
  - Unit tests are sufficient for strict payload acceptance/rejection.
- Backend query correctness and read-only behavior:
  - Integration tests against a real temporary SQLite DB are required because
    `event_people` joins and row-count preservation cannot be proven by mocks.
- Frontend behavior:
  - Vitest DOM tests are sufficient because this cycle only changes local React
    selection state and CSS classes in `/threads/:id`.
- Touch target and mobile wrapping:
  - CSS inspection plus frontend tests/build are sufficient for this A-slice;
    no visual regression tooling exists yet.
