# Manual Preparation Entry A Implementation Plan

Branch: feature/cycle-46-manual-preparation-entry-a
Skills: backend-fastify, frontend-react-pwa

## Summary
Cycle 46 implements the manual one-line slice of `FR-BRF-04` after cycle 45's
automatic preparation brief. It lets the user add one preparation item from an
event detail sheet without opening a management form.

This cycle reuses existing `resources` and `resource_links`. A submitted name
is stored as an `item` resource when needed and linked directly to the event.
The existing `GET /api/events/:id` schedule brief then renders it through
`scheduleBrief.preparations`.

This is not the AI suggestion layer and not procurement, rental, movement,
contacts, or domain work.

## 입력/출력 명세
- 입력:
  - New `POST /api/events/:id/preparations`.
  - Content-Type: `application/json`.
  - Body: `{ "name": string }`.
  - `name` is trimmed; after trim it must be 1..120 characters.
- 출력:
  - 정상:
    - If the event exists, find-or-create a `resources` row with:
      - `kind='item'`
      - `name=<trimmed name>`
      - `source_person_id=NULL`
      - `note=NULL`
    - Create an idempotent `resource_links` row:
      - `target_type='event'`
      - `target_id=<event id>`
      - `firmness='hard'` for a newly created link
      - `reason='직접 추가'` for a newly created link
    - If the same resource is already linked to the same event, do not create a
      duplicate and do not silently promote or rewrite existing firmness/reason.
    - Response shape:
      - `201` when a new event link is created.
      - `200` when the exact event link already existed.
      - `{ ok: true, data: { resource, link, reusedResource, reusedLink } }`.
    - Frontend clears the input, collapses or marks saved, refetches event
      detail, and the item appears in the existing "준비" subsection.
  - 실패:
    - Invalid id or invalid body: `400 VALIDATION_ERROR`, no DB write.
    - Missing event: `404 NOT_FOUND`, no DB write.
    - DB constraint error: stable `400 DB_ERROR` or existing local route pattern,
      no partial resource without link.

## Key Changes
- Shared:
  - Add `CreateEventPreparationRequestSchema`.
  - Add `CreateEventPreparationResponseDataSchema`.
  - Reuse `ResourceRowSchema` and `ResourceLinkRowSchema`.
  - Keep schemas strict; reject injected kind/sourcePerson/note/link/procurement/
    movement/AI fields.
- Backend:
  - Add an event preparation route in `server/src/routes/events.ts` or a small
    sibling route registered with event routes:
    - validate event id and request body;
    - check event existence;
    - call a repository/service helper that find-or-creates the item resource
      and idempotently links it to the event in one transaction.
  - Add focused repository/service helper in `server/src/repositories/resources.ts`
    or `server/src/services/manualPreparation.ts`.
  - Preserve existing `GET /api/events/:id` read path; no change to the
    preparation builder except tests if needed.
  - Update `docs/codebase-map.md`.
- Frontend:
  - Add page-level `addEventPreparation(eventId, name)` API helper in
    `web/src/Today.tsx` near existing detail helpers.
  - In the event detail sheet, add a collapsed optional "준비물 추가" affordance.
    Tapping expands a single input and submit button.
  - On submit: disable while pending, show a local error on failure, clear input
    and refetch event detail on success.
  - Keep the existing `ScheduleBriefSection` display-only for preparation rows;
    network writes remain page-level.
  - Use semantic tokens only and preserve bottom-sheet keyboard/focus behavior.

## Sprint Contract
- 통과 기준:
  - Shared request schema trims name and rejects blank-after-trim, overlong, and
    injected fields.
  - `POST /api/events/:id/preparations` creates a new item resource and direct
    event resource link for an event.
  - Reusing an existing resource by exact `(name, kind=item)` does not create a
    duplicate resource.
  - Repeating the same preparation for the same event does not create a
    duplicate resource link and returns `reusedLink=true`.
  - Existing linked resource firmness/reason are not rewritten on duplicate
    submit.
  - Missing event and invalid body do not write resources or resource_links.
  - `GET /api/events/:id` after a successful POST returns the new item in
    `scheduleBrief.preparations` with scope `event_direct`.
  - Event detail UI exposes a collapsed optional manual preparation input,
    submits the one-line item, clears/refetches on success, and shows an error
    without losing the sheet on failure.
  - Empty preparation state remains quiet except for the explicit optional add
    affordance.
  - No AI suggestion, procurement/rental fields, vendor/venue/contact
    generalization, movement/route/map adapter, LLM call, or external API call
    is introduced.
