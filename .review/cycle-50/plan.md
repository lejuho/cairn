# Thread Node Edit + Confirm A Implementation Plan

Branch: feature/cycle-50-thread-node-edit-confirm-a
Skills: backend-fastify, frontend-react-pwa

## Summary
Cycle 50 implements a narrow A-slice of:

- `FR-THR-05` firmness promotion: explicit user confirmation promotes a
  same-thread event/task dependency link to `firmness='hard'` and
  `source='authored'`.
- `FR-THR-06` node editing: inline edits for existing event/task nodes visible
  on `/threads/:id`.

This cycle does not implement natural-language thread generation, unknown
duration propagation, missing-node suggestions, settlement, CV extraction,
movement, procurement/contact/domain expansion, or LLM-backed edits. The goal is
to make already-visible thread nodes correctable and already-stored inferred
links confirmable without pretending inference is hard.

## Input/Output Spec
- Input:
  - `PATCH /api/events/:id/thread-node`
    - Body: strict partial editable event fields.
    - Allowed fields:
      - `title`: non-empty trimmed string
      - `type`: trimmed string or `null`
      - `location`: trimmed string or `null`
      - `mode`: `in_person | remote | async | null`
    - At least one field is required.
    - `start`, `end`, `status`, `threadId`, people, costs, and external calendar
      identity are not editable in this A-slice.
    - GCal-imported events (`source='gcal'`) are read-only for this endpoint and
      return `409 EXTERNAL_EVENT_READ_ONLY`.
  - `PATCH /api/tasks/:id/thread-node`
    - Body: strict partial editable task fields.
    - Allowed fields:
      - `title`: non-empty trimmed string
      - `estMinutes`: positive integer or `null`
      - `due`: `YYYY-MM-DD` calendar date or `null`
      - `context`: trimmed string or `null`
      - `optional`: boolean
    - At least one field is required.
    - `status` and `threadId` are not editable in this A-slice.
  - `PATCH /api/threads/:id/node-links/:linkId/confirm`
    - Body: none.
    - The link must be an event/task `links` row whose endpoints both belong to
      the path thread id.
    - `soft`, `tentative`, or `inferred` links become:
      - `firmness='hard'`
      - `source='authored'`
    - Existing `hard/authored` links are idempotent success.
- Output:
  - Event edit success:
    - `ok: true`
    - `data.event: EventRow`
  - Task edit success:
    - `ok: true`
    - `data.task: TaskRow`
  - Link confirm success:
    - `ok: true`
    - `data.link: ThreadNodeLink`
    - `data.reused: boolean` (`true` when already hard/authored)
  - Thread detail:
    - `GET /api/threads/:id` extends `ThreadDetail` with required
      `nodeLinks: ThreadNodeLink[]`.
    - `ThreadNodeLink` includes:
      - `id`
      - `kind`
      - `firmness`
      - `source`
      - `from: { kind: "event"|"task", id, title }`
      - `to: { kind: "event"|"task", id, title }`
    - Only links whose endpoints both belong to the thread are included.
  - Failure:
    - bad ids or invalid payload: `400 VALIDATION_ERROR`
    - unknown event/task/thread/link: `404 NOT_FOUND`
    - GCal event edit: `409 EXTERNAL_EVENT_READ_ONLY`
    - link endpoint outside path thread: `404 NOT_FOUND`
  - Side effects:
    - Event edit mutates only the target event's allowed columns.
    - Task edit mutates only the target task's allowed columns.
    - Link confirm mutates only the target `links` row's `firmness` and
      `source`.

## Key Changes
- Shared:
  - Add strict schemas/types:
    - `PatchThreadEventNodeRequestSchema`
    - `PatchThreadTaskNodeRequestSchema`
    - `ThreadNodeKindSchema`
    - `ThreadNodeRefSchema`
    - `ThreadNodeLinkSchema`
    - `ConfirmThreadNodeLinkResponseDataSchema`
  - Extend `ThreadDetailSchema` with required `nodeLinks`.
  - Schemas must reject injected fields such as `score`, `recommendation`,
    `advice`, `autoApply`, `start`, `end`, `status`, `threadId`, `source`, or
    `firmness` in edit request bodies.
