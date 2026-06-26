# Thread Draft A Implementation Plan

Branch: feature/cycle-51-thread-draft-a
Skills: backend-fastify, frontend-react-pwa

## Summary
Cycle 51 implements the first useful slice of `FR-THR-02/03`:

- A user can open `/threads/new`, enter a natural-language description, and ask
  Cairn to create a persisted thread draft.
- The draft may include a thread, event/task nodes, and event/task dependency
  links.
- AI-derived links are stored as `firmness='soft'` and `source='inferred'`.
- Unknown values remain `null`/omitted and are surfaced as "input needed" copy;
  they are never fabricated as hard facts.

This cycle depends on cycle 50: after draft creation, `/threads/:id` already lets
the user edit node fields and explicitly confirm dependency links. This cycle
does not implement `FR-THR-04` unknown propagation, reverse-date arithmetic,
missing-node suggestions, settlement, slot scheduling, movement, procurement,
contacts, domain tagging, or automatic confirmation.

## Input/Output Spec
- Input:
  - `POST /api/threads/draft`
    - Body:
      - `text`: non-empty natural-language description, trimmed, max 4000 chars.
      - `now`: RFC3339 datetime with offset, optional. Used only for parsing
        relative dates.
      - `timeZone`: IANA timezone string, optional, default server/user config
        fallback.
    - Body is `.strict()`.
    - The route is registered only when DB and LLM gateway are available.
  - UI:
    - `/threads/new` keeps the existing manual thread create path.
    - Add a separate "natural-language draft" textarea and explicit submit
      button.
- Output:
  - Success:
    - `ok: true`
    - `data.thread: ThreadRow`
    - `data.events: EventRow[]`
    - `data.tasks: TaskRow[]`
    - `data.nodeLinks: ThreadNodeLink[]`
    - `data.warnings: ThreadDraftWarning[]`
  - Failure:
    - invalid request body: `400 VALIDATION_ERROR`
    - LLM gateway unavailable/queue/timeout: `503 LLM_UNAVAILABLE`
    - LLM response invalid JSON/schema or violates draft invariants:
      `502 LLM_INVALID_DRAFT`
    - DB constraint failure: `400 DB_ERROR`
  - Side effects:
    - Success inserts exactly one `threads` row and zero or more `events`,
      `tasks`, and `links` rows in one transaction.
    - Failure inserts nothing.
    - Events created by this endpoint use `source='cairn'`,
      `self_imposed=1`, and `status='planned'`.
    - Tasks created by this endpoint use `status='todo'`.
    - Links created by this endpoint use `firmness='soft'` and
      `source='inferred'`.

### LLM Draft Shape
The LLM module parses into a strict internal/shared schema like:

```json
{
  "thread": {
    "name": "Paris trip",
    "kind": "travel",
    "goal": "Visit Paris in early June",
    "deadline": "2026-06-01"
  },
  "events": [
    {
      "tempId": "e1",
      "title": "Book flight",
      "type": "travel",
      "start": null,
      "end": null,
      "location": null,
      "mode": null
    }
  ],
  "tasks": [
    {
      "tempId": "t1",
      "title": "Check passport validity",
      "estMinutes": null,
      "due": null,
      "context": null,
      "optional": false
    }
  ],
  "links": [
    {
      "from": { "kind": "task", "tempId": "t1" },
      "to": { "kind": "event", "tempId": "e1" },
      "kind": "requires"
    }
  ],
  "warnings": [
    {
      "code": "unknown_date",
      "message": "Need a date before scheduling."
    }
  ]
}
```

Rules:
- `tempId` is mapping-only and never persisted.
- Unknown values are `null`/omitted, not placeholder strings such as `?`,
  `unknown`, `TBD`, or guessed dates.
- Links referencing unknown temp ids make the entire draft invalid and produce
  no DB writes.
- `warnings` are response/UI evidence only. They are not a new persisted table.