- 자동 체크:
  - `corepack pnpm db:generate`
  - `corepack pnpm verify`
  - `git diff --check master..HEAD`
  - Static no external/LLM/map in implementation diff:
    `git diff -U0 master..HEAD -- shared/src server/src web/src | rg -n "\\b(fetch\\(|completeChat|LLM_PROXY_BASE_URL|naver|odsay|kakao|maps)\\b"`
  - Static no out-of-scope section-11 fields in implementation diff:
    `git diff -U0 master..HEAD -- shared/src server/src web/src | rg -n "procurement|proc_|vendor|venue|domain|travelOption|routeOption|manualKnowledge|aiSuggestion|rental"`
- 테스트 케이스:
  - Shared unit:
    - request schema trims and accepts a valid item name.
    - rejects blank-after-trim, overlong, and injected fields.
    - response schema accepts `{ resource, link, reusedResource, reusedLink }`.
  - Backend integration:
    - successful POST creates one `resources` row and one `resource_links` row.
    - existing resource same name/kind is reused.
    - repeat POST is idempotent and does not rewrite existing link firmness or
      reason.
    - invalid body and missing event leave row counts unchanged.
    - GET detail after POST includes the new preparation with
      `scope='event_direct'`, `firmness='hard'`, and `reason='직접 추가'` for
      a newly created link.
  - Frontend:
    - event detail shows collapsed "준비물 추가" control.
    - tapping expands one input; submit disabled for blank input.
    - success calls POST, clears input, refetches event detail, and renders the
      new preparation row.
    - failure shows a sheet-local error and keeps typed text.
    - duplicate success is treated as success, not an error.
    - existing event detail loading/error/live, note submit, status patch,
      close, and schedule brief behavior remain covered.
  - 수동:
    - Mobile Chrome light/dark: input and preparation row readable.
    - Keyboard: add control, input, submit, close are reachable in sane order.
    - Reduced motion: success/error meaning does not depend on motion.
- gas 한도: N/A
- slither 통과: N/A

## 누락된 엣지 케이스 후보 3개
- User submits a name that already exists as `knowledge`; this cycle must create
  or reuse only `kind='item'`, not convert knowledge into an item.
- User submits the same item that already has a tentative event link from a
  prior suggestion; this cycle must not silently promote the link to hard.
- POST succeeds but detail refetch fails; the UI should show a scoped refetch
  error without duplicating another POST on retry.

## 더 단순한 대안 1개
Call the existing `POST /api/resources` then `POST /api/resources/:id/links`
from the frontend. This is faster, but it creates a two-step partial-failure
path, can duplicate resources, and pushes idempotency logic into the client.
The chosen route keeps the one-line UX atomic and server-owned.

## Assumptions
- Manual one-line preparation creates `item` resources only. Manual knowledge
  notes remain a future slice.
- Resource name matching is exact after trim and uses the existing SQLite string
  comparison. Case-folding or fuzzy dedupe is future work.
- `reason='직접 추가'` is acceptable display copy for a user-authored event link.
- No schema migration is needed because existing `resources` and
  `resource_links` already represent the relationship.

## Review Guidance
### Enumeration 필요 항목
- Manual preparation contract:
  - Search:
    `rg -n "CreateEventPreparation|preparations|직접 추가|reusedResource|reusedLink" shared/src server/src web/src`
  - Expected: shared schemas, event POST route, atomic helper, integration tests,
    Today detail form, and UI tests agree on the same request/response shape.
- Resource write path:
  - Search:
    `rg -n "resourceLinks|resources|findResourceByNameAndKind|createResourceLinkIdempotent|manualPreparation|event.*preparation" server/src`
  - Expected: one transaction owns find-or-create + idempotent event link; no
    frontend two-call resource/link sequence.
- Existing GET preparation path:
  - Search:
    `rg -n "findPreparationLinkData|buildPreparations|scheduleBrief" server/src/routes/events.ts server/src/services server/src/repositories/resources.ts`
  - Expected: GET remains read-only and simply picks up the direct event link.
- UI behavior:
  - Search:
    `rg -n "준비물 추가|brief-preparations|prep-row|addEventPreparation|manual prep" web/src/Today.tsx web/src/Today.test.tsx web/src/styles.css`
  - Expected: optional collapsed input, one-line submit, local error, success
    refetch, semantic-token styling.
- No scope creep:
  - Run the static commands from Sprint Contract.
  - Expected: no external/LLM/map calls and no procurement/contact/domain/
    movement fields.

### 검증 방식 가이드
- Shared schemas: unit tests sufficient.
- Transaction/idempotency/no-partial-write behavior: integration tests against
  a real temporary SQLite database required.
- GET detail visibility after POST: backend integration test required.
- UI one-line flow: Vitest + Testing Library sufficient for success/failure and
  disabled states.
- Manual mobile/light/dark/reduced-motion evidence may be recorded in review if
  physical checks are unavailable.