- Backend:
  - Add repository helpers:
    - `updateEventThreadNode(db, id, patch)`.
    - `updateTaskThreadNode(db, id, patch)`.
    - `findThreadNodeLinks(db, threadId)`.
    - `confirmThreadNodeLink(db, threadId, linkId)`.
  - Wire routes:
    - `PATCH /api/events/:id/thread-node` in `server/src/routes/events.ts`.
    - `PATCH /api/tasks/:id/thread-node` in `server/src/routes/tasks.ts`.
    - `PATCH /api/threads/:id/node-links/:linkId/confirm` in
      `server/src/routes/threads.ts`.
  - Extend `getThreadDetail` to include `nodeLinks`.
  - Preserve DB invariant:
    - never write `firmness='hard'` while `source='inferred'`; confirmation
      updates both fields together.
- Frontend:
  - Update `web/src/Thread.tsx`.
  - Each event/task card gets a small `수정` action.
  - Tapping opens an inline card-local form with save/cancel, loading and
    `role="alert"` error state.
  - Event form edits title/type/location/mode only.
  - Task form edits title/estMinutes/due/context/optional only.
  - Add a "노드 연결" section when `nodeLinks.length > 0`.
    - Show from -> to, relation kind, firmness/source chips.
    - Non-confirmed links show a `확인` button.
    - Confirm calls the new route and refreshes thread detail.
    - Hard/authored links show descriptive confirmed state and no apply control.
  - Use semantic tokens, maintain mobile-first layout, 44px touch targets for
    edit/confirm buttons, and reduced-motion safety.
- Docs:
  - Update `docs/codebase-map.md` for new shared schemas, routes, repository
    helpers, `ThreadDetail.nodeLinks`, and Thread UI surface.

## Sprint Contract
- Pass criteria:
  - Thread detail includes `nodeLinks` and remains backward-compatible in route
    behavior: loading/error/access states still work.
  - Event node edit updates only `title`, `type`, `location`, and `mode`.
  - Event node edit rejects empty patch, unknown fields, blank title, bad mode,
    invalid id, unknown id, and GCal-imported events.
  - Task node edit updates only `title`, `estMinutes`, `due`, `context`, and
    `optional`.
  - Task node edit rejects empty patch, unknown fields, blank title, invalid
    due date, invalid id, and unknown id.
  - Link confirm updates same-thread event/task links to hard/authored in one
    operation and is idempotent for already hard/authored links.
  - Link confirm rejects cross-thread links, unknown links, bad ids, and links
    whose endpoints no longer exist.
  - UI lets the user explicitly edit nodes and explicitly confirm links; no
    automatic edit, auto-confirm, recommendation, score, or LLM generation is
    introduced.
  - `docs/codebase-map.md` reflects the new boundaries.
- Automatic checks:
  - `corepack pnpm db:generate`
  - `corepack pnpm verify`
  - `git diff --check master..HEAD`
  - Static no LLM/external/movement/procurement scan:
    - `git diff -U0 master..HEAD -- shared/src server/src web/src | rg -n "\\b(completeChat|LLM_PROXY_BASE_URL|googleapis|gcal:sync|gmail|telegram|naver|kakao|odsay|maps|procurement|vendor|venue|travelOption|routeOption)\\b"`
    - Expected: no matches except pre-existing imports in untouched context are
      not acceptable if introduced by this diff.
  - Static edit-body scope scan:
    - `git diff -U0 master..HEAD -- shared/src/threads.ts shared/src/events.ts shared/src/tasks.ts server/src/routes web/src/Thread.tsx | rg -n "autoApply|recommendation|advice|score|start|end|threadId|source|firmness"`
    - Expected: request-body schemas and UI do not expose these as editable
      event/task fields. Matches in `ThreadNodeLink` display/confirm contracts
      are acceptable and must be explained by reviewer.
  - Static link-confirm invariant scan:
    - `rg -n "firmness.*hard|source.*authored|source.*inferred" server/src/repositories server/src/routes server/src/services shared/src`
    - Reviewer must verify no code path writes hard+inferred.