## Key Changes
- Shared:
  - Add strict schemas/types:
    - `CreateThreadDraftRequestSchema`
    - `ThreadDraftParsedSchema`
    - `ThreadDraftNodeRefSchema`
    - `ThreadDraftLinkSchema`
    - `ThreadDraftWarningSchema`
    - `CreateThreadDraftResponseDataSchema`
  - Reuse existing event/task/link/thread enums.
  - Schemas reject injected fields such as `score`, `recommendation`, `advice`,
    `autoApply`, `firmness`, `source`, `status`, and arbitrary `decision`.
- Backend:
  - Add `server/src/llm/threadDraftParser.ts`.
    - Single LLM boundary for thread draft parsing.
    - Prompt must demand JSON only and explicit unknown/null handling.
    - Validate with shared schemas before service code sees data.
  - Add `server/src/services/threadDraft.ts`.
    - Normalizes placeholders to invalid/null according to schema rules.
    - Builds temp-id maps.
    - Inserts thread, nodes, and links in one SQLite transaction.
    - Returns inserted rows and `findThreadNodeLinks` output.
  - Add repository helpers only if existing helpers do not support transactional
    inserts cleanly.
  - Add `POST /api/threads/draft` in `server/src/routes/threads.ts` or a small
    adjacent route module registered from `app.ts`.
  - Ensure route registration mirrors existing LLM-backed capture/annotation
    behavior and fails gracefully without fabricated output.
- Frontend:
  - Update `web/src/ThreadNew.tsx`.
  - Preserve existing manual thread creation.
  - Add a separate natural-language draft panel:
    - textarea
    - submit button
    - loading state
    - `role="alert"` error state
    - success summary with thread/node/link counts, warnings, and link to
      `/threads/:id`
  - Do not auto-confirm links or auto-schedule events.
  - Use semantic tokens, mobile-first layout, 44px controls, and reduced-motion
    safety.
- Docs:
  - Update `docs/codebase-map.md` for the new shared schemas, LLM parser,
    service, route, transaction boundary, and `/threads/new` UI.

## Sprint Contract
- Pass criteria:
  - `POST /api/threads/draft` accepts a description and creates a persisted
    draft thread with AI-derived nodes/links.
  - All created dependency links are `soft/inferred`.
  - Draft events/tasks are attached to the created thread.
  - Unknown values remain empty/null and are visible as warnings/input-needed
    copy; no placeholder text is stored as fact.
  - Invalid LLM output, dangling links, invalid dates, invalid enum values, and
    gateway failures produce no partial DB writes.
  - Existing manual `POST /api/threads` and `/threads/new` manual create flow
    remain stable.
  - Today, slot, feasibility, decision, watcher, and mirror behavior are not
    changed.
  - `docs/codebase-map.md` reflects the new boundary.
- Automatic checks:
  - `corepack pnpm db:generate`
  - `corepack pnpm verify`
  - `git diff --check master..HEAD`
  - Static LLM boundary scan:
    - `rg -n "completeChat|parseThreadDraft|threads/draft|ThreadDraft" server/src shared/src web/src`
    - Expected: `completeChat` for this feature appears only in the new
      thread-draft parser module; route/service call the parser abstraction.
  - Static no auto-apply / no hard-inferred scan:
    - `git diff -U0 master..HEAD -- shared/src server/src web/src | rg -n "autoApply|recommendation|advice|score|firmness|source|status|hard|inferred|authored"`
    - Expected: matches are schemas/tests/docs or explicit forced
      `soft/inferred` writes. No generated link is hard/authored. No UI copy
      presents draft output as confirmed.
  - Static scope scan:
    - `git diff -U0 master..HEAD -- shared/src server/src web/src | rg -n "slot-candidates|schedule|movement|procurement|vendor|venue|domain|gmail|googleapis|telegram|watcher|mirror|decision"`
    - Expected: no new implementation outside planned thread draft route/UI,
      except untouched import context.
- Test cases:
  - Shared schema tests:
    - valid draft request parses.
    - empty/blank/too-long text rejects.
    - parsed draft accepts null unknown fields.
    - parsed draft rejects unknown enum values.
    - parsed draft rejects injected fields (`score`, `recommendation`,
      `autoApply`, `firmness`, `source`, `status`).
    - parsed draft rejects placeholder strings in nullable date/time fields if
      implementation chooses schema-level rejection.
  - Backend unit tests:
    - parser returns invalid result on non-JSON LLM response.
    - parser returns invalid result on schema mismatch.
    - parser prompt forbids fabricated unknowns and hard confirmations.
  - Backend integration tests with real temporary SQLite:
    - successful draft inserts one thread, event/task nodes, and soft/inferred
      links.
    - dangling link temp id returns `502 LLM_INVALID_DRAFT` and leaves row
      counts unchanged.
    - invalid link enum/date/mode returns failure and leaves row counts
      unchanged.
    - LLM gateway failure returns `503 LLM_UNAVAILABLE` and leaves row counts
      unchanged.
    - `GET /api/threads/:id` after draft returns nodes and `nodeLinks`.
    - existing `POST /api/threads` manual path still works.
  - Frontend tests:
    - manual create still posts to `POST /api/threads`.
    - draft textarea submit posts to `POST /api/threads/draft`.
    - loading and error states render.
    - success summary shows created counts, warnings, and link to the new
      thread.
    - no confirm/schedule/apply action is fired on initial draft success.
- gas limit: N/A
- slither pass: N/A

## Missing Edge Case Candidates
- LLM returns a valid-looking link between an event/task that was omitted after
  placeholder normalization.
- LLM returns a plausible date without timezone offset; must reject or null it,
  not store ambiguous local time.
- User submits a broad description with no extractable nodes. The route may
  still create a thread with warnings, but must not invent tasks just to fill
  the draft.

## Simpler Alternative
Implement a pure preview endpoint that returns the parsed draft but does not
persist it. This is safer, but it would not advance the existing cycle-50
edit/confirm workflow because the user could not immediately use `/threads/:id`
to correct and confirm the draft. Persisting a soft/inferred draft is still
bounded because every AI edge remains unconfirmed and editable.

## Assumptions
- A draft created after explicit user submit is allowed to write rows, because
  it stores unconfirmed working material rather than final decisions.
- There is no new DB table in this cycle.
- Event/task rows can represent unknown scheduling fields with existing nullable
  columns.
- `links.source='inferred'` with `firmness='soft'` is the correct durable
  representation for AI-derived dependencies.
- User-authored confirmation stays in the existing cycle-50 confirm endpoint,
  not in draft creation.

## Review Guidance
### Enumeration Required
- Locate every new contract and route:
  - `rg -n "ThreadDraft|threads/draft|parseThreadDraft|createThreadDraft" shared/src server/src web/src`
- Confirm generated links are never hard/authored:
  - `rg -n "firmness|source|hard|authored|inferred" server/src/services server/src/routes server/src/repositories shared/src`
- Confirm unknown values are not fabricated:
  - `rg -n "\\?|unknown|TBD|todo|placeholder|input needed|입력 필요" shared/src server/src web/src`
- Confirm no unrelated integrations were added:
  - `rg -n "googleapis|gmail|telegram|maps|naver|kakao|procurement|vendor|venue|domain|movement" shared/src server/src web/src`

### Verification Method Guide
- Shared schema strictness:
  - Unit tests are sufficient.
- LLM parser behavior:
  - Unit tests with a fake gateway are sufficient for JSON/schema/error paths.
- Draft persistence and all-or-none writes:
  - Integration tests against a real temporary SQLite database are required.
- Link firmness/source invariant:
  - Integration tests plus static scan are required.
- Frontend explicit-action behavior:
  - Component tests are sufficient for request routing, loading/error/success
    states, and no auto-apply actions.
- Full workspace safety:
  - `corepack pnpm verify` is required.