- Test cases:
  - Shared schema tests:
    - valid event/task edit requests parse.
    - empty patches reject.
    - unknown fields reject.
    - blank titles reject.
    - invalid task due date rejects.
    - `ThreadDetailSchema` requires `nodeLinks`.
    - `ThreadNodeLinkSchema` preserves firmness/source and rejects injected
      score/recommendation fields.
  - Backend integration tests with real temporary SQLite:
    - `GET /api/threads/:id` returns node links only when both endpoints are in
      the thread.
    - event edit success changes allowed fields and does not change
      start/end/status/threadId/source/external ids.
    - event edit rejects GCal source with 409 and leaves row unchanged.
    - task edit success changes allowed fields and does not change
      status/threadId.
    - link confirm changes soft/inferred to hard/authored and does not touch
      unrelated rows.
    - link confirm idempotently succeeds for hard/authored.
    - link confirm rejects cross-thread links and missing endpoints.
  - Frontend tests:
    - event card edit opens inline form, saves, refreshes, and handles error.
    - task card edit opens inline form, saves, refreshes, and handles error.
    - node link section shows firmness/source evidence.
    - non-confirmed link shows `확인`; hard/authored link does not.
    - confirm button calls the correct route and refreshes.
    - existing resource focus, thread relation sheet, promotion suggestions, and
      rollup surfaces still render.
- gas limit: N/A
- slither pass: N/A

## Missing Edge Case Candidates
- A `links` row points to a deleted or threadless endpoint: exclude it from
  `nodeLinks`; confirming it returns `404 NOT_FOUND`.
- A soft link has `source='given'`: confirmation still sets `source='authored'`
  because the user just authored the confirmation.
- Event edit request attempts to set `mode=null`: valid and means unknown mode,
  not remote/async.

## Simpler Alternative
Implement only title editing for events and tasks. This is smaller, but it does
not advance `FR-THR-05` and would leave inferred/soft links visible without a
safe way to confirm them. The chosen A-slice is still bounded while addressing
both missing spec rows.

## Assumptions
- "노드" in this A-slice means existing `events` and `tasks` attached to a
  thread.
- Event scheduling remains owned by slot routes; this cycle does not edit
  `start`/`end`.
- Status changes remain owned by existing status routes; this cycle does not
  duplicate them.
- Thread membership changes remain out of scope to avoid accidental graph
  rewiring.
- There is no new DB table or migration expected.

## Review Guidance
### Enumeration Required
- Locate every new contract and route:
  - `rg -n "ThreadNodeLink|PatchThread(Event|Task)Node|thread-node|node-links/.*/confirm" shared/src server/src web/src`
- Confirm event/task edit bodies cannot mutate scheduling/status/thread/source:
  - `rg -n "PatchThread(Event|Task)Node|start|end|status|threadId|source|firmness" shared/src server/src/routes server/src/repositories web/src/Thread.tsx`
- Confirm link confirmation preserves the hard/authored invariant:
  - `rg -n "confirmThreadNodeLink|firmness|source|inferred_not_hard" server/src shared/src server/src/db/schema.ts`
- Confirm UI explicit action only:
  - `rg -n "수정|확인|autoApply|recommendation|advice|score|LLM|생성" web/src/Thread.tsx web/src/Thread.test.tsx`

### Verification Method Guide
- Schema strictness:
  - Unit tests are sufficient.
- Event/task edit persistence:
  - Integration tests against real temporary SQLite are required because DB
    constraints, unchanged columns, and GCal read-only behavior matter.
- Link confirm:
  - Integration tests are required; unit tests alone cannot prove endpoint
    ownership and DB invariant behavior.
- Frontend:
  - Automated tests are required for edit/confirm live and error states.
  - Manual mobile/light/dark/reduced-motion can be substituted with semantic
    token evidence if no new animation or layout behavior beyond existing card
    controls is introduced; record the substitution in review.
